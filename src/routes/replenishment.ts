import { Router, Request, Response } from 'express';
import { SupabaseClient, createSupabaseClientFromEnv } from '../supabase/SupabaseClient';
import { ReplenishmentScheduler } from '../services/ReplenishmentScheduler';
import { WorkOrderService } from '../services/WorkOrderService';

const router = Router();
const supabase = createSupabaseClientFromEnv();
const workOrderService = new WorkOrderService(supabase);

// 调度器实例（单例模式）
let scheduler: ReplenishmentScheduler | null = null;

function getScheduler(): ReplenishmentScheduler {
  if (!scheduler) {
    scheduler = new ReplenishmentScheduler(supabase, workOrderService, {
      intervalMinutes: 15,
      tenantId: undefined, // 将在请求时动态设置
      rules: {
        minFillRatePct: 20,
        maxFillRatePct: 80,
        minReplenishQty: 1,
        maxReplenishQty: 0,
        priority: 50,
        allowedZoneTypes: ['STORAGE', 'BULK'],
        excludeZoneTypes: ['DAMAGE', 'QC'],
      },
      enabled: true,
    });
  }
  return scheduler;
}

/**
 * @swagger
 * /api/replenishment/trigger:
 *   post:
 *     summary: 手动触发补货调度
 *     tags: [Replenishment]
 */
router.post('/trigger', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string || req.body.tenant_id;
    if (!tenantId) {
      return res.status(400).json({ error: 'Missing tenant_id' });
    }

    const s = getScheduler();
    // 临时覆盖租户ID
    (s as any).config.tenantId = tenantId;

    const result = await s.trigger();
    res.json({ data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/replenishment/start:
 *   post:
 *     summary: 启动补货调度器（定时任务）
 *     tags: [Replenishment]
 */
router.post('/start', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string || req.body.tenant_id;
    const intervalMinutes = parseInt(req.body.interval_minutes as string) || 15;

    if (!tenantId) {
      return res.status(400).json({ error: 'Missing tenant_id' });
    }

    const s = getScheduler();
    (s as any).config.tenantId = tenantId;
    (s as any).config.intervalMinutes = intervalMinutes;

    s.start();
    res.json({ data: { message: 'Scheduler started', status: s.getStatus() } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/replenishment/stop:
 *   post:
 *     summary: 停止补货调度器
 *     tags: [Replenishment]
 */
router.post('/stop', async (req: Request, res: Response) => {
  try {
    const s = getScheduler();
    s.stop();
    res.json({ data: { message: 'Scheduler stopped', status: s.getStatus() } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/replenishment/status:
 *   get:
 *     summary: 获取调度器状态
 *     tags: [Replenishment]
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const s = getScheduler();
    res.json({ data: s.getStatus() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/replenishment/needs:
 *   get:
 *     summary: 查看当前补货需求（不执行调度）
 *     tags: [Replenishment]
 */
router.get('/needs', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'Missing tenant_id' });
    }

    // 直接查询 v_replenishment_needs 视图
    const { data, error } = await supabase
      .from('v_replenishment_needs')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('fill_rate_pct', { ascending: true });

    if (error) throw error;

    res.json({ data: data || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/replenishment/config:
 *   get:
 *     summary: 获取补货规则配置
 *     tags: [Replenishment]
 */
router.get('/config', async (req: Request, res: Response) => {
  try {
    const s = getScheduler();
    res.json({ data: s.getStatus() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/replenishment/config:
 *   put:
 *     summary: 更新补货规则配置
 *     tags: [Replenishment]
 */
router.put('/config', async (req: Request, res: Response) => {
  try {
    const s = getScheduler();
    const rules = req.body.rules;
    if (rules) {
      (s as any).config.rules = { ...(s as any).config.rules, ...rules };
    }
    if (req.body.interval_minutes) {
      (s as any).config.intervalMinutes = parseInt(req.body.interval_minutes);
    }
    if (req.body.enabled !== undefined) {
      (s as any).config.enabled = req.body.enabled;
    }
    res.json({ data: { message: 'Config updated', config: (s as any).config } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;