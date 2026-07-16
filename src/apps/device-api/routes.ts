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

export function createDeviceApiRouter(deps: DeviceApiDependencies): Router {
  const router = Router();
  const { supabaseAdapters } = deps;

  // ========== 同步事件端点 ==========

  /**
   * POST /sync/events
   * PDA 批量提交离线动作事件
   * Body: { events: SyncEvent[] }
   */
  router.post('/sync/events', async (req: Request, res: Response) => {
    try {
      const { events } = req.body as { events: Array<{
        id: string;           // 幂等键，PDA 生成 UUID
        device_id: string;
        device_seq: number;   // 设备端单调递增序号
        action_type: string;  // PICK | PUTAWAY | COUNT | PACK
        payload: Record<string, unknown>;
        captured_at: string;  // ISO 8601
      }> };

      if (!events || !Array.isArray(events) || events.length === 0) {
        return res.status(400).json({ error: 'events array required' });
      }

      // TODO: 实现批量写入 sync_events 表 + 调用 fn_apply_sync_event
      // 暂返回接受状态，实际处理异步进行
      const results = await Promise.all(
        events.map(async (event) => {
          // 这里应该调用 RPC: fn_apply_sync_event(event.id)
          // 目前返回模拟结果
          return {
            event_id: event.id,
            status: 'PENDING' as const,
          };
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
  router.get('/sync/pull', async (req: Request, res: Response) => {
    try {
      const sinceSeq = parseInt(req.query.since_seq as string || '0', 10);
      const limit = parseInt(req.query.limit as string || '100', 10);

      // TODO: 查询 sync_events 表 where device_seq > sinceSeq and status = 'APPLIED'
      // 返回应用结果供 PDA 更新本地状态
      res.json({ events: [], next_cursor: sinceSeq });
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
  router.get('/sync/policy', async (req: Request, res: Response) => {
    try {
      const taskType = req.query.task_type as string | undefined;
      const zoneType = req.query.zone_type as string | undefined;

      // TODO: 调用 RPC fn_get_sync_policy(tenant_id, task_type, zone_type)
      // 返回: { offline_mode: 'ALLOW' | 'LIMITED' | 'ONLINE_ONLY', max_offline_duration_seconds?: number }
      res.json({
        offline_mode: 'ALLOW',
        max_offline_duration_seconds: 28800,
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
   * 调用 RPC fn_claim_task(p_work_order_id, p_user_id, p_device_id, p_lease_seconds)
   */
  router.post('/tasks/:id/claim', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { user_id, device_id, lease_seconds = 300 } = req.body;

      if (!user_id || !device_id) {
        return res.status(400).json({ error: 'user_id and device_id required' });
      }

      // TODO: 调用 Supabase RPC fn_claim_task
      // const { data, error } = await supabase.rpc('fn_claim_task', {...});

      // 模拟成功响应
      res.json({
        claim_id: 'claim-' + id,
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
  router.post('/tasks/claims/:id/release', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // TODO: 调用 Supabase RPC fn_release_task_claim
      // const { data, error } = await supabase.rpc('fn_release_task_claim', { p_claim_id: id });

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
  router.get('/exceptions', async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const domain = req.query.domain as string | undefined;
      const severity = req.query.severity as string | undefined;
      const limit = parseInt(req.query.limit as string || '50', 10);
      const offset = parseInt(req.query.offset as string || '0', 10);

      // TODO: 查询 exceptions 表（RLS 自动过滤 tenant_id）
      // 支持过滤：status IN (PENDING_REVIEW, CONFLICT, RESOLVED, DISMISSED)
      //          domain IN (INVENTORY, SYNC, COMPLIANCE, TASK, FULFILLMENT, BILLING, OTHER)
      res.json({ data: [], total: 0, limit, offset });
    } catch (error) {
      console.error('GET /exceptions error:', error);
      res.status(500).json({ error: 'Failed to fetch exceptions' });
    }
  });

  /**
   * GET /exceptions/:id
   * 获取异常详情（含审计轨迹 exception_events）
   */
  router.get('/exceptions/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // TODO: 查询 exceptions 表 + exception_events 关联
      // 设备端只读，不暴露解决操作
      res.json({
        id,
        tenant_id: 'tenant-xxx',
        exception_type: 'INVENTORY_SHORTAGE',
        domain: 'INVENTORY',
        severity: 'HIGH',
        status: 'PENDING_REVIEW',
        source_table: 'order_lines',
        source_id: 'order-line-xxx',
        title: '拣货库存不足',
        details: { needed: 10, available: 3 },
        raised_by: null,
        assigned_to: null,
        created_at: new Date().toISOString(),
        events: [],
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