/**
 * Supabase 租户解析器实现
 * 从请求上下文中解析租户 ID
 */
import { WmsSupabaseClient } from '@adapters/supabase/SupabaseClient';
import { ITenantResolver } from '@core/ports/auth/ITenantResolver';
import { IPermissionChecker } from '@core/ports/auth/IPermissionChecker';

export class SupabaseTenantResolver implements ITenantResolver {
  constructor(
    private supabase: WmsSupabaseClient,
    private permissionChecker: IPermissionChecker
  ) {}

  private getClient(authToken?: string) {
    return authToken
      ? this.supabase.getAuthenticatedClient(authToken)
      : this.supabase.getClient();
  }

  async resolveFromUser(userId: string, authToken?: string): Promise<string | null> {
    try {
      const { data, error } = await this.getClient(authToken)
        .from('users')
        .select('tenant_id, is_system_user')
        .eq('id', userId)
        .single();

      if (error || !data) return null;

      // 系统用户（平台超管）可能没有租户
      if (data.is_system_user) return null;

      return data.tenant_id ?? null;
    } catch {
      return null;
    }
  }

  async resolveFromRequest(request: {
    headers?: Record<string, string>;
    query?: Record<string, string>;
    user?: { id: string; tenantId?: string };
  }, authToken?: string): Promise<string | null> {
    // 优先级 1：请求头中的租户 ID（用于 API 网关透传）
    if (request.headers?.['x-tenant-id']) {
      const tenantId = request.headers['x-tenant-id'];
      // ROADMAP 4.10: x-tenant-id 需校验当前用户是否属于该租户
      if (await this.validateTenantOwnership(tenantId, request.user?.id, authToken)) {
        return tenantId;
      }
    }

    // 优先级 2：查询参数中的租户 ID
    if (request.query?.tenant_id) {
      const tenantId = request.query.tenant_id;
      if (await this.validateTenantOwnership(tenantId, request.user?.id, authToken)) {
        return tenantId;
      }
    }

    // 优先级 3：已认证用户的租户 ID（从 JWT token 中获取，最可信）
    if (request.user?.tenantId) {
      return request.user.tenantId;
    }

    // 优先级 4：从用户 ID 解析（DB 查询 users.tenant_id）
    if (request.user?.id) {
      return this.resolveFromUser(request.user.id, authToken);
    }

    return null;
  }

  /**
   * 验证租户存在且活跃，同时检查当前用户是否属于该租户。
   * 与 validateTenant() 不同：此方法额外校验 x-tenant-id 头/参数的
   * 调用方是否有权以该租户身份操作（ROADMAP 4.10 ②）。
   */
  private async validateTenantOwnership(
    tenantId: string,
    userId?: string,
    authToken?: string
  ): Promise<boolean> {
    // 先校验租户存在且活跃
    const isActive = await this.validateTenant(tenantId, authToken);
    if (!isActive) return false;

    // 未提供用户上下文时，无法校验归属，仅校验租户有效性
    if (!userId) return true;

    // 平台管理员可以访问任意租户
    const isPlatform = await this.isPlatformAdmin(userId, authToken);
    if (isPlatform) return true;

    // 检查用户是否属于该租户
    try {
      const { data, error } = await this.getClient(authToken)
        .from('users')
        .select('tenant_id')
        .eq('id', userId)
        .single();

      if (error || !data) return false;
      return data.tenant_id === tenantId;
    } catch {
      return false;
    }
  }

  async validateTenant(tenantId: string, authToken?: string): Promise<boolean> {
    try {
      const { data, error } = await this.getClient(authToken)
        .from('tenants')
        .select('id, is_active')
        .eq('id', tenantId)
        .single();

      if (error || !data) return false;
      return (data as { is_active: boolean }).is_active === true;
    } catch {
      return false;
    }
  }

  /** 获取租户详细信息 */
  async getTenantInfo(tenantId: string): Promise<{
    id: string;
    name: string;
    isActive: boolean;
    billingStrategy: Record<string, unknown> | null;
  } | null> {
    try {
      const { data, error } = await this.getClient()
        .from('tenants')
        .select('id, name, is_active, billing_strategy')
        .eq('id', tenantId)
        .single();

      if (error || !data) return null;

      return {
        id: data.id,
        name: data.name,
        isActive: data.is_active ?? false,
        billingStrategy: data.billing_strategy as Record<string, unknown> | null,
      };
    } catch {
      return null;
    }
  }

  /** 检查用户是否为平台超管 */
  async isPlatformAdmin(userId: string, authToken?: string): Promise<boolean> {
    try {
      const { data, error } = await this.getClient(authToken)
        .from('users')
        .select('is_system_user, role')
        .eq('id', userId)
        .single();

      if (error || !data) return false;

      const userData = data as { is_system_user: boolean; role: string };
      return userData.is_system_user === true || userData.role === 'platform_admin';
    } catch {
      return false;
    }
  }
}
