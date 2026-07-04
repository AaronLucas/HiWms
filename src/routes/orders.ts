import { Router, Request, Response } from 'express';
import { SupabaseClient } from '../supabase/SupabaseClient';

const router = Router();
const supabase = new SupabaseClient();

// 创建订单
router.post('/', async (req: any, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const orderData = { ...req.body, tenant_id: tenantId, status: 'pending' };

    const { data, error } = await supabase
      .from('orders')
      .insert([orderData])
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 查询订单列表
router.get('/', async (req: any, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { status, page = 1, limit = 20 } = req.query;

    let query = supabase.from('orders').select('*').eq('tenant_id', tenantId);
    if (status) query = query.eq('status', status);
    query = query.range((page - 1) * limit, page * limit - 1).order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 查询单个订单详情
router.get('/:id', async (req: any, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('tenant_id', tenantId)
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Order not found' });
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 更新订单状态
router.patch('/:id/status', async (req: any, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const { status } = req.body;

    const { data, error } = await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;