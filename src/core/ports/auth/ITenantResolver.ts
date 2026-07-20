/**
 * 租户解析器端口接口
 * 从请求上下文中解析租户 ID
 */
export interface ITenantResolver {
  /**
   * 从认证上下文解析租户 ID
   * @param userId 用户 ID
   * @returns 租户 ID（平台管理员可能为 null）
   */
  resolveFromUser(userId: string): Promise<string | null>;

  /**
   * 从请求头/上下文解析租户 ID
   * 用于 HTTP 请求、WebSocket 连接等
   */
  resolveFromRequest(request: {
    headers?: Record<string, string>;
    query?: Record<string, string>;
    user?: { id: string; tenantId?: string };
  }): Promise<string | null>;

  /**
   * 验证租户是否存在且激活
   */
  validateTenant(tenantId: string): Promise<boolean>;

  /**
   * 检查用户是否为平台超管
   * 对应 supabase/migrations/008_storage_management.sql §1 引入的
   * fn_is_platform_admin 概念（is_system_user 或 role = 'platform_admin'）
   */
  isPlatformAdmin(userId: string): Promise<boolean>;
}