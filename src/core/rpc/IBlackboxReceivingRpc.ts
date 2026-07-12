/**
 * 黑盒收货解析 RPC 端口接口
 * 对应数据库函数: fn_logic_resolve_blackbox_box
 */
export interface IBlackboxReceivingRpc {
  /**
   * 解析黑盒箱内容：扫箱不扫货，开箱确认 SKU/数量
   * @param params 解析参数
   * @returns 解析结果
   */
  resolve(params: {
    /** LPN 码 */
    p_lpn_code: string;
    /** SKU ID */
    p_sku_id: string;
    /** 数量 */
    p_qty: number;
    /** 批次号（可选） */
    p_batch?: string | null;
  }): Promise<unknown>;
}