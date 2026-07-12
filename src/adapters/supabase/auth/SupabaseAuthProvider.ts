/**
 * Supabase 认证提供者实现
 * 负责 JWT 验证、刷新令牌
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
      const { data: profile } = await this.client
        .from('users')
        .select('tenant_id, role, is_system_user')
        .eq('id', user.id)
        .single();

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
        tenantId: profile?.tenant_id ?? null,
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

  async generateTokens(userId: string, tenantId: string | null): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    // 使用管理员客户端生成令牌
    const client = this.adminClient ?? this.client;

    const { data, error } = await client.auth.admin.generateLink({
      type: 'magiclink',
      email: '', // 实际使用时需要邮箱
    });

    // 或者使用 signInWithPassword 等方式
    // 这里简化返回，实际项目中根据 Supabase Auth 配置调整
    throw new Error('Token generation requires user credentials. Use signIn instead.');
  }

  async revokeToken(token: string): Promise<void> {
    // Supabase 不直接支持撤销单个 access token
    // 可以通过刷新令牌轮换或用户登出实现
    await this.client.auth.signOut({ scope: 'global' });
  }

  /** 使用邮箱密码登录 */
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

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresIn: data.session.expires_in,
      user: {
        id: data.user.id,
        tenantId: (data.user as any).tenant_id ?? null,
      },
    };
  }

  /** 注册新用户 */
  async signUp(email: string, password: string, metadata: Record<string, unknown>): Promise<{
    userId: string;
    tenantId: string | null;
  } | null> {
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: { data: metadata },
    });

    if (error || !data.user) {
      return null;
    }

    return {
      userId: data.user.id,
      tenantId: (data.user as any).tenant_id ?? null,
    };
  }
}