/**
 * 库存调整 RPC 端口接口
 * 对应数据库函数: adjust_inventory
 */
export interface IInventoryAdjustRpc {
  /**
   * 调整库存：入库/出库/盘点，乐观锁保护
   * @param params 调整参数
   * @returns 调整后的库存记录
   */
  adjust(params: {
    /** 租户 ID */
    p_tenant_id: string;
    /** SKU 编码 */
    p_sku: string;
    /** 数量（正为入库，负为出库） */
    p_quantity: number;
    /** 变更原因 */
    p_reason: string;
  }): Promise<Array<{
    /** 库存 ID */
    id: string;
    /** 调整后数量 */
    quantity: number;
  }>>;
}