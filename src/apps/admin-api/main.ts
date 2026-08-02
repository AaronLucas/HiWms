/**
 * 平台超管后台 API 入口
 * 端点：/api/admin/*
 *
 * ROADMAP 5.2 重构（2026-08-03）：
 * - 拆分 config / di / routes / validation 分层
 * - strict 模式：全 requirePermission(resource, action, 'platform')
 * - compat 模式（默认）：沿用 isSystemUser，DBA 种子数据就绪后切换
 * - 响应 envelope 统一为 {success, data} / {success: false, error}
 * - login 路由接入 rateLimit + zod 校验 + 错误日志
 */
import express, { Request, Response, Express } from 'express';
import { createCorsMiddleware } from '../../adapters/express/corsConfig';
import { createAdminApiDependencies } from './di';
import { createAdminRouter } from './routes';
import { loadAdminApiConfig, type AdminApiConfig } from './config';

export async function createAdminApiApp(configOverrides?: Partial<AdminApiConfig>): Promise<Express> {
  const deps = await createAdminApiDependencies(configOverrides);

  const app = express();

  app.use(createCorsMiddleware('ADMIN_API_ALLOWED_ORIGINS'));
  app.use(express.json({ limit: '10mb' }));

  // 全局中间件
  app.use(deps.middlewareFactory.correlationId());

  // 健康检查（无需认证）
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ success: true, data: { status: 'ok', service: 'admin-api', timestamp: new Date().toISOString() } });
  });

  // 挂载路由（包含登录 + 受保护的 admin 路由）
  app.use('/api/admin', createAdminRouter(deps));

  // 错误处理
  app.use(deps.middlewareFactory.errorHandler());

  return app;
}

export async function startAdminApiServer(config: AdminApiConfig, port?: number): Promise<void> {
  const app = await createAdminApiApp(config);
  const actualPort = port ?? config.server.port;
  app.listen(actualPort, () => {
    console.log(`Admin API server running on port ${actualPort} (rbacMode=${config.rbacMode})`);
  });
}

// 直接运行时启动
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadAdminApiConfig();
  startAdminApiServer(cfg, cfg.server.port).catch(console.error);
}

export { loadAdminApiConfig };
