/**
 * 权限检查器端口接口
 * 抽象 check_user_permission RPC 调用
 */
export interface IPermissionChecker {
  /**
   * 检查用户是否有指定权限
   * @param params 检查参数
   * @returns 是否有权限
   */
  check(params: {
    /** 用户 ID */
    userId: string;
    /** 资源类型（如 'orders', 'inventory', 'waves'） */
    resource: string;
    /** 操作类型（如 'read', 'write', 'delete', 'approve'） */
    action: string;
    /** 可选：作用域（如 'own', 'tenant', 'platform'） */
    scope?: string;
  }): Promise<boolean>;

  /**
   * 批量检查权限
   */
  checkBatch(params: Array<{
    userId: string;
    resource: string;
    action: string;
    scope?: string;
  }>): Promise<Map<string, boolean>>;

  /**
   * 获取用户所有权限
   */
  getUserPermissions(userId: string): Promise<Array<{
    resource: string;
    action: string;
    scope: string;
  }>>;
}