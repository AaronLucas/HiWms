/**
 * 序列号（一货一码）持久化追踪仓储端口接口
 * 对应表：inventory_units；序列号定位视图：v_serial_lookup
 *
 * 只读为主：inventory_units 的写入（入库/拣货）由 SQL 函数
 * fn_putaway_serialized_unit / fn_pick_serialized_unit 在事务内原子完成
 * （见 supabase/migrations/007_zone_location_serial_tracking.sql §3/§4/§5），
 * TS 层不直接 INSERT/UPDATE 这张表，只做定位/查询。
 */
import type { Tables } from '@/types/database';

export type InventoryUnitRow = Tables<'inventory_units'>;
export type SerialLookupRow = Tables<'v_serial_lookup'>;

export interface IInventoryUnitRepository {
  /**
   * 按租户 + 商品 + 序列号精确定位一个序列化实物
   */
  findBySerial(tenantId: string, productId: string, serial: string): Promise<InventoryUnitRow | null>;

  /**
   * 按库位查找在库的序列化实物
   */
  findByLocation(locationId: string): Promise<InventoryUnitRow[]>;

  /**
   * 按租户 + 状态查找序列化实物
   * status: IN_STOCK | RESERVED | PICKED | PACKED | SHIPPED | RETURNED | SCRAPPED
   */
  findByStatus(tenantId: string, status: string): Promise<InventoryUnitRow[]>;

  /**
   * 按订单行查找已出库的序列化实物（保修/召回场景）
   */
  findByOrderLine(orderLineId: string): Promise<InventoryUnitRow[]>;

  /**
   * 序列号定位查询："这个序列号现在在哪"
   * 封装视图 v_serial_lookup（保修/召回场景直接查）
   */
  serialLookup(tenantId: string, serial: string): Promise<SerialLookupRow | null>;
}
