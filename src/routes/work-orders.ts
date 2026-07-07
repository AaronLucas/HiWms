import { Router, Request, Response } from 'express';
import { SupabaseClient, createSupabaseClientFromEnv } from '../supabase/SupabaseClient';
import { WorkOrderService, WorkOrderType, WorkOrderStatus } from '../services/WorkOrderService';
import { ActionLogService, ActionType } from '../services/ActionLogService';

const router = Router();
const supabase = createSupabaseClientFromEnv();
const workOrderService = new WorkOrderService(supabase);
const actionLogService = new ActionLogService(supabase);

/**
 * @swagger
 * /api/work-orders:
 *   post:
 *     summary: 创建工单
 *     tags: [Work Orders]
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string || req.body.tenant_id;
    if (!tenantId) {
      return res.status(400).json({ error: 'Missing tenant_id' });
    }

    const input = {
      tenantId,
      type: req.body.type as WorkOrderType,
      orderId: req.body.order_id,
      waveId: req.body.wave_id,
      parentWoId: req.body.parent_wo_id,
      assignedUserId: req.body.assigned_user_id,
      deviceId: req.body.device_id,
      expectedDurationSeconds: req.body.expected_duration_seconds,
      pdaSummary: req.body.pda_summary,
      metadata: req.body.metadata,
    };

    const wo = await workOrderService.create(input);
    res.status(201).json({ data: wo });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/work-orders/batch:
 *   post:
 *     summary: 批量创建工单（波次派单）
 *     tags: [Work Orders]
 */
