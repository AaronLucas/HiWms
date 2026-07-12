/**
 * Supabase 权限检查器实现
 * 直接调用 check_user_permission RPC
 */
import { WmsSupabaseClient } from '@adapters/supabase/SupabaseClient';
import { IPermissionChecker } from '@core/ports/auth/IPermissionChecker';

export class SupabasePermissionChecker implements IPermissionChecker {
  constructor(private supabase: WmsSupabaseClient) {}

  async check(params: {
    userId: string;
    resource: string;
    action: string;
    scope?: string;
  }): Promise<boolean> {
    try {
      const result = await this.supabase.rpc('check_user_permission', {
        p_user_id: params.userId,
        p_resource: params.resource,
        p_action: params.action,
        p_scope: params.scope ?? 'tenant',
      });

      // RPC 返回数组 [{ has_permission: boolean }]
      return Array.isArray(result) && result.length > 0 ? result[0].has_permission === true : false;
    } catch {
      return false;
    }
  }

  async checkBatch(params: Array<{
    userId: string;
    resource: string;
    action: string;
    scope?: string;
  }>): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    // 并发检查（限制并发数）
    const concurrency = 10;
    for (let i = 0; i < params.length; i += concurrency) {
      const batch = params.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async p => {
          const key = `${p.userId}:${p.resource}:${p.action}:${p.scope ?? 'tenant'}`;
          results.set(key, await this.check(p));
        })
      );
    }

    return results;
  }

  async getUserPermissions(userId: string): Promise<Array<{
    resource: string;
    action: string;
    scope: string;
  }>> {
    try {
      const { data, error } = await this.supabase.getClient()
        .from('user_roles')
        .select(`
          scope,
          roles!inner (
            role_permissions!inner (
              permissions!inner (
                resource,
                action
              )
            )
          )
        `)
        .eq('user_id', userId);

      if (error) throw error;

      return (data as any[])?.flatMap(ur =>
        ur.roles?.role_permissions?.map((rp: any) => ({
          resource: rp.permissions.resource,
          action: rp.permissions.action,
          scope: ur.scope ?? 'tenant',
        })) || []
      ) || [];
    } catch {
      return [];
    }
  }
}