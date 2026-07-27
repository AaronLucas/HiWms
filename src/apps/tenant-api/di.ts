/**
 * Tenant API 依赖注入配置
 * 组装 Supabase 适配器、中间件（认证走标准 Supabase 用户 JWT）
 */
import { createSupabaseAdapters, SupabaseAdapters } from '../../adapters/supabase';
import { ExpressMiddlewareFactory } from '../../adapters/express/ExpressMiddlewareFactory';
import { loadTenantApiConfig } from './config';

export interface TenantApiDependencies {
  config: ReturnType<typeof loadTenantApiConfig>;
  supabaseAdapters: SupabaseAdapters;
  middlewareFactory: ExpressMiddlewareFactory;
}

export async function createTenantApiDependencies(): Promise<TenantApiDependencies> {
  const config = loadTenantApiConfig();

  // 租户 API 默认不持有 service_role key：业务数据访问全部走用户 JWT + RLS（ADR-015）
  const supabaseAdapters = createSupabaseAdapters({
    url: config.supabase.url,
    anonKey: config.supabase.anonKey,
    serviceRoleKey: config.supabase.serviceRoleKey,
  });

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
