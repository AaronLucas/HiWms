/**
 * Admin API 配置加载
 */
export interface AdminApiConfig {
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey: string;
  };
  server: {
    port: number;
  };
  /** RBAC 模式：compat（isSystemUser 兼容期）/ strict（全 requirePermission） */
  rbacMode: 'compat' | 'strict';
}

export function loadAdminApiConfig(): AdminApiConfig {
  return {
    supabase: {
      url: process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
      anonKey: process.env.SUPABASE_ANON_KEY ?? '',
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    },
    server: {
      port: parseInt(process.env.ADMIN_API_PORT ?? '3002', 10),
    },
    rbacMode: (process.env.ADMIN_API_RBAC_MODE ?? 'compat') as 'compat' | 'strict',
  };
}