router.post('/batch', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string || req.body.tenant_id;
    if (!tenantId) {
      return res.status(400).json({ error: 'Missing tenant_id' });
    }

    const inputs = (req.body.work_orders || []).map((wo: any) => ({
      tenantId,
      type: wo.type as WorkOrderType,
      orderId: wo.order_id,
      waveId: wo.wave_id,
      parentWoId: wo.parent_wo_id,
      assignedUserId: wo.assigned_user_id,
      deviceId: wo.device_id,
      expectedDurationSeconds: wo.expected_duration_seconds,
      pdaSummary: wo.pda_summary,
      metadata: wo.metadata,
    }));

    const wos = await workOrderService.createBatch(inputs);
    res.status(201).json({ data: wos });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/work-orders:
 *   get:
 *     summary: 查询工单列表
 *     tags: [Work Orders]
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'Missing tenant_id' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.page_size as string) || 20;

    const filters = {
      tenantId,
      status: req.query.status ? (req.query.status as string).split(',') as WorkOrderStatus[] : undefined,
      type: req.query.type ? (req.query.type as string).split(',') as WorkOrderType[] : undefined,
      assignedUserId: req.query.assigned_user_id as string,
      waveId: req.query.wave_id as string,
      orderId: req.query.order_id as string,
      parentWoId: req.query.parent_wo_id as string,
      dateFrom: req.query.date_from ? new Date(req.query.date_from as string) : undefined,
      dateTo: req.query.date_to ? new Date(req.query.date_to as string) : undefined,
      page,
      pageSize,
    };

    const result = await workOrderService.list(filters);
    res.json({
      data: result.data,
      pagination: { page, pageSize, total: result.total },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/work-orders/{id}:
 *   get:
 *     summary: 获取工单详情
 *     tags: [Work Orders]
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const wo = await workOrderService.getById(req.params.id);
    if (!wo) {
      return res.status(404).json({ error: 'Work order not found' });
    }
    res.json({ data: wo });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/work-orders/{id}:
 *   patch:
 *     summary: 更新工单
 *     tags: [Work Orders]
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const input = {
      status: req.body.status as WorkOrderStatus,
      assignedUserId: req.body.assigned_user_id,
      deviceId: req.body.device_id,
      acceptedAt: req.body.accepted_at ? new Date(req.body.accepted_at) : undefined,
      completedAt: req.body.completed_at ? new Date(req.body.completed_at) : undefined,
      exceptionReason: req.body.exception_reason,
      metadata: req.body.metadata,
    };

    const wo = await workOrderService.update(req.params.id, input);
    res.json({ data: wo });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/work-orders/{id}/accept:
 *   post:
 *     summary: 接单
 *     tags: [Work Orders]
 */
router.post('/:id/accept', async (req: Request, res: Response) => {
  try {
    const userId = req.body.user_id;
    const deviceId = req.body.device_id;
    if (!userId) {
      return res.status(400).json({ error: 'Missing user_id' });
    }
    const wo = await workOrderService.accept(req.params.id, userId, deviceId);
    res.json({ data: wo });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/work-orders/{id}/start:
 *   post:
 *     summary: 开始执行
 *     tags: [Work Orders]
 */
router.post('/:id/start', async (req: Request, res: Response) => {
  try {
    const wo = await workOrderService.start(req.params.id);
    res.json({ data: wo });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/work-orders/{id}/complete:
 *   post:
 *     summary: 完成工单
 *     tags: [Work Orders]
 */
router.post('/:id/complete', async (req: Request, res: Response) => {
  try {
    const userId = req.body.user_id;
    if (!userId) {
      return res.status(400).json({ error: 'Missing user_id' });
    }
    const wo = await workOrderService.complete(req.params.id, userId);
    res.json({ data: wo });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/work-orders/{id}/exception:
 *   post:
 *     summary: 标记异常
 *     tags: [Work Orders]
 */
router.post('/:id/exception', async (req: Request, res: Response) => {
  try {
    const reason = req.body.reason;
    if (!reason) {
      return res.status(400).json({ error: 'Missing reason' });
    }
    const wo = await workOrderService.exception(req.params.id, reason);
    res.json({ data: wo });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/work-orders/{id}/children:
 *   get:
 *     summary: 获取子工单
 *     tags: [Work Orders]
 */
router.get('/:id/children', async (req: Request, res: Response) => {
  try {
    const children = await workOrderService.getChildren(req.params.id);
    res.json({ data: children });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/work-orders/{id}/stats:
 *   get:
 *     summary: 工单统计（驾驶舱数据源）
 *     tags: [Work Orders]
 */
router.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'Missing tenant_id' });
    }

    const dateFrom = req.query.date_from ? new Date(req.query.date_from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateTo = req.query.date_to ? new Date(req.query.date_to as string) : new Date();

    const stats = await workOrderService.getStats(tenantId, dateFrom, dateTo);
    res.json({ data: stats, meta: { tenant_id: tenantId, period: { from: dateFrom.toISOString(), to: dateTo.toISOString() } } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/work-orders/{id}/actions:
 *   post:
 *     summary: 记录操作动作日志
 *     tags: [Work Orders]
 */
router.post('/:id/actions', async (req: Request, res: Response) => {
  try {
    const input = {
      woId: req.params.id,
      skuId: req.body.sku_id,
      actionType: req.body.action_type as ActionType,
      fromLocId: req.body.from_loc_id,
      toLocId: req.body.to_loc_id,
      qtyActed: req.body.qty_acted,
      serialNumbers: req.body.serial_numbers,
      capturedData: req.body.captured_data,
      durationMs: req.body.duration_ms,
    };

    if (!input.actionType) {
      return res.status(400).json({ error: 'Missing action_type' });
    }

    const log = await actionLogService.record(input);
    res.status(201).json({ data: log });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/work-orders/{id}/actions:
 *   get:
 *     summary: 获取工单操作日志
 *     tags: [Work Orders]
 */
router.get('/:id/actions', async (req: Request, res: Response) => {
  try {
    const logs = await actionLogService.getByWorkOrder(req.params.id);
    res.json({ data: logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/work-orders/{id}/actions/start:
 *   post:
 *     summary: 记录动作开始
 *     tags: [Work Orders]
 */
router.post('/:id/actions/start', async (req: Request, res: Response) => {
  try {
    const input = {
      woId: req.params.id,
      skuId: req.body.sku_id,
      actionType: req.body.action_type as ActionType,
      fromLocId: req.body.from_loc_id,
      toLocId: req.body.to_loc_id,
      qtyActed: req.body.qty_acted,
      serialNumbers: req.body.serial_numbers,
      capturedData: req.body.captured_data,
    };

    if (!input.actionType) {
      return res.status(400).json({ error: 'Missing action_type' });
    }

    const logId = await actionLogService.start(input);
    res.status(201).json({ data: { log_id: logId } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/work-orders/{id}/actions/{logId}/end:
 *   post:
 *     summary: 记录动作结束
 *     tags: [Work Orders]
 */
router.post('/:id/actions/:logId/end', async (req: Request, res: Response) => {
  try {
    const logId = parseInt(req.params.logId);
    const updates = {
      qtyActed: req.body.qty_acted,
      serialNumbers: req.body.serial_numbers,
      capturedData: req.body.captured_data,
    };

    const log = await actionLogService.end(logId, updates);
    res.json({ data: log });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;