import { Router, Request, Response } from 'express';
import { SupabaseClient, createSupabaseClientFromEnv } from '../supabase/SupabaseClient';
import { BillingEngine } from '../services/BillingEngine';
import { ActionLogService } from '../services/ActionLogService';
import { WorkOrderService } from '../services/WorkOrderService';

const router = Router();
const supabase = createSupabaseClientFromEnv();
const billingEngine = new BillingEngine(supabase);
const actionLogService = new ActionLogService(supabase);
const workOrderService = new WorkOrderService(supabase);

/**
 * @swagger
 * /api/reports/boss-cockpit:
 *   get:
 *     summary: 老板驾驶舱 - 人效、异常率、单量 KPI
 *     tags: [Reports]
 *     parameters:
 *       - in: query
 *         name: tenant_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: date_from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: date_to
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: 驾驶舱数据
 */
router.get('/boss-cockpit', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'Missing tenant_id' });
    }

    const dateFrom = req.query.date_from ? new Date(req.query.date_from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateTo = req.query.date_to ? new Date(req.query.date_to as string) : new Date();

    // 使用 v_boss_management_cockpit 视图
    const { data, error } = await supabase
      .from('v_boss_management_cockpit')
      .select('*')
      .eq('tenant_name', (await supabase.from('tenants').select('name').eq('id', tenantId).single()).data?.name || '');

    if (error) throw error;

    // 补充：如果视图数据为空，回退到实时计算
    let result = data || [];
    if (result.length === 0) {
      const stats = await workOrderService.getStats(tenantId, dateFrom, dateTo);
      result = [{
        tenant_name: (await supabase.from('tenants').select('name').eq('id', tenantId).single()).data?.name || 'Unknown',
        task_type: 'ALL',
        '单量': stats.total,
        '平均响应时长(秒)': stats.avgDurationSeconds,
        '人效PPH': stats.pph,
        '任务异常率': stats.exceptionRate,
      }];
    }

    res.json({
      data: result,
      meta: { tenant_id: tenantId, period: { from: dateFrom.toISOString(), to: dateTo.toISOString() } },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/reports/inventory-aging:
 *   get:
 *     summary: 库龄分析报表
 *     tags: [Reports]
 */
router.get('/inventory-aging', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'Missing tenant_id' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.page_size as string) || 50;
    const agingStatus = req.query.aging_status as string;

    let query = supabase
      .from('v_inventory_aging')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId);

    if (agingStatus) {
      query = query.eq('aging_status', agingStatus);
    }

    query = query
      .order('age_days', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({
      data: data || [],
      pagination: { page, pageSize, total: count || 0 },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/reports/turnover-rate:
 *   get:
 *     summary: 周转率统计
 *     tags: [Reports]
 */
router.get('/turnover-rate', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'Missing tenant_id' });
    }

    const { data, error } = await supabase
      .from('v_turnover_rate')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('turnover_ratio', { ascending: false });

    if (error) throw error;

    res.json({ data: data || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/reports/replenishment-needs:
 *   get:
 *     summary: 补货需求视图
 *     tags: [Reports]
 */
router.get('/replenishment-needs', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'Missing tenant_id' });
    }

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
 * /api/reports/billing-summary:
 *   get:
 *     summary: 计费汇总（指定期间）
 *     tags: [Reports]
 */
router.get('/billing-summary', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'Missing tenant_id' });
    }

    const periodStart = req.query.period_start ? new Date(req.query.period_start as string) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const periodEnd = req.query.period_end ? new Date(req.query.period_end as string) : new Date();

    const { data, error } = await supabase
      .from('billing_transactions')
      .select('fee_type, amount, currency, status, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', periodStart.toISOString())
      .lte('created_at', periodEnd.toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;

    // 汇总
    const summary = (data || []).reduce((acc: any, row: any) => {
      const key = `${row.fee_type}_${row.currency}`;
      if (!acc[key]) {
        acc[key] = { fee_type: row.fee_type, currency: row.currency, total: 0, count: 0, byStatus: {} };
      }
      acc[key].total += Number(row.amount);
      acc[key].count++;
      acc[key].byStatus[row.status] = (acc[key].byStatus[row.status] || 0) + Number(row.amount);
      return acc;
    }, {});

    res.json({
      data: Object.values(summary),
      meta: { tenant_id: tenantId, period: { from: periodStart.toISOString(), to: periodEnd.toISOString() } },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/reports/operator-performance:
 *   get:
 *     summary: 操作员绩效 (PPH、异常率、工时)
 *     tags: [Reports]
 */
router.get('/operator-performance', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string;
    const operatorId = req.query.operator_id as string;
    if (!tenantId || !operatorId) {
      return res.status(400).json({ error: 'Missing tenant_id or operator_id' });
    }

    const dateFrom = req.query.date_from ? new Date(req.query.date_from as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const dateTo = req.query.date_to ? new Date(req.query.date_to as string) : new Date();

    const pph = await actionLogService.calculatePPH(operatorId, dateFrom, dateTo);

    // 获取操作员基本信息
    const { data: user } = await supabase
      .from('users')
      .select('username, full_name, role')
      .eq('id', operatorId)
      .single();

    res.json({
      data: {
        operator: user,
        period: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
        ...pph,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;