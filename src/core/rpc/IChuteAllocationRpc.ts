/**
 * 滑道分配 RPC 端口接口
 * 对应数据库函数: fn_allocate_chute
 */
export interface IChuteAllocationRpc {
  /**
   * 分配滑道
   * @param params 分配参数
   * @returns 分配结果
   */
  allocate(params: {
    /** 波次 ID */
    p_wave_id: string;
    /** SKU ID */
    p_sku_id: string;
  }): Promise<{
    /** 滑道 ID */
    chute_id: string;
    /** 滑道编码 */
    chute_code: string;
  }>;
}