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
  findByLocation(locationId: string, authToken?: string): Promise<InventoryRow[]>;

  /**
   * 按产品查找库存
   */
  findByProduct(productId: string, authToken?: string): Promise<InventoryRow[]>;

  /**
   * 按容器查找库存
   */
  findByContainer(containerId: string, authToken?: string): Promise<InventoryRow[]>;

  /**
   * 查找可用库存（排除已锁定/预留）
   */
  findAvailable(productId: string, locationId?: string, authToken?: string): Promise<InventoryRow[]>;

  /**
   * 批量更新库存数量（乐观锁）
   */
  updateQuantities(updates: Array<{
    id: string;
    quantity: number;
    expectedVersion: number;
  }>, authToken?: string): Promise<InventoryRow[]>;

  /**
   * 获取库存总量（按产品聚合）
   */
  getTotalQuantity(productId: string, tenantId: string, authToken?: string): Promise<number>;

  /**
   * 查找需要补货的库位
   */
  findReplenishmentNeeded(tenantId: string, authToken?: string): Promise<InventoryRow[]>;

  /**
   * 查找可用的补货源库位（有库存、符合区域类型、数量足够）
   */
  findAvailableSources(params: {
    skuId: string;
    zoneTypes: string[];
    minQuantity: number;
  }, authToken?: string): Promise<Array<{ location_id: string; quantity: number; zone_type: string }>>;

  /**
   * 查询补货需求视图
   */
  getReplenishmentNeeds(tenantId?: string, authToken?: string): Promise<Array<{
    loc_id: string;
    loc_code: string;
    sku_id: string;
    sku_code: string;
    current_qty: number;
    picking_max_qty: number;
    fill_rate_pct: number;
  }>>;

  // ===== Sprint 6: 库存写操作 =====

  /**
   * 库存调整（增/减，含原因与单据关联）
   */
  adjustInventory(input: {
    tenantId: string;
    productId: string;
    locationId: string;
    quantityDelta: number;
    reason: string;
    referenceId?: string;
    referenceType?: string;
    authToken?: string;
  }): Promise<InventoryRow>;

  /**
   * 库存移库（同产品跨库位转移）
   */
  transferInventory(input: {
    tenantId: string;
    productId: string;
    fromLocationId: string;
    toLocationId: string;
    quantity: number;
    reason: string;
    referenceId?: string;
    authToken?: string;
  }): Promise<{ from: InventoryRow; to: InventoryRow }>;

  /**
   * 预留库存（用于订单/工单锁定）
   */
  reserveInventory(input: {
    tenantId: string;
    productId: string;
    locationId: string;
    quantity: number;
    orderId?: string;
    workOrderId?: string;
    expiresAt?: string;
    authToken?: string;
  }): Promise<InventoryRow>;

  /**
   * 锁定库存（临时冻结，如质检/盘点）
   */
  lockInventory(input: {
    tenantId: string;
    productId: string;
    locationId: string;
    quantity: number;
    reason: string;
    lockedBy?: string;
    expiresAt?: string;
    authToken?: string;
  }): Promise<InventoryRow>;

  /**
   * 释放预留库存（订单取消/完成时调用）
   */
  releaseReservation(input: {
    tenantId: string;
    productId: string;
    locationId: string;
    quantity: number;
    orderId?: string;
    workOrderId?: string;
    authToken?: string;
  }): Promise<InventoryRow>;

  /**
   * 解除锁定库存（质检/盘点结束时调用）
   */
  unlockInventory(input: {
    tenantId: string;
    productId: string;
    locationId: string;
    quantity: number;
    reason: string;
    authToken?: string;
  }): Promise<InventoryRow>;

  /**
   * 查询库存历史变动
   */
  getInventoryHistory(tenantId: string, options?: {
    limit?: number;
    offset?: number;
    productId?: string;
    locationId?: string;
    startDate?: string;
    endDate?: string;
    authToken?: string;
  }): Promise<Array<{
    id: string;
    productId: string;
    locationId: string;
    quantityBefore: number;
    quantityAfter: number;
    changeType: string;
    reason: string;
    referenceId: string | null;
    referenceType: string | null;
    createdAt: string;
    createdBy: string | null;
  }>>;

  /**
   * 查询可用库存量（扣除预留/锁定）
   */
  getAvailableQuantity(input: {
    productId: string;
    locationId?: string;
    excludeReserved?: boolean;
    excludeLocked?: boolean;
    authToken?: string;
  }): Promise<number>;
}
