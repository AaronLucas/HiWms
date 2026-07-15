/**
 * 库存仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

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

  /**
   * 查找可用的补货源库位（有库存、符合区域类型、数量足够）
   */
  findAvailableSources(params: {
    skuId: string;
    zoneTypes: string[];
    minQuantity: number;
  }): Promise<Array<{ location_id: string; quantity: number; zone_type: string }>>;

  /**
   * 查询补货需求视图
   */
  getReplenishmentNeeds(tenantId?: string): Promise<Array<{
    loc_id: string;
    loc_code: string;
    sku_id: string;
    sku_code: string;
    current_qty: number;
    picking_max_qty: number;
    fill_rate_pct: number;
  }>>;
}