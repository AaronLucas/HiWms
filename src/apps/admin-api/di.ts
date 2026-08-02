/**
 * Admin API 依赖注入配置
 */
import { createSupabaseAdapters, SupabaseAdapters } from '../../adapters/supabase';
import { ExpressMiddlewareFactory } from '../../adapters/express/ExpressMiddlewareFactory';
import { loadAdminApiConfig, type AdminApiConfig } from './config';

export interface AdminApiDependencies {
  config: AdminApiConfig;
  supabaseAdapters: SupabaseAdapters;
  middlewareFactory: ExpressMiddlewareFactory;
}

let _deps: AdminApiDependencies | null = null;

export async function createAdminApiDependencies(overrides?: Partial<AdminApiConfig>): Promise<AdminApiDependencies> {
  const config: AdminApiConfig = { ...loadAdminApiConfig(), ...overrides };

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

  return { config, supabaseAdapters, middlewareFactory };
}

/** 仅测试用：重置缓存的依赖实例 */
export function resetAdminApiDependencies(): void {
  _deps = null;
}
