/**
 * Supabase 认证提供者实现
 * 负责 JWT 验证、刷新令牌、登录、注册
 * ADR-015: 修正 signUp 写入 app_metadata.tenant_id、signIn 读取租户
 */
import { createClient, type SupabaseClient as SupabaseJsClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';
import { IAuthProvider } from '../../../core/ports/auth/IAuthProvider';
import { WmsSupabaseClient } from '../SupabaseClient';

interface UserRole {
  role_id: string;
  scope: string | null;
  roles: { name: string } | null;
  role_permissions: Array<{
    permissions: { resource: string; action: string };
  }> | null;
}

export class SupabaseAuthProvider implements IAuthProvider {
  constructor(
    private client: SupabaseJsClient<Database>,
    private adminClient: SupabaseJsClient<Database> | null = null
  ) {}

  async verifyToken(token: string): Promise<{
    userId: string;
    tenantId: string | null;
    isSystemUser: boolean;
    roles: string[];
    permissions: string[];
  } | null> {
    try {
      const { data: { user }, error } = await this.client.auth.getUser(token);

      if (error || !user) {
        return null;
      }

      // 获取用户详细信息（包括租户、角色）
      // ADR-015: 优先从 app_metadata 读取 tenant_id（JWT 路径），回退查 users 表
      const tenantIdFromJwt = user.app_metadata?.tenant_id as string | undefined;

      const { data: profile, error: profileError } = await this.client
        .from('users')
        .select('tenant_id, role, is_system_user')
        .eq('id', user.id)
        .single();

      // token 本身已通过 Supabase Auth 验证（上面 getUser 成功），但 public.users
      // 档案查不到——不是"未登录"，是"已登录但档案缺失/查询失败"，会静默退化成
      // tenantId=null、roles=[]、permissions=[] 的"已认证但零权限"对象，排障时
      // 很容易被误当成正常的匿名/无权限请求。这里补日志，方便定位到底是触发器
      // 没跑完（见 migration 026 handle_new_user）还是数据异常。
      if (profileError) {
        console.error(
          `verifyToken: 用户 ${user.id} 已通过 Supabase Auth 验证，但查询 public.users 档案失败 ` +
          `（code=${profileError.code}）——本次会话会退化为"已登录但零租户/零权限"`,
          profileError
        );
      }

      // 获取用户角色和权限
      const { data: userRoles } = await this.client
        .from('user_roles')
        .select('role_id, scope, roles(name), role_permissions(permissions(resource, action))')
        .eq('user_id', user.id);

      const roles = (userRoles as UserRole[] | null)?.map(ur => ur.roles?.name).filter(Boolean) as string[] || [];
      const permissions = (userRoles as UserRole[] | null)?.flatMap(ur =>
        ur.role_permissions?.map(rp => `${rp.permissions.resource}:${rp.permissions.action}`) || []
      ) || [];

      return {
        userId: user.id,
        tenantId: tenantIdFromJwt ?? profile?.tenant_id ?? null,
        isSystemUser: profile?.is_system_user ?? false,
        roles: roles.length > 0 ? roles : [profile?.role].filter(Boolean) as string[],
        permissions,
      };
    } catch {
      return null;
    }
  }

  async refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  } | null> {
    try {
      const { data, error } = await this.client.auth.refreshSession({ refresh_token: refreshToken });

      if (error || !data.session) {
        return null;
      }

      return {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresIn: data.session.expires_in,
      };
    } catch {
      return null;
    }
  }

  /**
   * ADR-015: Token generation requires user credentials; use signIn instead.
   * This method is kept for interface compatibility but throws if called.
   * Consider deprecating in future.
   */
  async generateTokens(userId: string, tenantId: string | null): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    throw new Error('Token generation requires user credentials. Use signIn instead.');
  }

  async revokeToken(token: string): Promise<void> {
    // Supabase 不直接支持撤销单个 access token
    // 可以通过刷新令牌轮换或用户登出实现
    await this.client.auth.signOut({ scope: 'global' });
  }

  /** 使用邮箱密码登录 - ADR-015: 修正从 profile/app_metadata 读取 tenantId */
  async signIn(email: string, password: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: { id: string; tenantId: string | null };
  } | null> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      return null;
    }

    // 优先从 JWT app_metadata 读取（方案 A：JWT 路径）
    const tenantIdFromJwt = data.user.app_metadata?.tenant_id as string | undefined;

    // 回退查 users 表（方案 A 回退路径）
    let tenantIdFromProfile: string | null = null;
    if (!tenantIdFromJwt) {
      const { data: profile } = await this.client
        .from('users')
        .select('tenant_id')
        .eq('id', data.user.id)
        .single();
      tenantIdFromProfile = profile?.tenant_id ?? null;
    }

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresIn: data.session.expires_in,
      user: {
        id: data.user.id,
        tenantId: tenantIdFromJwt ?? tenantIdFromProfile,
      },
    };
  }

  /**
   * 注册新用户（自助注册，创建租户+管理员角色）
   * ADR-015: 关键修正 - 写入 app_metadata.tenant_id（不是 user_metadata）
   * 触发器 handle_new_user 会在 public.users 创建行并建立租户，
   * 然后此处通过 Admin API 将 tenant_id 写入 app_metadata
   */
  async signUp(email: string, password: string, metadata: Record<string, unknown>): Promise<{
    userId: string;
    tenantId: string | null;
  } | null> {
    if (!this.adminClient) {
      throw new Error('Admin client required for signUp (needs service_role_key)');
    }

    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: {
        data: metadata  // user_metadata：用户可改的资料（昵称等）
      },
    });

    if (error || !data.user) {
      return null;
    }

    // ADR-015: 等待触发器完成（触发器创建租户、在 public.users 插入行、返回 tenant_id）
    // 然后通过 Admin API 写入 app_metadata.tenant_id
    // 注意：这需要触发器先运行完成。若用 pg_net/HTTP 扩展在触发器内直接写 app_metadata，
    // 则此步可省略。当前设计假设触发器同步完成后由应用层补写。
    let tenantId: string | null = null;

    // 等待触发器完成并查询租户 ID
    // 这里简单轮询，生产环境建议用数据库触发器内 pg_net 直接写 app_metadata
    for (let i = 0; i < 10; i++) {
      const { data: profile } = await this.client
        .from('users')
        .select('tenant_id')
        .eq('id', data.user.id)
        .single();

      if (profile?.tenant_id) {
        tenantId = profile.tenant_id;
        break;
      }
      await new Promise(r => setTimeout(r, 100));
    }

    if (tenantId) {
      // 写入 app_metadata（用户不可改，RLS 读取此字段）
      const { error: updateError } = await this.adminClient.auth.admin.updateUserById(
        data.user.id,
        { app_metadata: { tenant_id: tenantId } }
      );

      if (updateError) {
        console.error('Failed to write app_metadata.tenant_id:', updateError);
        // 不抛出错误，允许后续重试或补偿机制处理
      }
    }

    return {
      userId: data.user.id,
      tenantId,
    };
  }

  /** 修改用户密码——见 IAuthProvider.changePassword 注释 */
  async changePassword(userId: string, newPassword: string): Promise<void> {
    if (!this.adminClient) {
      throw new Error('Admin client required for changePassword (needs service_role_key)');
    }
    const { error } = await this.adminClient.auth.admin.updateUserById(userId, { password: newPassword });
    if (error) {
      throw new Error(`changePassword failed: ${error.message}`);
    }
  }
}