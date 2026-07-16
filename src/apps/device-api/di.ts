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

export async function createDeviceApiDependencies(): Promise<DeviceApiDependencies> {
  const config = loadDeviceApiConfig();

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