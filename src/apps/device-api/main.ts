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
import express, { Request, Response, NextFunction } from 'express';
import { createDeviceApiDependencies } from './di';
import { createDeviceApiRouter } from './routes';
import { loadDeviceApiConfig } from './config';

export interface DeviceApiConfig {
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey: string;
  };
  server: {
    port: number;
    host: string;
  };
  device: {
    jwtSecret: string;
    jwtIssuer: string;
    jwtAudience: string;
  };
}

export async function createDeviceApiApp(config: DeviceApiConfig): Promise<express.Application> {
  const deps = await createDeviceApiDependencies();

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // 全局中间件
  app.use(deps.middlewareFactory.correlationId());
  app.use(deps.middlewareFactory.requestLogger());

  // 健康检查（无需认证）
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'device-api', timestamp: new Date().toISOString() });
  });

  // 设备认证中间件（验证 Device JWT + API Key）
  const deviceAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
      // TODO: 实现设备 JWT 验证逻辑
      // 1. 从 Authorization Header 或 X-Device-Token 解析 token
      // 2. 验证签名、过期时间、issuer、audience
      // 3. 从 token 中提取 device_id, tenant_id, user_id
      // 4. 调用 supabaseAdapters.auth.tenantResolver.resolveTenant(device_id) 验证设备绑定租户
      // 5. 将 device_id, tenant_id, user_id 注入 req.context
      // 6. 设置 RLS 所需的 tenant_id header（由 ExpressMiddlewareFactory 内部处理）

      // 暂时模拟通过
      (req as any).context = {
        deviceId: 'device-test-001',
        tenantId: 'tenant-test-001',
        userId: 'user-test-001',
      };
      next();
    } catch (error) {
      res.status(401).json({ error: 'Device authentication failed' });
    }
  };

  // 受保护路由：设备认证 + 租户上下文注入
  const deviceRouter = express.Router();
  deviceRouter.use(deviceAuthMiddleware);

  // 注入 tenant_id 到请求上下文（供 RLS 使用）
  deviceRouter.use(async (req: Request, _res: Response, next: NextFunction) => {
    const context = (req as any).context;
    if (context?.tenantId) {
      // 设置请求级 tenant_id，供后续 Supabase 查询使用
      req.headers['x-tenant-id'] = context.tenantId;
    }
    next();
  });

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