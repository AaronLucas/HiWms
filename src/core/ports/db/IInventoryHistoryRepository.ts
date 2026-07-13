/**
 * 库存历史仓储端口接口
 * 只读查询，用于审计追踪
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type InventoryHistoryRow = Tables<'inventory_history'>;
export type InventoryHistoryInsert = TablesInsert<'inventory_history'>;
export type InventoryHistoryUpdate = TablesUpdate<'inventory_history'>;

export interface IInventoryHistoryRepository extends IRepository<InventoryHistoryRow, InventoryHistoryInsert, InventoryHistoryUpdate> {
  /**
   * 按库存记录查找历史
   */
  findByInventory(inventoryId: string): Promise<InventoryHistoryRow[]>;

  /**
   * 按租户查找历史（分页、类型/日期过滤）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; changeType?: string; startDate?: string; endDate?: string }
  ): Promise<InventoryHistoryRow[]>;

  /**
   * 获取库存变动统计
   */
  getStats(tenantId: string, startDate: string, endDate: string): Promise<{
    totalChanges: number;
    totalQtyChange: number;
    byType: Record<string, { count: number; totalQty: number }>;
    byProduct: Record<string, { count: number; totalQty: number }>;
  }>;
}