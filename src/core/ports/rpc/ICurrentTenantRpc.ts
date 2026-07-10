/**
 * 当前租户 ID 获取 RPC 端口接口
 * 对应数据库函数: fn_current_tenant_id
 */
export interface ICurrentTenantRpc {
  /**
   * 获取当前租户 ID：优先 JWT app_metadata，回退 users 表
   * @returns 租户 ID
   */
  getCurrentTenantId(): Promise<string>;
}