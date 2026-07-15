/**
 * 库存预留仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type InventoryReservationRow = Tables<'inventory_reservations'>;
export type InventoryReservationInsert = TablesInsert<'inventory_reservations'>;
export type InventoryReservationUpdate = TablesUpdate<'inventory_reservations'>;

export interface IInventoryReservationRepository extends IRepository<InventoryReservationRow, InventoryReservationInsert, InventoryReservationUpdate> {
  /**
   * 按库存记录查找预留
   */
  findByInventory(inventoryId: string): Promise<InventoryReservationRow[]>;

  /**
   * 按订单查找预留
   */
  findByOrder(orderId: string): Promise<InventoryReservationRow[]>;

  /**
   * 按租户查找活跃预留
   */
  findActiveByTenant(tenantId: string): Promise<InventoryReservationRow[]>;

  /**
   * 创建库存预留
   */
  createReservation(data: InventoryReservationInsert): Promise<InventoryReservationRow>;

  /**
   * 释放库存预留
   */
  releaseReservation(reservationId: string): Promise<void>;

  /**
   * 释放过期预留
   */
  releaseExpiredReservations(): Promise<number>;

  /**
   * 获取预留统计
   */
  getReservationStats(tenantId: string): Promise<{
    totalReservations: number;
    activeReservations: number;
    expiredReservations: number;
    reservedQuantity: number;
  }>;
}