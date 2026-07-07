// src/routes/loading.ts
// Phase A: 装车/发运 API 路由

import { Router, Request, Response } from 'express';
import { LoadingService } from '../services/LoadingService';
import { authMiddleware } from '../routes';

const router = Router();
router.use(authMiddleware.handle);

// =====================================================================
// 车辆管理
// =====================================================================

// GET /api/loading/vehicles - 获取车辆列表
router.get('/vehicles', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const status = req.query.status as string | undefined;

    const service = new LoadingService(tenantId);
    const vehicles = await service.getVehicles(status);
    res.json({ data: vehicles });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/loading/vehicles - 创建车辆
router.post('/vehicles', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const data = { ...req.body, tenant_id: tenantId };

    const service = new LoadingService(tenantId);
    const vehicle = await service.createVehicle(data);
    res.status(201).json({ data: vehicle });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/loading/vehicles/:id - 获取单个车辆
router.get('/vehicles/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new LoadingService(tenantId);
    const vehicle = await service.getVehicle(req.params.id);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json({ data: vehicle });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/loading/vehicles/:id - 更新车辆
router.patch('/vehicles/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new LoadingService(tenantId);
    const vehicle = await service.updateVehicle(req.params.id, req.body);
    res.json({ data: vehicle });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/loading/vehicles/available - 获取可用车辆
router.get('/vehicles/available', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const maxWeight = req.query.max_weight ? Number(req.query.max_weight) : undefined;
    const maxVolume = req.query.max_volume ? Number(req.query.max_volume) : undefined;

    const service = new LoadingService(tenantId);
    const vehicles = await service.getAvailableVehicles(maxWeight, maxVolume);
    res.json({ data: vehicles });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================================================
// 装车任务
// =====================================================================

// GET /api/loading/tasks - 获取装车任务列表
router.get('/tasks', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const vehicleId = req.query.vehicle_id as string | undefined;
    const waveId = req.query.wave_id as string | undefined;
    const status = req.query.status as string | undefined;

    const service = new LoadingService(tenantId);
    const tasks = await service.getLoadingTasks(vehicleId, waveId, status);
    res.json({ data: tasks });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/loading/tasks - 创建装车任务
router.post('/tasks', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const data = { ...req.body, tenant_id: tenantId };

    const service = new LoadingService(tenantId);
    const task = await service.createLoadingTask(data);
    res.status(201).json({ data: task });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/loading/tasks/plan - 规划装车
router.post('/tasks/plan', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { wave_id, vehicle_id, loader_id } = req.body;

    if (!wave_id || !vehicle_id) {
      return res.status(400).json({ error: 'wave_id and vehicle_id required' });
    }

    const service = new LoadingService(tenantId);
    const task = await service.planLoading({ wave_id, vehicle_id, loader_id });
    res.status(201).json({ data: task });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/loading/tasks/:id - 获取单个装车任务
router.get('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new LoadingService(tenantId);
    const task = await service.getLoadingTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ data: task });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/loading/tasks/:id/start - 开始装车
router.post('/tasks/:id/start', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    const service = new LoadingService(tenantId);
    const task = await service.startLoading(req.params.id, userId);
    res.json({ data: task });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/loading/tasks/:id/complete - 完成装车
router.post('/tasks/:id/complete', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { actual_weight, actual_volume } = req.body;
    const service = new LoadingService(tenantId);
    const task = await service.completeLoading(req.params.id, actual_weight, actual_volume);
    res.json({ data: task });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/loading/tasks/:id/seal - 封车
router.post('/tasks/:id/seal', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { seal_no } = req.body;
    if (!seal_no) {
      return res.status(400).json({ error: 'seal_no required' });
    }
    const service = new LoadingService(tenantId);
    const task = await service.sealLoading(req.params.id, seal_no);
    res.json({ data: task });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/loading/tasks/:id/depart - 发车
router.post('/tasks/:id/depart', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new LoadingService(tenantId);
    const task = await service.departVehicle(req.params.id);
    res.json({ data: task });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/loading/tasks/:id/arrive - 到达
router.post('/tasks/:id/arrive', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new LoadingService(tenantId);
    const task = await service.arriveVehicle(req.params.id);
    res.json({ data: task });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================================================
// 交接单/发运单据
// =====================================================================

// GET /api/loading/documents - 获取发运单据
router.get('/documents', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const taskId = req.query.task_id as string | undefined;

    const service = new LoadingService(tenantId);
    const docs = await service.getShippingDocs(taskId);
    res.json({ data: docs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/loading/documents - 生成发运单据
router.post('/documents', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const data = { ...req.body, tenant_id: tenantId };

    const service = new LoadingService(tenantId);
    const doc = await service.generateShippingDoc(data);
    res.status(201).json({ data: doc });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/loading/documents/:id/print - 打印单据
router.post('/documents/:id/print', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new LoadingService(tenantId);
    const result = await service.printDocument(req.params.id);
    res.json({ data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/loading/documents/:id/sign - 签收单据
router.post('/documents/:id/sign', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    const service = new LoadingService(tenantId);
    const doc = await service.signDocument(req.params.id, userId);
    res.json({ data: doc });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================================================
// 载重校验
// =====================================================================

// POST /api/loading/validate - 校验载重
router.post('/validate', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { vehicle_id, planned_weight, planned_volume } = req.body;

    if (!vehicle_id || planned_weight === undefined || planned_volume === undefined) {
      return res.status(400).json({ error: 'vehicle_id, planned_weight, planned_volume required' });
    }

    const service = new LoadingService(tenantId);
    const result = await service.validateLoad(vehicle_id, planned_weight, planned_volume);
    res.json({ data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================================================
// 装载顺序优化
// =====================================================================

// POST /api/loading/optimize-sequence - 优化装载顺序
router.post('/optimize-sequence', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { items, vehicle_id } = req.body;

    if (!items || !Array.isArray(items) || !vehicle_id) {
      return res.status(400).json({ error: 'items array and vehicle_id required' });
    }

    const service = new LoadingService(tenantId);
    const sequence = await service.optimizeLoadSequence(items, vehicle_id);
    res.json({ data: sequence });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;