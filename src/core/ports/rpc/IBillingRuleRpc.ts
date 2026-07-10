/**
 * 计费规则查询 RPC 端口接口
 * 对应数据库函数: fn_get_active_billing_rule
 */
export interface IBillingRuleRpc {
  /**
   * 获取生效计费规则：规范化表优先，回退 JSONB
   * @param params 查询参数
   * @returns 计费规则信息
   */
  getActive(params: {
    /** 租户 ID */
    p_tenant_id: string;
  }): Promise<Array<{
    /** 规则 ID */
    rule_id: string;
    /** 规则名称 */
    rule_name: string;
    /** 货币单位 */
    currency: string;
    /** 来源 */
    source: string;
  }>>;
}