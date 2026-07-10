/**
 * 库存分配 RPC 端口接口
 * 对应数据库函数: fn_logic_stock_allocation
 */
export interface IStockAllocationRpc {
  /**
   * 执行库存分配逻辑
   * @param params 分配参数
   * @returns 分配结果数组
   */
  allocate(params: {
    /** 需要分配的数量 */
    p_needed_qty: number;
    /** 订单ID */
    p_order_id: string;
    /** SKU ID */
    p_sku_id: string;
  }): Promise<Array<{
    /** 分配的数量 */
    alloc_qty: number;
    /** 来源LPN码 */
    source_lpn: string;
  }>>;
}