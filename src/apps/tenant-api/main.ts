/**
 * 租户端 API 入口 (前端调用)
 * 端点：/api/*
 * 中间件：Supabase 用户 JWT 认证 + 租户解析 + RLS 上下文注入
 * RLS：认证中间件验证标准 Supabase session token，
 *      injectRlsContext 挂载 token 供仓储层 getAuthenticatedClient(token) 使用（ADR-015）
 *
 * 此文件将被以下方式调用：
 * - 直接运行: `ts-node src/apps/tenant-api/main.ts` (开发环境)
 * - 编译后: `node dist/apps/tenant-api/main.js` (生产环境)
 * - 无其他文件导入此文件（入口文件）
 */
import express, { Request, Response, Express } from 'express';
import { createTenantApiDependencies } from './di';
import { createTenantApiRouter } from './routes';
import { loadTenantApiConfig, type TenantApiConfig } from './config';
import { createCorsMiddleware } from '../../adapters/express/corsConfig';
import { loginBodySchema, validateBody, type LoginBody } from './validation';

export async function createTenantApiApp(_config: TenantApiConfig): Promise<Express> {
  const deps = await createTenantApiDependencies();

  const app = express();
  app.use(createCorsMiddleware('TENANT_API_ALLOWED_ORIGINS'));
  app.use(express.json({ limit: '10mb' }));

  // 全局中间件
  app.use(deps.middlewareFactory.correlationId());

  // 健康检查（无需认证）
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'tenant-api', timestamp: new Date().toISOString() });
  });

  /**
   * 登录（租户用户）——方案 B：tenant-api 自己代理登录请求，不让前端直连 Supabase
   * Auth，与 admin-api（POST /auth/login）、device-api（POST /device/auth/login）
   * 的现有模式保持一致，换来的是限流/审计/CAPTCHA token 透传都能走统一中间件
   * （ROADMAP 6.2，2026-08-01 与项目负责人确认选此方案）。
   */
  app.post(
    '/auth/login',
    deps.middlewareFactory.rateLimit({ windowMs: 15 * 60 * 1000, maxRequests: 5 }),
    validateBody(loginBodySchema),
    async (req: Request, res: Response) => {
      try {
        const { email, password, captchaToken } = req.body as LoginBody;
        const result = await deps.supabaseAdapters.auth.provider.signIn(email, password, captchaToken);
        if (!result) {
          return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        res.json({ success: true, data: result });
      } catch (error) {
        res.status(500).json({ success: false, error: 'Login failed' });
      }
    }
  );

  // 受保护路由：Supabase 用户 JWT 认证 + 租户解析 + RLS token 注入
  const apiRouter = express.Router();
  apiRouter.use(deps.middlewareFactory.authenticate());
  apiRouter.use(deps.middlewareFactory.resolveTenant());
  apiRouter.use(deps.middlewareFactory.injectRlsContext());

  // 挂载业务路由
  apiRouter.use('/', createTenantApiRouter(deps));

  app.use('/api', apiRouter);

  // 错误处理
  app.use(deps.middlewareFactory.errorHandler());

  return app;
}

export async function startTenantApiServer(config: TenantApiConfig, port: number = 3004): Promise<void> {
  const app = await createTenantApiApp(config);
  app.listen(port, () => {
    console.log(`Tenant API server running on port ${port}`);
  });
}

// 直接运行时启动服务器
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadTenantApiConfig();
  startTenantApiServer(config, config.server.port).catch(console.error);
}

export { loadTenantApiConfig };
