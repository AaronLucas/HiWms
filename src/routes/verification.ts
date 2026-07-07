// src/routes/verification.ts
// Phase A: 验货/质检 API 路由

import { Router, Request, Response } from 'express';
import { VerificationService } from '../services/VerificationService';
import { authMiddleware } from '../routes';

const router = Router();
router.use(authMiddleware.handle);

// =====================================================================
// 验货规则
// =====================================================================

// GET /api/verification/rules - 获取规则列表
router.get('/rules', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const skuId = req.query.sku_id as string | undefined;

    const service = new VerificationService(tenantId);
    const rules = await service.getRules(skuId);
    res.json({ data: rules });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/verification/rules - 创建规则
router.post('/rules', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const data = { ...req.body, tenant_id: tenantId };

    const service = new VerificationService(tenantId);
    const rule = await service.createRule(data);
    res.status(201).json({ data: rule });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/verification/rules/:id - 获取单个规则
router.get('/rules/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new VerificationService(tenantId);
    const rule = await service.getRule(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json({ data: rule });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================================================
// 质检单管理
// =====================================================================

// GET /api/verification/inspections - 获取质检单列表
router.get('/inspections', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const type = req.query.type as string | undefined;
    const status = req.query.status as string | undefined;
    const startDate = req.query.start_date as string | undefined;
    const endDate = req.query.end_date as string | undefined;

    const service = new VerificationService(tenantId);
    const inspections = await service.getInspections(type, status, startDate, endDate);
    res.json({ data: inspections });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/verification/inspections - 创建质检单
router.post('/inspections', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const data = { ...req.body, tenant_id: tenantId };

    const service = new VerificationService(tenantId);
    const inspection = await service.createInspection(data);
    res.status(201).json({ data: inspection });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/verification/inspections/:id - 获取单个质检单
router.get('/inspections/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new VerificationService(tenantId);
    const inspection = await service.getInspection(req.params.id);
    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });
    res.json({ data: inspection });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/verification/inspections/:id/start - 开始质检
router.post('/inspections/:id/start', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    const service = new VerificationService(tenantId);
    const inspection = await service.startInspection(req.params.id, userId);
    res.json({ data: inspection });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/verification/inspections/:id/complete - 完成质检
router.post('/inspections/:id/complete', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    const { result } = req.body; // PASSED | FAILED | REWORK

    if (!['PASSED', 'FAILED', 'REWORK'].includes(result)) {
      return res.status(400).json({ error: 'Invalid result value' });
    }

    const service = new VerificationService((req as any).tenantId);
    const inspection = await service.completeInspection(req.params.id, result, (req as any).userId);
    res.json({ data: inspection });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/verification/inspections/:id/items - 获取检查项
router.get('/inspections/:id/items', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const service = new VerificationService(tenantId);
    const items = await service.getInspectionItems(req.params.id);
    res.json({ data: items });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/verification/items/:id/result - 记录检查项结果
router.post('/items/:id/result', async (req: Request, res: Response) => {
  try {
    const { actual_value, result } = req.body;
    if (!['PASS', 'FAIL', 'WARNING'].includes(result)) {
      return res.status(400).json({ error: 'Invalid result value' });
    }

    const tenantId = (req as any).tenantId;
    const service = new VerificationService(tenantId);
    const item = await service.recordItemResult(req.params.id, actual_value, result);
    res.json({ data: item });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================================================
// 复检流程
// =====================================================================

// POST /api/verification/inspections/:id/rework - 创建复检
router.post('/inspections/:id/rework', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { reason } = req.body;

    const service = new VerificationService(tenantId);
    const rework = await service.createReworkInspection(req.params.id, reason);
    res.status(201).json({ data: rework });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;