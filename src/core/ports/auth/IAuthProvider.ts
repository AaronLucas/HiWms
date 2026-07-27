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
}