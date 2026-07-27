/**
 * Tenant API 配置
 * 租户端 API 服务（前端调用）
 */
export interface TenantApiConfig {
  supabase: {
    url: string;
    anonKey: string;
    /** 租户 API 走用户 JWT + RLS，正常运行不需要 service_role key；仅在显式配置时启用（供未来管理类操作使用） */
    serviceRoleKey?: string;
  };
  server: {
    port: number;
    host: string;
  };
}

export function loadTenantApiConfig(): TenantApiConfig {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const port = parseInt(process.env.TENANT_API_PORT || '3004', 10);
  const host = process.env.TENANT_API_HOST || '0.0.0.0';

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing required Supabase environment variables (SUPABASE_URL, SUPABASE_ANON_KEY)');
  }

  return {
    supabase: {
      url: supabaseUrl,
      anonKey: supabaseAnonKey,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    server: { port, host },
  };
}
