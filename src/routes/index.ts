import { Router } from 'express';
import { AuthMiddleware } from '../middleware/AuthMiddleware';
import { RoleManager } from '../services/RoleManager';
import { createSupabaseClientFromEnv } from '../supabase/SupabaseClient';
import inventoryRoutes from './inventory';
import orderRoutes from './orders';
import userRoutes from './users';

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

// 健康检查
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;