/**
 * Device API 依赖注入配置
 * 组装 Supabase 适配器、中间件、认证等
 */
import { createSupabaseAdapters, SupabaseAdapters } from '../../adapters/supabase';
import { ExpressMiddlewareFactory } from '../../adapters/express/ExpressMiddlewareFactory';
import { loadDeviceApiConfig } from './config';

export interface DeviceApiDependencies {
  config: ReturnType<typeof loadDeviceApiConfig>;
  supabaseAdapters: SupabaseAdapters;
  middlewareFactory: ExpressMiddlewareFactory;
}

export async function createDeviceApiDependencies(
  configOverride?: ReturnType<typeof loadDeviceApiConfig>
): Promise<DeviceApiDependencies> {
  // 必须接受调用方传入的 config，不能无条件重新 loadDeviceApiConfig()——main.ts 的
  // createDeviceApiApp(config) 此前就是这样各自独立读取一份，导致 DeviceAuthMiddleware
  // （直接用调用方传入的 config）和 publicAuthRoutes.ts/routes.ts（通过 deps.config，
  // 此前是这里独立 loadDeviceApiConfig() 出来的另一份）在 jwtIssuer/jwtAudience 上可能
  // 不一致，实测导致登录签发的 token 验证恒失败（2026-07-28 经真实 HTTP 测试确认）。
  const config = configOverride ?? loadDeviceApiConfig();

  // 初始化 Supabase 适配器（使用 service role key 绕过 RLS，设备端通过 middleware 注入 tenant_id）
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

  return {
    config,
    supabaseAdapters,
    middlewareFactory,
  };
}