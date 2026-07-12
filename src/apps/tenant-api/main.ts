/**
 * 租户 Web API 入口
 * 租户业务端点：/api/v1/*
 * 中间件：认证 + RLS + 租户解析 + 权限检查
 */
import express, { Request, Response, NextFunction } from 'express';
import { ExpressMiddlewareFactory } from '../../adapters/express/ExpressMiddlewareFactory';
import { SupabaseClient } from '../../adapters/supabase/SupabaseClient';
import { createSupabaseAdapters } from '../../adapters/supabase';
import { createCloudflareAdapters } from '../../adapters/cloudflare/CloudflareAdapters';

// 导入路由
import { createTenantRoutes } from './routes';

interface TenantApiConfig {
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey?: string;
  };
  cache?: {
    provider: 'memory' | 'redis' | 'cloudflare';
    redisUrl?: string;
    cloudflareKv?: any;
  };
}

export async function createTenantApiApp(config: TenantApiConfig): Promise<express.Application> {
  const app = express();

  // 基础中间件
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 初始化 Supabase 适配器
  const supabaseAdapters = createSupabaseAdapters({
    url: config.supabase.url,
    anonKey: config.supabase.anonKey,
    serviceRoleKey: config.supabase.serviceRoleKey,
  });

  // 初始化缓存
  let cacheProvider;
  let cacheKeyBuilder;
  if (config.cache?.provider === 'cloudflare' && config.cache.cloudflareKv) {
    const cfAdapters = createCloudflareAdapters({ KV_CACHE: config.cache.cloudflareKv });
    cacheProvider = cfAdapters.cache.provider;
    cacheKeyBuilder = cfAdapters.cache.keyBuilder;
  } else {
    cacheProvider = supabaseAdapters.cache.provider;
    cacheKeyBuilder = supabaseAdapters.cache.keyBuilder;
  }

  // 创建中间件工厂
  const middlewareFactory = new ExpressMiddlewareFactory(
    supabaseAdapters.auth.provider,
    supabaseAdapters.auth.permissionChecker,
    supabaseAdapters.auth.tenantResolver,
    cacheProvider,
    cacheKeyBuilder
  );

  // 全局中间件
  app.use(middlewareFactory.correlationId());

  // 健康检查（无需认证）
  app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'tenant-api', timestamp: new Date().toISOString() });
  });

  // 认证路由（登录、刷新令牌）
  app.post('/auth/login', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      const result = await supabaseAdapters.auth.provider.signIn(email, password);
      if (!result) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Login failed' });
    }
  });

  app.post('/auth/refresh', async (req: Request, res: Response) => {
    try {
      const { refreshToken } = req.body;
      const result = await supabaseAdapters.auth.provider.refreshToken(refreshToken);
      if (!result) {
        return res.status(401).json({ error: 'Invalid refresh token' });
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Token refresh failed' });
    }
  });

  // 受保护路由：需要认证 + 租户解析 + RLS
  const protectedRouter = express.Router();
  protectedRouter.use(middlewareFactory.authenticate());
  protectedRouter.use(middlewareFactory.resolveTenant());
  protectedRouter.use(middlewareFactory.injectRlsContext());

  // 注册租户业务路由
  const tenantRoutes = createTenantRoutes({
    repositories: supabaseAdapters.repositories,
    rpc: supabaseAdapters.rpc,
    workflowEngine: supabaseAdapters.workflowEngine, // 需要创建
  });
  protectedRouter.use('/v1', tenantRoutes);

  // 权限检查示例：需要特定权限的路由
  protectedRouter.get('/v1/admin-only', middlewareFactory.requirePermission('admin', 'manage'), (req: Request, res: Response) => {
    res.json({ message: 'Admin access granted' });
  });

  app.use('/api', protectedRouter);

  // 错误处理
  app.use(middlewareFactory.errorHandler());

  // 404 处理
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found', path: req.path });
  });

  return app;
}

/** 启动租户 API 服务器 */
export async function startTenantApiServer(config: TenantApiConfig, port: number = 3001): Promise<void> {
  const app = await createTenantApiApp(config);
  app.listen(port, () => {
    console.log(`Tenant API server running on port ${port}`);
  });
}