import { Router } from 'express';
import { SupabaseClient } from '../supabase/SupabaseClient';
const router = Router();
const supabase = new SupabaseClient();
// 库存查询
router.get('/levels', async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { data, error } = await supabase.query('inventory', (q) => q.select('*').eq('tenant_id', req.tenantId));
        if (error)
            throw error;
        res.json({ data });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// 库存更新
router.post('/adjust', async (req, res) => {
    try {
        const { sku, quantity, reason } = req.body;
        const tenantId = req.tenantId;
        const { data, error } = await supabase.rpc('adjust_inventory', {
            p_tenant_id: tenantId,
            p_sku: sku,
            p_quantity: quantity,
            p_reason: reason
        });
        if (error)
            throw error;
        res.json({ data });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// 库存同步任务
router.post('/sync', async (req, res) => {
    try {
        const { data, error } = await supabase.rpc('sync_inventory_from_source', {
            p_tenant_id: req.tenantId
        });
        if (error)
            throw error;
        res.json({ data });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
export default router;
