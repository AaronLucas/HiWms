import { Router, Request, Response } from 'express';
import { SupabaseClient, createSupabaseClientFromEnv } from '../supabase/SupabaseClient';

const router = Router();
const supabase = createSupabaseClientFromEnv();

type WaveStrategyType = 'TIME_BASED' | 'ORDER_BASED' | 'SKU_BASED' | 'HYBRID';

interface WaveStrategyInput {
  tenant_id: string;
  name: string;
  strategy_type: WaveStrategyType;
  config: {
    // TIME_BASED
    time_window_minutes?: number;
    cutoff_time?: string; // HH:MM
    // ORDER_BASED
    min_orders?: number;
    max_orders?: number;
    priority_threshold?: number;
    // SKU_BASED
    sku_group_by?: 'zone' | 'abc_class' | 'category';
    max_skus_per_wave?: number;
    // 通用
    max_lines_per_wave?: number;
    max_items_per_wave?: number;
    auto_release?: boolean;
  };
  is_active: boolean;
  effective_from: string;
  effective_to?: string;
}

interface WaveReleaseInput {
  tenant_id: string;
  strategy_id?: string;
  order_ids?: string[];
  criteria?: {
    status?: string;
    order_type?: string;
    cutoff_before?: string;
    priority_above?: number;
  };
}

/**
 * 波次策略引擎服务
 */
class WaveStrategyEngine {
  constructor(private supabase: SupabaseClient) {}

