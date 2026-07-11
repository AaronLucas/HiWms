/**
 * 平台超管后台 API 入口
 * 管理端点：/api/admin/*
 * 中间件：认证 + 超管权限检查 + 审计日志
 * 不注入 RLS（平台级访问）
 */
import express, { Request, Response } from 'express';
import { ExpressMiddlewareFactory } from '../../adapters/express/ExpressMiddlewareFactory';
import { createSupabaseAdapters } from '../../adapters/supabase';

interface AdminApiConfig {
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey: string; // 管理 API 需要 service role
  };
}

export async function createAdminApiApp(config: AdminApiConfig): Promise<express.Application> {
  const app = express();

  app.use(express.json({ limit: '10mb' }));

  // 初始化 Supabase 适配器（使用 service role）
  const supabaseAdapters = createSupabaseAdapters({
    url: config.supabase.url,
    anonKey: config.supabase.anonKey,
    serviceRoleKey: config.supabase.serviceRoleKey,
  });

  // 创建中间件工厂
  const middlewareFactory = new ExpressMiddlewareFactory(
    supabaseAdapters.auth.provider,
    supabaseAdapters.auth.permissionChecker,
    supabaseAdapters.auth.tenantResolver,
    supabaseAdapters.cache.provider,
    supabaseAdapters.cache.keyBuilder
  );

  // 全局中间件
  app.use(middlewareFactory.correlationId());

  // 健康检查
  app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'admin-api', timestamp: new Date().toISOString() });
  });

  // 登录（平台管理员）
  app.post('/auth/login', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      const result = await supabaseAdapters.auth.provider.signIn(email, password);
      if (!result) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      // 验证是否为平台超管
      const isAdmin = await supabaseAdapters.auth.tenantResolver.isPlatformAdmin(result.user.id);
      if (!isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // 受保护路由：认证 + 超管权限 + 审计
  const adminRouter = express.Router();
  adminRouter.use(middlewareFactory.authenticate());
  adminRouter.use(async (req: Request, res: Response, next: any) => {
    // 检查平台超管权限
    if (!req.context?.user?.isSystemUser) {
      return res.status(403).json({ error: 'Platform admin required' });
    }
    next();
  });

  // 租户管理
  adminRouter.get('/tenants', async (req: Request, res: Response) => {
    try {
      const tenants = await supabaseAdapters.repositories.tenants.findActive();
      res.json({ data: tenants });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch tenants' });
    }
  });

  adminRouter.post('/tenants', async (req: Request, res: Response) => {
    try {
      const tenant = await supabaseAdapters.repositories.tenants.create(req.body as any);
      res.status(201).json(tenant);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create tenant' });
    }
  });

  adminRouter.get('/tenants/:id', async (req: Request, res: Response) => {
    try {
      const tenant = await supabaseAdapters.repositories.tenants.findById(req.params.id);
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
      res.json(tenant);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch tenant' });
    }
  });

  adminRouter.patch('/tenants/:id', async (req: Request, res: Response) => {
    try {
      const tenant = await supabaseAdapters.repositories.tenants.update(req.params.id, req.body as any);
      res.json(tenant);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update tenant' });
    }
  });

  // 用户管理（跨租户）
  adminRouter.get('/users', async (req: Request, res: Response) => {
    try {
      // 使用 admin client 查询所有用户
      const { data, error } = await supabaseAdapters.client.getAdminClient()
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      res.json({ data: data || [] });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  // 计费管理
  adminRouter.get('/billing/rules', async (req: Request, res: Response) => {
    try {
      const { data, error } = await supabaseAdapters.client.getAdminClient()
        .from('billing_rules')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      res.json({ data: data || [] });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch billing rules' });
    }
  });

  // 系统监控
  adminRouter.get('/monitoring/stats', async (req: Request, res: Response) => {
    try {
      // 获取各租户统计
      const { data: tenants } = await supabaseAdapters.client.getAdminClient()
        .from('tenants')
        .select('id, name, is_active');

      res.json({ tenants: tenants?.length || 0, active: tenants?.filter(t => t.is_active).length || 0 });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  app.use('/api/admin', adminRouter);

  // 错误处理
  app.use(middlewareFactory.errorHandler());

  return app;
}

export async function startAdminApiServer(config: AdminApiConfig, port: number = 3002): Promise<void> {
  const app = await createAdminApiApp(config);
  app.listen(port, () => {
    console.log(`Admin API server running on port ${port}`);
  });
}