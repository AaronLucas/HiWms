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
   * 按租户查找活跃预留（status = 'ACTIVE' 且未过期）
   * inventory_reservations 表没有 tenant_id 列，租户归属通过 inventory 表 join 推导
   * （与 migration 006 对 order_lines 缺 tenant_id 的处理方式一致）
   */
  findActiveByTenant(tenantId: string): Promise<InventoryReservationRow[]>;

  /**
   * 创建库存预留
   * @param tenantId 当前操作所属租户，写入前会校验 data.inventory_id / data.order_id
   *   （如果提供）确实属于该租户，校验不通过时抛错拒绝写入（不做部分写入）
   */
  createReservation(tenantId: string, data: InventoryReservationInsert): Promise<InventoryReservationRow>;

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