  /**
   * 创建波次策略
   */
  async createStrategy(input: WaveStrategyInput) {
    const { data, error } = await this.supabase
      .from('wave_strategies')
      .insert({
        tenant_id: input.tenant_id,
        name: input.name,
        strategy_type: input.strategy_type,
        config: input.config,
        is_active: input.is_active,
        effective_from: input.effective_from,
        effective_to: input.effective_to,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * 获取策略列表
   */
  async listStrategies(tenantId: string, activeOnly = true) {
    let query = this.supabase
      .from('wave_strategies')
      .select('*')
      .eq('tenant_id', tenantId);

    if (activeOnly) query = query.eq('is_active', true);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  /**
   * 根据策略生成波次
   */
  async generateWave(input: WaveReleaseInput): Promise<{ wave_id: string; order_count: number }> {
    const { tenant_id, strategy_id, order_ids, criteria } = input;

    // 1. 获取策略配置
    let strategy: any = null;
    if (strategy_id) {
      const { data } = await this.supabase
        .from('wave_strategies')
        .select('*')
        .eq('id', strategy_id)
        .eq('tenant_id', tenant_id)
        .single();
      strategy = data;
    } else {
      // 使用默认策略
      strategy = { strategy_type: 'HYBRID', config: {} };
    }

    // 2. 查找符合条件的订单
    let ordersQuery = this.supabase
      .from('orders')
      .select('id, status, order_type, cutoff_time, platform_priority, created_at')
      .eq('tenant_id', tenant_id)
      .in('status', ['pending', 'confirmed']);

    if (order_ids && order_ids.length > 0) {
      ordersQuery = ordersQuery.in('id', order_ids);
    } else {
      if (criteria?.status) ordersQuery = ordersQuery.eq('status', criteria.status);
      if (criteria?.order_type) ordersQuery = ordersQuery.eq('order_type', criteria.order_type);
      if (criteria?.cutoff_before) ordersQuery = ordersQuery.lte('cutoff_time', criteria.cutoff_before);
      if (criteria?.priority_above) ordersQuery = ordersQuery.gte('platform_priority', criteria.priority_above);
    }

    const { data: orders, error: ordersError } = await ordersQuery
      .order('platform_priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(strategy?.config?.max_orders || 100);

    if (ordersError) throw ordersError;
    if (!orders || orders.length === 0) {
      throw new Error('No eligible orders found');
    }

    // 3. 根据策略类型分组/排序
    const groupedOrders = this.applyStrategy(strategy, orders);

    // 4. 创建波次
    const waveNo = `W-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    const { data: wave, error: waveError } = await this.supabase
      .from('waves')
      .insert({
        tenant_id: tenant_id,
        wave_no: waveNo,
        status: 'planning',
        strategy_type: strategy?.strategy_type || 'HYBRID',
        strategy_config: strategy?.config,
      })
      .select()
      .single();

    if (waveError) throw waveError;

    // 5. 关联订单到波次
    const mappings = (orders as any[]).map((o: any) => ({
      wave_id: wave.id,
      order_id: o.id,
    }));

    const { error: mappingError } = await this.supabase
      .from('wave_order_mapping')
      .insert(mappings);

    if (mappingError) throw mappingError;

    // 6. 更新订单状态
    await this.supabase
      .from('orders')
      .update({ status: 'allocated', updated_at: new Date().toISOString() })
      .in('id', (orders as any[]).map((o: any) => o.id));

    // 7. 如果配置自动释放，直接转到 picking
    if (strategy?.config?.auto_release) {
      await this.supabase
        .from('waves')
        .update({ status: 'picking' })
        .eq('id', wave.id);
    }

    return { wave_id: wave.id, order_count: orders.length };
  }

  private applyStrategy(strategy: any, orders: any[]): any[] {
    const config = strategy?.config || {};
    const type = strategy?.strategy_type || 'HYBRID';

    switch (type) {
      case 'TIME_BASED':
        // 时间窗口：按创建时间分桶
        return this.groupByTimeWindow(orders, config.time_window_minutes || 30);

      case 'ORDER_BASED':
        // 订单数量：按优先级和数量分组
        return this.groupByOrderCount(orders, config.max_orders || 50);

      case 'SKU_BASED':
        // SKU 维度：需要查询订单行项，这里简化
        return orders;

      case 'HYBRID':
      default:
        // 混合：优先级 > 时间 > SKU 区域
        return orders.sort((a, b) => {
          // 1. 优先级降序
          if (b.platform_priority !== a.platform_priority) return b.platform_priority - a.platform_priority;
          // 2. 截单时间升序
          if (a.cutoff_time && b.cutoff_time) return new Date(a.cutoff_time).getTime() - new Date(b.cutoff_time).getTime();
          // 3. 创建时间升序
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });
    }
  }

  private groupByTimeWindow(orders: any[], windowMinutes: number): any[] {
    // 简化：直接返回排序后的数组
    return orders;
  }

  private groupByOrderCount(orders: any[], maxOrders: number): any[] {
    return orders.slice(0, maxOrders);
  }
}

// 初始化引擎
const waveEngine = new WaveStrategyEngine(supabase);

/**
 * @swagger
 * /api/wave-strategies:
 *   post:
 *     summary: 创建波次策略
 *     tags: [Wave Strategy]
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string || req.body.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'Missing tenant_id' });

    const strategy = await waveEngine.createStrategy({ ...req.body, tenant_id: tenantId });
    res.status(201).json({ data: strategy });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/wave-strategies:
 *   get:
 *     summary: 获取波次策略列表
 *     tags: [Wave Strategy]
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId) return res.status(400).json({ error: 'Missing tenant_id' });

    const activeOnly = req.query.active_only !== 'false';
    const strategies = await waveEngine.listStrategies(tenantId, activeOnly);
    res.json({ data: strategies });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/wave-strategies/{id}:
 *   get:
 *     summary: 获取单个波次策略
 *     tags: [Wave Strategy]
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('wave_strategies')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Strategy not found' });

    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/wave-strategies/{id}:
 *   patch:
 *     summary: 更新波次策略
 *     tags: [Wave Strategy]
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const updates: any = { updated_at: new Date().toISOString() };
    if (req.body.name) updates.name = req.body.name;
    if (req.body.strategy_type) updates.strategy_type = req.body.strategy_type;
    if (req.body.config) updates.config = req.body.config;
    if (req.body.is_active !== undefined) updates.is_active = req.body.is_active;
    if (req.body.effective_from) updates.effective_from = req.body.effective_from;
    if (req.body.effective_to) updates.effective_to = req.body.effective_to;

    const { data, error } = await supabase
      .from('wave_strategies')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/wave-strategies/{id}:
 *   delete:
 *     summary: 删除/停用波次策略
 *     tags: [Wave Strategy]
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    // 软删除：设置 is_active = false
    const { data, error } = await supabase
      .from('wave_strategies')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/waves/generate:
 *   post:
 *     summary: 根据策略生成波次（核心接口）
 *     tags: [Wave Strategy]
 */
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string || req.body.tenant_id;
    if (!tenantId) return res.status(400).json({ error: 'Missing tenant_id' });

    const result = await waveEngine.generateWave({
      tenant_id: tenantId,
      strategy_id: req.body.strategy_id,
      order_ids: req.body.order_ids,
      criteria: req.body.criteria,
    });

    res.json({ data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/waves:
 *   get:
 *     summary: 查询波次列表
 *     tags: [Wave Strategy]
 */
router.get('/waves', async (req: Request, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId) return res.status(400).json({ error: 'Missing tenant_id' });

    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.page_size as string) || 20;
    const status = req.query.status as string;

    let query = supabase
      .from('waves')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId);

    if (status) query = query.eq('status', status);

    query = query
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ data: data || [], pagination: { page, pageSize, total: count || 0 } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;