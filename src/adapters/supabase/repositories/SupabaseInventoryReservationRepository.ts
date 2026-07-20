/**
 * Supabase 库存预留仓储实现
 *
 * 表结构核实（supabase/migrations/001_enterprise_core_schema.sql §inventory_reservations
 * + 002_offline_sync_exception_domain.sql 补充的 work_order_id）：
 * 真实列为 id, inventory_id, order_id, reserved_qty, status, expires_at,
 * created_at, updated_at, work_order_id —— 没有 tenant_id / is_active / quantity /
 * released_at 这几列。租户归属需要通过 inventory 表 join 推导（与 migration 006
 * 对 order_lines 缺 tenant_id 的处理方式一致，见 006_tenant_ownership_fix.sql）。
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IInventoryReservationRepository } from '@core/ports/db/IInventoryReservationRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type InventoryReservationRow = Tables<'inventory_reservations'>;
type InventoryReservationInsert = TablesInsert<'inventory_reservations'>;
type InventoryReservationUpdate = TablesUpdate<'inventory_reservations'>;

export class SupabaseInventoryReservationRepository extends SupabaseBaseRepository<
  InventoryReservationRow,
  InventoryReservationInsert,
  InventoryReservationUpdate,
  string
> implements IInventoryReservationRepository {
  protected tableName = 'inventory_reservations';
  protected idColumn = 'id';

  async findByInventory(inventoryId: string): Promise<InventoryReservationRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('inventory_id', inventoryId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as InventoryReservationRow[]) || [];
  }

  async findByOrder(orderId: string): Promise<InventoryReservationRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as InventoryReservationRow[]) || [];
  }

  /**
   * 按租户查找活跃预留
   * inventory_reservations 没有 tenant_id 列，通过 inner join inventory(tenant_id)
   * 推导租户归属——已知局限：如果某行 inventory_id 为 NULL（理论上允许，但实践中
   * "预留"必然对应一条具体库存记录），inner join 会把它排除在外，这与
   * "预留" 的语义本身是一致的，不是遗漏。
   */
  async findActiveByTenant(tenantId: string): Promise<InventoryReservationRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*, inventory!inner(tenant_id)')
      .eq('inventory.tenant_id', tenantId)
      .eq('status', 'ACTIVE')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;
    return ((data as Array<InventoryReservationRow & { inventory?: unknown }>) || []).map(
      ({ inventory: _inventory, ...rest }) => rest as InventoryReservationRow
    );
  }

  /**
   * 创建库存预留
   * 新增：写入前校验 data.inventory_id / data.order_id（如果提供）确实属于
   * tenantId，不能信任调用方传来的 ID 天然合法——与 migration 006 对
   * order_line_id/order_id 的校验思路一致（见
   * supabase/migrations/006_tenant_ownership_fix.sql 顶部背景说明：已用真实数据
   * 复现过跨租户 ID 被直接信任导致的越权写入）。校验不通过时按"引用不存在"处理，
   * 不暴露"这个 ID 其实存在，只是不属于你"这种信息，也不做任何部分写入。
   */
  async createReservation(tenantId: string, data: InventoryReservationInsert): Promise<InventoryReservationRow> {
    if (data.inventory_id) {
      const { data: inv, error: invError } = await this.getClient()
        .from('inventory')
        .select('id')
        .eq('id', data.inventory_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (invError) throw invError;
      if (!inv) {
        throw new Error(`createReservation: inventory_id ${data.inventory_id} 不存在或不属于当前租户`);
      }
    }

    if (data.order_id) {
      const { data: order, error: orderError } = await this.getClient()
        .from('orders')
        .select('id')
        .eq('id', data.order_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (orderError) throw orderError;
      if (!order) {
        throw new Error(`createReservation: order_id ${data.order_id} 不存在或不属于当前租户`);
      }
    }

    return this.create(data);
  }

  /**
   * 释放库存预留
   * 原实现写入不存在的 is_active / released_at 两列，每次调用必定抛
   * PostgREST 列不存在错误——改用真实存在的 status 列，转为 'RELEASED'。
   */
  async releaseReservation(reservationId: string): Promise<void> {
    await this.update(reservationId, { status: 'RELEASED', updated_at: new Date().toISOString() } as InventoryReservationUpdate);
  }

  /**
   * 释放过期预留：status = 'ACTIVE' 且已过期的行批量转为 'EXPIRED'
   * 同上，原实现写入不存在的 is_active 列
   */
  async releaseExpiredReservations(): Promise<number> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .update({ status: 'EXPIRED', updated_at: new Date().toISOString() })
      .eq('status', 'ACTIVE')
      .lt('expires_at', new Date().toISOString())
      .select('id');

    if (error) throw error;
    return ((data as { id: string }[]) || []).length;
  }

  /**
   * 获取预留统计
   * 同 findActiveByTenant，通过 inventory 表 join 推导租户归属；
   * 字段改为真实存在的 status / reserved_qty（原实现读取不存在的
   * tenant_id / is_active / quantity 三列，每次调用必定抛错）。
   */
  async getReservationStats(tenantId: string): Promise<{
    totalReservations: number;
    activeReservations: number;
    expiredReservations: number;
    reservedQuantity: number;
  }> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('status, reserved_qty, expires_at, inventory!inner(tenant_id)')
      .eq('inventory.tenant_id', tenantId);

    if (error) throw error;
    const reservations = (data as Array<{ status: string | null; reserved_qty: number | null; expires_at: string | null }>) || [];

    let totalReservations = 0;
    let activeReservations = 0;
    let expiredReservations = 0;
    let reservedQuantity = 0;

    const now = new Date();
    for (const r of reservations) {
      totalReservations++;
      const isExpiredByTime = !!r.expires_at && new Date(r.expires_at) <= now;

      if (r.status === 'ACTIVE' && !isExpiredByTime) {
        activeReservations++;
        reservedQuantity += r.reserved_qty || 0;
      } else if (r.status === 'EXPIRED' || isExpiredByTime) {
        expiredReservations++;
      }
    }

    return { totalReservations, activeReservations, expiredReservations, reservedQuantity };
  }
}
