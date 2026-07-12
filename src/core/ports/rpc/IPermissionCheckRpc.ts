/**
 * 权限检查 RPC 端口接口
 * 对应数据库函数: check_user_permission
 */
export interface IPermissionCheckRpc {
  /**
   * 检查用户权限
   * @param params 检查参数
   * @returns 权限结果
   */
  check(params: {
    /** 用户 ID */
    p_user_id: string;
    /** 资源 */
    p_resource: string;
    /** 动作 */
    p_action: string;
    /** 作用域（默认 tenant） */
    p_scope?: string;
  }): Promise<{
    /** 是否有权限 */
    has_permission: boolean;
  }>;
}