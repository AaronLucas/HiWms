/**
 * 交叉理货 RPC 端口接口
 * 对应数据库函数: fn_match_cross_dock
 */
export interface ICrossDockRpc {
  /**
   * 匹配交叉理货：入库单据匹配出库订单
   * @param params 匹配参数
   * @returns 匹配结果
   */
  match(params: {
    /** 入库收货单 ID */
    p_receipt_id: string;
    /** SKU ID */
    p_sku_id: string;
    /** 数量（可选） */
    p_qty?: number | null;
  }): Promise<Array<{
    /** 作业 ID */
    job_id: string;
    /** 匹配数量 */
    matched_qty: number;
    /** 出库订单 ID */
    outbound_order_id: string;
    /** 暂存库位 ID */
    staging_loc_id: string;
  }>>;
}