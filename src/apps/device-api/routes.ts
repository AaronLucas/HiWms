/**
 * Device API 路由定义
 * 核心端点：
 * - POST /sync/events     - 提交同步事件（PDA 离线动作上传）
 * - GET  /sync/pull       - 增量拉取同步数据
 * - GET  /sync/policy     - 查询离线策略配置
 * - POST /tasks/{id}/claim      - 任务领用（竞争性锁）
 * - POST /tasks/claims/{id}/release - 释放任务租约
 * - GET  /exceptions      - 统一异常查看（设备端只读）
 * - GET  /exceptions/{id} - 异常详情
 */
import { Router, Request, Response } from 'express';
import { DeviceApiDependencies } from './di';
import type { Database } from '../../types/database';
import {
  validateRequest,
  syncEventsRequestSchema,
  syncPullQuerySchema,
  syncPolicyQuerySchema,
  taskClaimRequestSchema,
  taskClaimParamsSchema,
  taskClaimReleaseParamsSchema,
  exceptionsQuerySchema,
  exceptionParamsSchema,
} from './validation';

export function createDeviceApiRouter(deps: DeviceApiDependencies): Router {
  const router = Router();
  const { supabaseAdapters } = deps;

  // 获取仓储实例
  const taskClaimRepo = supabaseAdapters.repositories.taskClaims;
  const syncPolicyRepo = supabaseAdapters.repositories.syncPolicies;
  const deviceSyncStateRepo = supabaseAdapters.repositories.deviceSyncStates;
  const syncEventRepo = supabaseAdapters.repositories.syncEvents;
  const exceptionRepo = supabaseAdapters.repositories.exceptions;

  // ========== 同步事件端点 ==========

  /**
   * POST /sync/events
   * PDA 批量提交离线动作事件
   * Body: { events: SyncEvent[] }
   */
  router.post('/sync/events',
    validateRequest({ body: syncEventsRequestSchema }),
    async (req: Request, res: Response) => {
      try {
        const { events } = req.body;

        // 从请求上下文获取 tenant_id（由中间件注入）
        const tenantId = (req as any).context?.tenantId;
        if (!tenantId) {
          return res.status(400).json({ error: 'tenant_id not available in context' });
        }

        // 批量插入 sync_events 表（幂等键 id + device_seq 防重）
        const eventsToInsert = events.map((event: { id: string; device_id: string; device_seq: number; action_type: string; payload: unknown; captured_at: string }) => ({
          id: event.id,
          tenant_id: tenantId,
          device_id: event.device_id,
          operator_user_id: (req as any).context?.userId || null,
          device_seq: event.device_seq,
          action_type: event.action_type,
          payload: event.payload as Database['public']['Tables']['sync_events']['Insert']['payload'],
          captured_at: event.captured_at,
          received_at: new Date().toISOString(),
          status: 'PENDING' as const,
        }));

        const { inserted, duplicates } = await syncEventRepo.insertBatch(eventsToInsert);

        // 异步处理每个事件：调用对应的 apply RPC
        const results = await Promise.all(
          events.map(async (event: { id: string }) => {
            try {
              const result = await syncEventRepo.applyEvent(event.id);
              return {
                event_id: event.id,
                ...result,
              };
            } catch (rpcError) {
              console.error(`applyEvent failed for event ${event.id}:`, rpcError);
              return {
                event_id: event.id,
                success: false as const,
                error: rpcError instanceof Error ? rpcError.message : 'Unknown error',
              };
            }
          })
        );

        res.json({ results, inserted, duplicates });
      } catch (error) {
        console.error('POST /sync/events error:', error);
        res.status(500).json({ error: 'Failed to process sync events' });
      }
    });

  /**
   * GET /sync/pull
   * PDA 增量拉取同步数据
   * Query: since_seq (number), limit (number, default 100)
   */
  router.get('/sync/pull',
    validateRequest({ query: syncPullQuerySchema }),
    async (req: Request, res: Response) => {
      try {
        const sinceSeq = Number(req.query.since_seq) || 0;
        const limit = Number(req.query.limit) || 100;

        const tenantId = (req as any).context?.tenantId;
        if (!tenantId) {
          return res.status(400).json({ error: 'tenant_id not available in context' });
        }

        // 获取设备 ID（用于更新同步游标）
        const deviceId = (req as any).context?.deviceId;
        if (!deviceId) {
          return res.status(400).json({ error: 'device_id not available in context' });
        }

        // 查询已处理的同步事件（APPLIED 状态），按 device_seq 递增
        const appliedEvents = await syncEventRepo.findAppliedSince(tenantId, sinceSeq, limit);

        // 更新设备同步游标
        if (appliedEvents.length > 0) {
          const nextCursor = Math.max(...appliedEvents.map(e => e.device_seq));
          await deviceSyncStateRepo.updateCursor(deviceId, tenantId, nextCursor);
        }

        const nextCursor = appliedEvents.length > 0
          ? Math.max(...appliedEvents.map(e => e.device_seq))
          : sinceSeq;

        res.json({ events: appliedEvents, next_cursor: nextCursor });
      } catch (error) {
        console.error('GET /sync/pull error:', error);
        res.status(500).json({ error: 'Failed to pull sync data' });
      }
    });

  /**
   * GET /sync/policy
   * 查询当前租户/任务类型/库位类型的离线策略
   * Query: task_type, zone_type
   */
  router.get('/sync/policy',
    validateRequest({ query: syncPolicyQuerySchema }),
    async (req: Request, res: Response) => {
      try {
        const taskType = req.query.task_type as string | undefined;
        const zoneType = req.query.zone_type as string | undefined;

        const tenantId = (req as any).context?.tenantId;
        if (!tenantId) {
          return res.status(400).json({ error: 'tenant_id not available in context' });
        }

        // 调用仓储层查询生效策略
        const policy = await syncPolicyRepo.getSyncPolicy({ tenantId, taskType, zoneType });

        // 返回匹配策略（按优先级已在仓储层处理）
        const result = policy || {
          offlineMode: 'ALLOW',
          maxOfflineDurationSeconds: 28800,
          requiresTaskClaim: false,
          conflictStrategy: 'SERVER_WINS',
          policyId: 'default',
        };

        res.json(result);
      } catch (error) {
        console.error('GET /sync/policy error:', error);
        res.status(500).json({ error: 'Failed to fetch sync policy' });
      }
    });

  // ========== 任务领用/释放端点 ==========

  /**
   * POST /tasks/:id/claim
   * 竞争性任务租约领用
   * 调用仓储层 claimTask -> RPC fn_claim_task
   */
  router.post('/tasks/:id/claim',
    validateRequest({ params: taskClaimParamsSchema, body: taskClaimRequestSchema }),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { user_id, device_id, lease_seconds = 300 } = req.body;
        const leaseSeconds = Number(lease_seconds) || 300;

        const tenantId = (req as any).context?.tenantId;
        if (!tenantId) {
          return res.status(400).json({ error: 'tenant_id not available in context' });
        }

        // 调用仓储层领用任务
        const result = await taskClaimRepo.claimTask({
          workOrderId: id,
          userId: user_id,
          deviceId: device_id,
          leaseSeconds,
        });

        if (!result || !result.success) {
          return res.status(409).json({
            error: 'Failed to claim task',
            message: result?.message || 'Task already claimed or not available',
          });
        }

        res.json({
          claim_id: result.claimId,
          status: 'ACTIVE',
          expires_at: result.expiresAt,
        });
      } catch (error) {
        console.error('POST /tasks/:id/claim error:', error);
        res.status(500).json({ error: 'Failed to claim task' });
      }
    });

  /**
   * POST /tasks/claims/:id/release
   * 释放任务租约
   * 调用仓储层 releaseTaskClaim -> RPC fn_release_task_claim
   */
  router.post('/tasks/claims/:id/release',
    validateRequest({ params: taskClaimReleaseParamsSchema }),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;

        // 调用仓储层释放租约
        const success = await taskClaimRepo.releaseTaskClaim(id);

        if (!success) {
          return res.status(404).json({ error: 'Claim not found or already released' });
        }

        res.json({ success: true });
      } catch (error) {
        console.error('POST /tasks/claims/:id/release error:', error);
        res.status(500).json({ error: 'Failed to release task claim' });
      }
    });

  // ========== 统一异常查看端点（设备端只读） ==========

  /**
   * GET /exceptions
   * 查询当前租户的异常列表（分页、过滤）
   * Query: status, domain, severity, limit, offset
   */
  router.get('/exceptions',
    validateRequest({ query: exceptionsQuerySchema }),
    async (req: Request, res: Response) => {
      try {
        const status = req.query.status as string | undefined;
        const domain = req.query.domain as string | undefined;
        const severity = req.query.severity as string | undefined;
        const limit = Number(req.query.limit) || 50;
        const offset = Number(req.query.offset) || 0;

        const tenantId = (req as any).context?.tenantId;
        if (!tenantId) {
          return res.status(400).json({ error: 'tenant_id not available in context' });
        }

        // 查询异常列表
        const { data, total } = await exceptionRepo.findByTenant({
          tenantId,
          status: status as any,
          domain: domain as any,
          severity: severity as any,
          limit,
          offset,
        });

        res.json({ data, total, limit, offset });
      } catch (error) {
        console.error('GET /exceptions error:', error);
        res.status(500).json({ error: 'Failed to fetch exceptions' });
      }
    });

  /**
   * GET /exceptions/:id
   * 获取异常详情（含审计轨迹 exception_events）
   */
  router.get('/exceptions/:id',
    validateRequest({ params: exceptionParamsSchema }),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;

        const tenantId = (req as any).context?.tenantId;
        if (!tenantId) {
          return res.status(400).json({ error: 'tenant_id not available in context' });
        }

        // 查询异常详情（含审计事件）
        const exception = await exceptionRepo.findById(id, tenantId);

        if (!exception) {
          return res.status(404).json({ error: 'Exception not found' });
        }

        res.json(exception);
      } catch (error) {
        console.error('GET /exceptions/:id error:', error);
        res.status(500).json({ error: 'Failed to fetch exception detail' });
      }
    });

  // ========== 健康检查 ==========
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'device-api', timestamp: new Date().toISOString() });
  });

  return router;
}