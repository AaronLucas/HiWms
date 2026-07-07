// src/routes/sorting.ts
// Phase A: 分拣相关 API 路由

import { Router, Request, Response } from 'express';
import { SortingService } from '../services/SortingService';
import { authMiddleware } from '../routes';

const router = Router();
router.use(authMiddleware.handle);

// =====================================================================
// 滑道管理
// =====================================================================

// GET /api/sorting/chutes - 获取滑道列表
router.get('/chutes', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const zoneType = req.query.zone_type as string | undefined;

    const service = new SortingService(tenantId);
    const chutes = await service.getChutes(zoneType);
    res.json({ data: chutes });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sorting/chutes - 创建滑道
router.post('/chutes', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const data = { ...req.body, tenant_id: tenantId };

    const service = new SortingService(tenantId);
    const chute = await service.createChute(data);
    res.status(201).json({ data: chute });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sorting/chutes/:id - 获取单个滑道
router.get('/chutes/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new SortingService(tenantId);
    const chute = await service.getChute(req.params.id);
    if (!chute) return res.status(404).json({ error: 'Chute not found' });
    res.json({ data: chute });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/sorting/chutes/:id - 更新滑道
router.patch('/chutes/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new SortingService(tenantId);
    const chute = await service.updateChute(req.params.id, req.body);
    res.json({ data: chute });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sorting/chutes/assign-container - 分配容器到滑道
router.post('/chutes/assign-container', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { container_id, chute_id, priority } = req.body;
    const service = new SortingService(tenantId);
    await service.assignContainerToChute(container_id, chute_id, priority);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================================================
// 分拣波次管理
// =====================================================================

// GET /api/sorting/waves - 获取分拣波次列表
router.get('/waves', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const waveType = req.query.wave_type as string | undefined;
    const status = req.query.status as string | undefined;

    const service = new SortingService(tenantId);
    const waves = await service.getWaves(waveType, status);
    res.json({ data: waves });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sorting/waves - 创建分拣波次
router.post('/waves', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const data = { ...req.body, tenant_id: tenantId };

    const service = new SortingService(tenantId);
    const wave = await service.createWave(data);
    res.status(201).json({ data: wave });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sorting/waves/:id - 获取单个波次
router.get('/waves/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new SortingService(tenantId);
    const wave = await service.getWave(req.params.id);
    if (!wave) return res.status(404).json({ error: 'Wave not found' });
    res.json({ data: wave });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sorting/waves/:id/start - 开始波次
router.post('/waves/:id/start', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new SortingService(tenantId);
    const wave = await service.startWave(req.params.id);
    res.json({ data: wave });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sorting/waves/:id/complete - 完成波次
router.post('/waves/:id/complete', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new SortingService(tenantId);
    const wave = await service.completeWave(req.params.id);
    res.json({ data: wave });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================================================
// 分拣任务管理
// =====================================================================

// GET /api/sorting/waves/:waveId/tasks - 获取波次下的任务
router.get('/waves/:waveId/tasks', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new SortingService(tenantId);
    const tasks = await service.getWaveTasks(req.params.waveId);
    res.json({ data: tasks });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sorting/waves/:waveId/tasks - 批量创建任务
router.post('/waves/:waveId/tasks', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const tasks = req.body.tasks?.map((t: any) => ({ ...t, tenant_id: tenantId, wave_id: req.params.waveId }));
    if (!tasks || !Array.isArray(tasks)) {
      return res.status(400).json({ error: 'tasks array required' });
    }
    const service = new SortingService(tenantId);
    const created = await service.createTasks(tasks);
    res.status(201).json({ data: created });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sorting/tasks/:id - 获取单个任务
router.get('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new SortingService(tenantId);
    const task = await service.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ data: task });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sorting/tasks/:id/assign - 分配任务
router.post('/tasks/:id/assign', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { user_id, chute_id } = req.body;
    const service = new SortingService(tenantId);
    const task = await service.assignTask(req.params.id, req.body.user_id, req.body.chute_id);
    res.json({ data: task });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sorting/tasks/:id/start - 开始任务
router.post('/tasks/:id/start', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    const service = new SortingService(tenantId);
    const task = await service.startTask(req.params.id, userId);
    res.json({ data: task });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sorting/tasks/:id/complete - 完成任务
router.post('/tasks/:id/complete', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    const service = new SortingService(tenantId);
    const task = await service.completeTask(req.params.id, userId);
    res.json({ data: task });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sorting/tasks/:id/exception - 任务异常
router.post('/tasks/:id/exception', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { reason } = req.body;
    const service = new SortingService(tenantId);
    const task = await service.exceptionTask(req.params.id, reason);
    res.json({ data: task });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;