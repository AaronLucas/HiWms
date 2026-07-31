/**
 * 认证提供者端口接口
 * 负责 JWT 验证、刷新令牌、登录、注册
 */
export interface IAuthProvider {
  /**
   * 验证访问令牌
   * @param token JWT 令牌
   * @returns 解析后的用户信息，或 null 表示无效
   */
  verifyToken(token: string): Promise<{
    userId: string;
    tenantId: string | null;
    isSystemUser: boolean;
    roles: string[];
    permissions: string[];
  } | null>;

  /**
   * 刷新令牌
   * @param refreshToken 刷新令牌
   * @returns 新的访问令牌和刷新令牌
   */
  refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  } | null>;

  /**
   * 生成新令牌（登录后调用）
   * @param userId 用户ID
   * @param tenantId 租户ID
   * @returns 访问令牌和刷新令牌
   */
  generateTokens(userId: string, tenantId: string | null): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }>;

  /**
   * 撤销令牌（登出时调用）
   */
  revokeToken(token: string): Promise<void>;

  /**
   * 使用邮箱密码登录
   * @param email 邮箱
   * @param password 密码
   * @returns 访问令牌、刷新令牌、用户信息
   */
  signIn(email: string, password: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: { id: string; tenantId: string | null };
  } | null>;

  /**
   * 注册新用户（自助注册，创建租户 + 写入 app_metadata.tenant_id）
   * @param email 邮箱
   * @param password 密码
   * @param metadata 额外元数据（如租户名、角色等）
   * @returns 用户ID、租户ID
   */
  signUp(email: string, password: string, metadata: Record<string, unknown>): Promise<{
    userId: string;
    tenantId: string | null;
  } | null>;

  /**
   * 修改用户密码——统一通过 Supabase Auth 完成写入（不再有本地密码列，
   * migration 026 起 users.password_hash 已删除）。同时覆盖"用户自助改密码"
   * 和"管理员重置成员密码"两种业务场景：本方法只负责执行密码写入本身，
   * 调用方（路由/用例层）负责按场景校验授权（自助改密码校验 userId 与当前
   * 登录用户一致；管理员重置校验操作者与目标用户同租户且具备相应权限）。
   * @param userId 目标用户 ID
   * @param newPassword 新密码（明文，由 Supabase Auth 负责哈希存储）
   */
  changePassword(userId: string, newPassword: string): Promise<void>;
}