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
import { SupabaseRpcClient } from '../../adapters/supabase/rpc/SupabaseRpcClient';
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

  // 获取 RPC 客户端和 Supabase 客户端
  const rpcClient = supabaseAdapters.rpc as SupabaseRpcClient;
  const supabaseClient = supabaseAdapters.client;

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
        const eventsToInsert = events.map(event => ({
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

        const { error: insertError } = await supabaseClient.getAdminClient()
          .from('sync_events')
          .insert(eventsToInsert as any);

        if (insertError) {
          console.error('sync_events insert error:', insertError);
          return res.status(500).json({ error: 'Failed to insert sync events', details: insertError.message });
        }

        // 异步处理每个事件：调用 fn_apply_sync_event
        const results = await Promise.all(
          events.map(async (event: { id: string }) => {
            try {
              const result = await rpcClient.raw('fn_apply_sync_event', {
                p_event_id: event.id,
              });
              return {
                event_id: event.id,
                status: 'APPLIED' as const,
                result,
              };
            } catch (rpcError) {
              console.error(`fn_apply_sync_event failed for event ${event.id}:`, rpcError);
              return {
                event_id: event.id,
                status: 'EXCEPTION' as const,
                error: rpcError instanceof Error ? rpcError.message : 'Unknown error',
              };
            }
          })
        );

        res.json({ results });
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

        // 查询已处理的同步事件（APPLIED 状态），按 device_seq 递增
        const { data, error } = await supabaseClient.getClient()
          .from('sync_events')
          .select('id, device_seq, action_type, payload, status, applied_at')
          .eq('tenant_id', tenantId)
          .gt('device_seq', sinceSeq)
          .eq('status', 'APPLIED')
          .order('device_seq', { ascending: true })
          .limit(limit);

        if (error) {
          console.error('sync_events query error:', error);
          return res.status(500).json({ error: 'Failed to pull sync data' });
        }

        const nextCursor = data && data.length > 0
          ? Math.max(...data.map(e => e.device_seq))
          : sinceSeq;

        res.json({ events: data || [], next_cursor: nextCursor });
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

        // 调用 RPC fn_get_sync_policy
        const policy = await rpcClient.raw('fn_get_sync_policy', {
          p_tenant_id: tenantId,
          p_task_type: taskType,
          p_zone_type: zoneType,
        });

        // 返回第一条匹配策略（按优先级已在 RPC 内部处理）
        const result = policy && policy.length > 0 ? policy[0] : {
          offline_mode: 'ALLOW',
          max_offline_duration_seconds: 28800,
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
   * 调用 RPC fn_claim_task(p_work_order_id, p_user_id, p_device_id, p_lease_seconds)
   */
  router.post('/tasks/:id/claim',
    validateRequest({ params: taskClaimParamsSchema, body: taskClaimRequestSchema }),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { user_id, device_id, lease_seconds = 300 } = req.body;

        const tenantId = (req as any).context?.tenantId;
        if (!tenantId) {
          return res.status(400).json({ error: 'tenant_id not available in context' });
        }

        // 调用 RPC fn_claim_task
        const result = await rpcClient.raw('fn_claim_task', {
          p_work_order_id: id,
          p_user_id: user_id,
          p_device_id: device_id,
          p_lease_seconds: lease_seconds,
        });

        // RPC 返回数组，取第一个结果
        const claimResult = result && result.length > 0 ? result[0] : null;

        if (!claimResult || !claimResult.success) {
          return res.status(409).json({
            error: 'Failed to claim task',
            message: claimResult?.message || 'Task already claimed or not available',
          });
        }

        res.json({
          claim_id: claimResult.claim_id,
          status: 'ACTIVE',
          expires_at: new Date(Date.now() + lease_seconds * 1000).toISOString(),
        });
      } catch (error) {
        console.error('POST /tasks/:id/claim error:', error);
        res.status(500).json({ error: 'Failed to claim task' });
      }
    });

  /**
   * POST /tasks/claims/:id/release
   * 释放任务租约
   * 调用 RPC fn_release_task_claim(p_claim_id)
   */
  router.post('/tasks/claims/:id/release',
    validateRequest({ params: taskClaimReleaseParamsSchema }),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;

        // 调用 RPC fn_release_task_claim
        const success = await rpcClient.raw('fn_release_task_claim', {
          p_claim_id: id,
        });

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

        // 查询 exceptions 表（RLS 自动过滤 tenant_id）
        let query = supabaseClient.getClient()
          .from('exceptions')
          .select('*', { count: 'exact' })
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);

        if (status) query = query.eq('status', status);
        if (domain) query = query.eq('domain', domain);
        if (severity) query = query.eq('severity', severity);

        const { data, error, count } = await query;

        if (error) {
          console.error('exceptions query error:', error);
          return res.status(500).json({ error: 'Failed to fetch exceptions' });
        }

        res.json({ data: data || [], total: count || 0, limit, offset });
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

        // 查询异常主表
        const { data: exception, error: excError } = await supabaseClient.getClient()
          .from('exceptions')
          .select('*')
          .eq('id', id)
          .eq('tenant_id', tenantId)
          .single();

        if (excError || !exception) {
          return res.status(404).json({ error: 'Exception not found' });
        }

        // 查询审计轨迹
        const { data: events, error: eventsError } = await supabaseClient.getClient()
          .from('exception_events')
          .select('*')
          .eq('exception_id', id)
          .order('id', { ascending: true });

        if (eventsError) {
          console.error('exception_events query error:', eventsError);
        }

        res.json({
          ...exception,
          events: events || [],
        });
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