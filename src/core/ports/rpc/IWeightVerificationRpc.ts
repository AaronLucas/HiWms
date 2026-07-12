/**
 * 重量校验 RPC 端口接口
 * 对应数据库函数: fn_verify_weight
 */
export interface IWeightVerificationRpc {
  /**
   * 校验重量：基于验货规则当前生效版本自动判定
   * @param params 校验参数
   * @returns 校验结果
   */
  verify(params: {
    /** SKU ID */
    p_sku_id: string;
    /** 实际重量 */
    p_actual_weight: number;
  }): Promise<{
    /** 期望最大重量 */
    expected_max: number;
    /** 期望最小重量 */
    expected_min: number;
    /** 是否通过 */
    passed: boolean;
    /** 规则 ID */
    rule_id: string;
    /** 容差百分比 */
    tolerance_pct: number;
  }>;
}