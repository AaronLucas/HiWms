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
 * - POST /putaway         - 上架动作提交 (Layer 3)
 * - POST /count           - 盘点动作提交 (Layer 3)
 * - POST /pack            - 打包动作提交 (Layer 3)
 * - POST /missing-label/generate - 生成内部 LPN 码 (Layer 4)
 * - POST /missing-label/confirm  - 确认标签已贴 (Layer 4)
 * - POST /unidentified/receive   - 接收未识别货物 (Layer 4)
 * - POST /unidentified/identify  - 确认未识别货物身份 (Layer 4)
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
  // Layer 3: PUTAWAY/COUNT/PACK
  putawayRequestSchema,
  countRequestSchema,
  packRequestSchema,
  // Layer 4: MISSING_LABEL/UNIDENTIFIED_GOODS
  missingLabelGenerateSchema,
  missingLabelConfirmSchema,
  unidentifiedReceiveSchema,
  unidentifiedIdentifySchema,
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

        // 调用仓储层查询生效策略（按优先级已在仓储层处理）
        const policy = await syncPolicyRepo.getEffectivePolicy(tenantId, taskType, zoneType);

        // 响应字段严格对齐 SYNC_API_CONTRACT.md §5.2 文档契约（snake_case，仅这两个
        // 字段）——与本文件其余 Device API 响应的字段命名约定一致（event_id/next_cursor/
        // lpn_code/exception_id 等）。offline_mode 是冷链/危化品"是否必须强制在线"判定
        // 直接依赖的字段，此前曾错误地以 camelCase（offlineMode）返回，按文档实现的客户端
        // 读取 offline_mode 只会得到 undefined。
        res.json({
          offline_mode: policy.offlineMode,
          max_offline_duration_seconds: policy.maxOfflineDurationSeconds,
        });
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

  // ========== Layer 3: PUTAWAY/COUNT/PACK 端点 ==========

  /**
   * POST /putaway
   * 上架动作提交
   */
  router.post('/putaway',
    validateRequest({ body: putawayRequestSchema }),
    async (req: Request, res: Response) => {
      try {
        const tenantId = (req as any).context?.tenantId;
        if (!tenantId) {
          return res.status(400).json({ error: 'tenant_id not available in context' });
        }

        const { sku_id, location_id, qty, lpn_id, batch_id, expiry_date, serial_number } = req.body;

        // 提交为 sync_events 记录
        const eventId = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await syncEventRepo.insertBatch([{
          id: eventId,
          tenant_id: tenantId,
          device_id: (req as any).context?.deviceId || 'unknown',
          operator_user_id: (req as any).context?.userId || null,
          device_seq: Date.now(),
          action_type: 'PUTAWAY',
          // serial_number 透传给 fn_apply_putaway_action，供序列化商品分流使用
          payload: { sku_id, location_id, qty, lpn_id, batch_id, expiry_date, serial_number },
          captured_at: new Date().toISOString(),
          received_at: new Date().toISOString(),
          status: 'PENDING' as const,
        }]);

        // 处理事件
        const result = await syncEventRepo.applyEvent(eventId);
        res.json({ event_id: eventId, ...result });
      } catch (error) {
        console.error('POST /putaway error:', error);
        res.status(500).json({ error: 'Failed to process putaway' });
      }
    });

  /**
   * POST /count
   * 盘点动作提交
   */
  router.post('/count',
    validateRequest({ body: countRequestSchema }),
    async (req: Request, res: Response) => {
      try {
        const tenantId = (req as any).context?.tenantId;
        if (!tenantId) {
          return res.status(400).json({ error: 'tenant_id not available in context' });
        }

        const { sku_id, location_id, actual_qty, count_task_id } = req.body;

        const eventId = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await syncEventRepo.insertBatch([{
          id: eventId,
          tenant_id: tenantId,
          device_id: (req as any).context?.deviceId || 'unknown',
          operator_user_id: (req as any).context?.userId || null,
          device_seq: Date.now(),
          action_type: 'COUNT',
          payload: { sku_id, location_id, actual_qty, count_task_id },
          captured_at: new Date().toISOString(),
          received_at: new Date().toISOString(),
          status: 'PENDING' as const,
        }]);

        const result = await syncEventRepo.applyEvent(eventId);
        res.json({ event_id: eventId, ...result });
      } catch (error) {
        console.error('POST /count error:', error);
        res.status(500).json({ error: 'Failed to process count' });
      }
    });

  /**
   * POST /pack
   * 打包动作提交
   */
  router.post('/pack',
    validateRequest({ body: packRequestSchema }),
    async (req: Request, res: Response) => {
      try {
        const tenantId = (req as any).context?.tenantId;
        if (!tenantId) {
          return res.status(400).json({ error: 'tenant_id not available in context' });
        }

        const { packing_task_id, container_id, items } = req.body;

        const eventId = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await syncEventRepo.insertBatch([{
          id: eventId,
          tenant_id: tenantId,
          device_id: (req as any).context?.deviceId || 'unknown',
          operator_user_id: (req as any).context?.userId || null,
          device_seq: Date.now(),
          action_type: 'PACK',
          payload: { packing_task_id, container_id, items },
          captured_at: new Date().toISOString(),
          received_at: new Date().toISOString(),
          status: 'PENDING' as const,
        }]);

        const result = await syncEventRepo.applyEvent(eventId);
        res.json({ event_id: eventId, ...result });
      } catch (error) {
        console.error('POST /pack error:', error);
        res.status(500).json({ error: 'Failed to process pack' });
      }
    });

  // ========== Layer 4: MISSING_LABEL / UNIDENTIFIED_GOODS 端点 ==========

  /**
   * POST /missing-label/generate
   * 生成内部 LPN 码（用于 MISSING_LABEL 异常）
   */
  router.post('/missing-label/generate',
    validateRequest({ body: missingLabelGenerateSchema }),
    async (req: Request, res: Response) => {
      try {
        const tenantId = (req as any).context?.tenantId;
        const actorUserId = (req as any).context?.userId;
        if (!tenantId) {
          return res.status(400).json({ error: 'tenant_id not available in context' });
        }
        if (!actorUserId) {
          return res.status(400).json({ error: 'user_id not available in context, cannot record actor identity' });
        }

        const { exception_id } = req.body;
        const lpn = await supabaseAdapters.repositories.missingLabels.generateInternalLpn(exception_id, actorUserId);
        res.json({ lpn_code: lpn, exception_id });
      } catch (error) {
        console.error('POST /missing-label/generate error:', error);
        res.status(500).json({ error: 'Failed to generate internal LPN' });
      }
    });

  /**
   * POST /missing-label/confirm
   * 确认标签已贴
   */
  router.post('/missing-label/confirm',
    validateRequest({ body: missingLabelConfirmSchema }),
    async (req: Request, res: Response) => {
      try {
        const tenantId = (req as any).context?.tenantId;
        const resolverUserId = (req as any).context?.userId;
        if (!tenantId) {
          return res.status(400).json({ error: 'tenant_id not available in context' });
        }
        if (!resolverUserId) {
          return res.status(400).json({ error: 'user_id not available in context, cannot record resolver identity' });
        }

        const { exception_id, scanned_lpn_code } = req.body;
        const success = await supabaseAdapters.repositories.missingLabels.confirmLabelApplied(exception_id, resolverUserId, scanned_lpn_code);
        res.json({ success, exception_id });
      } catch (error) {
        console.error('POST /missing-label/confirm error:', error);
        res.status(500).json({ error: 'Failed to confirm label applied' });
      }
    });

  /**
   * POST /unidentified/receive
   * 接收未识别货物
   */
  router.post('/unidentified/receive',
    validateRequest({ body: unidentifiedReceiveSchema }),
    async (req: Request, res: Response) => {
      try {
        const tenantId = (req as any).context?.tenantId;
        if (!tenantId) {
          return res.status(400).json({ error: 'tenant_id not available in context' });
        }
        // actor_user_id 改由已验证的设备上下文派生，不再信任客户端传入；
        // 保持可选（API Key 纯设备认证场景下 context.userId 本就可能不存在）
        const actorUserId = (req as any).context?.userId;

        const { location_id, qty, note } = req.body;
        const exceptionId = await supabaseAdapters.repositories.unidentifiedGoods.receiveUnidentifiedGoods({
          tenantId,
          locationId: location_id,
          qty,
          note,
          actorUserId,
        });
        res.json({ exception_id: exceptionId });
      } catch (error) {
        console.error('POST /unidentified/receive error:', error);
        res.status(500).json({ error: 'Failed to receive unidentified goods' });
      }
    });

  /**
   * POST /unidentified/identify
   * 确认未识别货物身份
   */
  router.post('/unidentified/identify',
    validateRequest({ body: unidentifiedIdentifySchema }),
    async (req: Request, res: Response) => {
      try {
        const tenantId = (req as any).context?.tenantId;
        const resolverUserId = (req as any).context?.userId;
        if (!tenantId) {
          return res.status(400).json({ error: 'tenant_id not available in context' });
        }
        if (!resolverUserId) {
          return res.status(400).json({ error: 'user_id not available in context, cannot record resolver identity' });
        }

        const { exception_id, confirmed_product_id } = req.body;
        const success = await supabaseAdapters.repositories.unidentifiedGoods.identifyUnidentifiedGoods(exception_id, confirmed_product_id, resolverUserId);
        res.json({ success, exception_id });
      } catch (error) {
        console.error('POST /unidentified/identify error:', error);
        res.status(500).json({ error: 'Failed to identify unidentified goods' });
      }
    });

  // ========== 健康检查 ==========
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'device-api', timestamp: new Date().toISOString() });
  });

  return router;
}
