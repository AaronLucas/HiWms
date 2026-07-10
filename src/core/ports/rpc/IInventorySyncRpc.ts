/**
 * 跨库同步 RPC 端口接口
 * 对应数据库函数: sync_inventory_from_source
 */
export interface IInventorySyncRpc {
  /**
   * 从源同步库存（多租户同步）
   * @param params 同步参数
   * @returns 同步结果
   */
  sync(params: {
    /** 租户 ID */
    p_tenant_id: string;
  }): Promise<{
    /** 同步数量 */
    synced_count: number;
  }>;
}