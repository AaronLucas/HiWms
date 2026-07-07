import { Router } from 'express';
import { AuthMiddleware } from '../middleware/AuthMiddleware';
import { RoleManager } from '../services/RoleManager';
import { createSupabaseClientFromEnv } from '../supabase/SupabaseClient';
import inventoryRoutes from './inventory';
import orderRoutes from './orders';
import userRoutes from './users';
import workOrderRoutes from './work-orders';
import replenishmentRoutes from './replenishment';
import reportRoutes from './reports';
import deviceRoutes from './devices';
import waveStrategyRoutes from './wave-strategy';
// Phase A: 履约/发运新增路由
import sortingRoutes from './sorting';
import verificationRoutes from './verification';
import packingRoutes from './packing';
import loadingRoutes from './loading';

const supabase = createSupabaseClientFromEnv();
const roleManager = new RoleManager(supabase);
const authMiddleware = new AuthMiddleware(roleManager, {
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY!,
});

const router = Router();

// 应用认证中间件到所有 /api/* 路由
router.use('/api', authMiddleware.handle);

// 业务路由
router.use('/api/inventory', inventoryRoutes);
router.use('/api/orders', orderRoutes);
router.use('/api/users', userRoutes);
router.use('/api/work-orders', workOrderRoutes);
router.use('/api/replenishment', replenishmentRoutes);
router.use('/api/reports', reportRoutes);
router.use('/api/devices', deviceRoutes);
router.use('/api/waves', waveStrategyRoutes);

// Phase A: 履约/发运路由
router.use('/api/sorting', sortingRoutes);
router.use('/api/verification', verificationRoutes);
router.use('/api/packing', packingRoutes);
router.use('/api/loading', loadingRoutes);

// 健康检查
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export { authMiddleware };
export default router;