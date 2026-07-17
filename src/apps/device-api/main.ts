/**
 * 设备端 API 入口 (PDA/手持终端)
 * 端点：/api/device/*
 * 中间件：设备认证 + 租户解析 + 速率限制 + 审计日志
 * RLS：通过中间件注入 tenant_id（设备 JWT 携带 tenant_id）
 *
 * 此文件将被以下方式调用：
 * - 直接运行: `ts-node src/apps/device-api/main.ts` (开发环境)
 * - 编译后: `node dist/apps/device-api/main.js` (生产环境)
 * - 无其他文件导入此文件（入口文件）
 */
import express, { Request, Response, NextFunction, Express } from 'express';
import { createDeviceApiDependencies } from './di';
import { createDeviceApiRouter } from './routes';
import { loadDeviceApiConfig, type DeviceApiConfig } from './config';
import { createDeviceAuthMiddleware } from './DeviceAuthMiddleware';

export async function createDeviceApiApp(config: DeviceApiConfig): Promise<Express> {
  const deps = await createDeviceApiDependencies();

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // 全局中间件
  app.use(deps.middlewareFactory.correlationId());
  app.use(deps.middlewareFactory.injectRlsContext());

  // 创建设备认证中间件
  const deviceAuthMiddleware = createDeviceAuthMiddleware(
    deps.supabaseAdapters.client,
    deps.supabaseAdapters.auth.provider,
    deps.supabaseAdapters.auth.tenantResolver,
    {
      jwtSecret: config.device.jwtSecret,
      jwtIssuer: config.device.jwtIssuer,
      jwtAudience: config.device.jwtAudience,
    }
  );

  // 健康检查（无需认证）
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'device-api', timestamp: new Date().toISOString() });
  });

  // 受保护路由：设备认证（JWT 或 API Key）+ 租户上下文注入
  const deviceRouter = express.Router();
  deviceRouter.use(deviceAuthMiddleware.authenticate());

  // 挂载业务路由
  const apiRouter = createDeviceApiRouter(deps);
  deviceRouter.use('/api/device', apiRouter);

  app.use('/', deviceRouter);

  // 错误处理
  app.use(deps.middlewareFactory.errorHandler());

  return app;
}

export async function startDeviceApiServer(config: DeviceApiConfig, port: number = 3003): Promise<void> {
  const app = await createDeviceApiApp(config);
  app.listen(port, () => {
    console.log(`Device API server running on port ${port}`);
  });
}

// 直接运行时启动服务器
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadDeviceApiConfig();
  startDeviceApiServer(config, config.server.port).catch(console.error);
}

export { loadDeviceApiConfig };