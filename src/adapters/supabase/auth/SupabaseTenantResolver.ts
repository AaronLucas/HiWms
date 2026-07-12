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

  async resolveFromUser(userId: string): Promise<string | null> {
    try {
      const { data, error } = await this.supabase.getClient()
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
  }): Promise<string | null> {
    // 优先级 1：请求头中的租户 ID（用于 API 网关透传）
    if (request.headers?.['x-tenant-id']) {
      const tenantId = request.headers['x-tenant-id'];
      if (await this.validateTenant(tenantId)) {
        return tenantId;
      }
    }

    // 优先级 2：查询参数中的租户 ID
    if (request.query?.tenant_id) {
      const tenantId = request.query.tenant_id;
      if (await this.validateTenant(tenantId)) {
        return tenantId;
      }
    }

    // 优先级 3：已认证用户的租户 ID
    if (request.user?.tenantId) {
      return request.user.tenantId;
    }

    // 优先级 4：从用户 ID 解析
    if (request.user?.id) {
      return this.resolveFromUser(request.user.id);
    }

    return null;
  }

  async validateTenant(tenantId: string): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.getClient()
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
      const { data, error } = await this.supabase.getClient()
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
  async isPlatformAdmin(userId: string): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.getClient()
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