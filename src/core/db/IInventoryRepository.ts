/**
 * 库存仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../types/database';

export type InventoryRow = Tables<'inventory'>;
export type InventoryInsert = TablesInsert<'inventory'>;
export type InventoryUpdate = TablesUpdate<'inventory'>;

export interface IInventoryRepository extends IRepository<InventoryRow, InventoryInsert, InventoryUpdate> {
  /**
   * 按库位查找库存
   */
  findByLocation(locationId: string): Promise<InventoryRow[]>;

  /**
   * 按产品查找库存
   */
  findByProduct(productId: string): Promise<InventoryRow[]>;

  /**
   * 按容器查找库存
   */
  findByContainer(containerId: string): Promise<InventoryRow[]>;

  /**
   * 查找可用库存（排除已锁定/预留）
   */
  findAvailable(productId: string, locationId?: string): Promise<InventoryRow[]>;

  /**
   * 批量更新库存数量（乐观锁）
   */
  updateQuantities(updates: Array<{
    id: string;
    quantity: number;
    expectedVersion: number;
  }>): Promise<InventoryRow[]>;

  /**
   * 获取库存总量（按产品聚合）
   */
  getTotalQuantity(productId: string, tenantId: string): Promise<number>;

  /**
   * 查找需要补货的库位
   */
  findReplenishmentNeeded(tenantId: string): Promise<InventoryRow[]>;
}