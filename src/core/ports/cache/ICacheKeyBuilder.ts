/**
 * 缓存键构建器端口接口
 * 租户感知的键命名规范
 */
export interface ICacheKeyBuilder {
  /**
   * 构建基础键
   */
  build(...parts: string[]): string;

  /**
   * 构建租户感知键
   */
  buildTenant(tenantId: string, ...parts: string[]): string;

  /**
   * 构建用户感知键
   */
  buildUser(userId: string, ...parts: string[]): string;

  /**
   * 构建实体缓存键
   */
  entity(entityType: string, id: string, tenantId?: string): string;

  /**
   * 构建列表缓存键
   */
  list(entityType: string, tenantId: string, params?: Record<string, unknown>): string;

  /**
   * 构建会话键
   */
  session(sessionId: string): string;

  /**
   * 构建限流键
   */
  rateLimit(identifier: string, window: string): string;
}