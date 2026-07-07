// src/routes/packing.ts
// Phase A: 打包/封箱 API 路由

import { Router, Request, Response } from 'express';
import { PackingService } from '../services/PackingService';
import { authMiddleware } from '../routes';

const router = Router();
router.use(authMiddleware.handle);

// =====================================================================
// 包装规格
// =====================================================================

// GET /api/packing/specs - 获取包装规格列表
router.get('/specs', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new PackingService(tenantId);
    const specs = await service.getPackageSpecs();
    res.json({ data: specs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/packing/specs - 创建包装规格
router.post('/specs', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const data = { ...req.body, tenant_id: tenantId };
    const service = new PackingService(tenantId);
    const spec = await service.createPackageSpec(data);
    res.status(201).json({ data: spec });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/packing/specs/default - 获取默认规格
router.get('/specs/default', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new PackingService(tenantId);
    const spec = await service.getDefaultSpec();
    if (!spec) return res.status(404).json({ error: 'No default spec' });
    res.json({ data: spec });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================================================
// 面单模板
// =====================================================================

// GET /api/packing/templates - 获取面单模板列表
router.get('/templates', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const type = req.query.type as string | undefined;
    const service = new PackingService(tenantId);
    const templates = await service.getLabelTemplates(type);
    res.json({ data: templates });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/packing/templates - 创建面单模板
router.post('/templates', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const data = { ...req.body, tenant_id: tenantId };
    const service = new PackingService(tenantId);
    const template = await service.createLabelTemplate(data);
    res.status(201).json({ data: template });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================================================
// 打包任务
// =====================================================================

// GET /api/packing/tasks - 获取打包任务列表
router.get('/tasks', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const orderId = req.query.order_id as string | undefined;
    const waveId = req.query.wave_id as string | undefined;
    const status = req.query.status as string | undefined;

    const service = new PackingService(tenantId);
    const tasks = await service.getPackingTasks(orderId, waveId, status);
    res.json({ data: tasks });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/packing/tasks - 创建打包任务
router.post('/tasks', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const data = { ...req.body, tenant_id: tenantId };
    const service = new PackingService(tenantId);
    const task = await service.createPackingTask(data);
    res.status(201).json({ data: task });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/packing/tasks/:id - 获取单个打包任务
router.get('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new PackingService(tenantId);
    const task = await service.getPackingTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ data: task });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/packing/tasks/:id/start - 开始打包
router.post('/tasks/:id/start', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    const service = new PackingService(tenantId);
    const task = await service.startPacking(req.params.id, userId);
    res.json({ data: task });
  } catch (error: any) {
    res.status(50000).json({ error: error.message });
  }
});

// POST /api/packing/tasks/:id/items - 添加打包商品
router.post('/tasks/:id/items', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { items } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'items array required' });
    }
    const service = new PackingService(tenantId);
    const task = await service.addPackedItems(req.params.id, items);
    res.json({ data: task });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/packing/tasks/:id/weigh - 称重
router.post('/tasks/:id/weigh', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { weight, volume } = req.body;
    if (weight === undefined) {
      return res.status(400).json({ error: 'weight required' });
    }
    const service = new PackingService(tenantId);
    const task = await service.weighTask(req.params.id, weight, volume);
    res.json({ data: task });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/packing/tasks/:id/label - 打印面单
router.post('/tasks/:id/label', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new PackingService(tenantId);
    const { labelData, trackingNo } = await service.printLabel(req.params.id);
    res.json({ data: { labelData, trackingNo } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/packing/tasks/:id/seal - 封箱
router.post('/tasks/:id/seal', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new PackingService(tenantId);
    const task = await service.sealTask(req.params.id);
    res.json({ data: task });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/packing/tasks/:id/complete - 完成打包
router.post('/tasks/:id/complete', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new PackingService(tenantId);
    const task = await service.completeTask(req.params.id);
    res.json({ data: task });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================================================
// 装箱建议
// =====================================================================

// POST /api/packing/suggest - 获取装箱建议
router.post('/suggest', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { items } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'items array required' });
    }
    const service = new PackingService(tenantId);
    const suggestion = await service.suggestPacking(items);
    res.json({ data: suggestion });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================================================
// 面单模板
// =====================================================================

// POST /api/packing/templates - 创建面单模板
router.post('/templates', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const data = { ...req.body, tenant_id: tenantId };
    const service = new PackingService(tenantId);
    const template = await service.createLabelTemplate(data);
    res.status(201).json({ data: template });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;