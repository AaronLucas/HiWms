/**
 * Supabase 库存仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IInventoryRepository } from '@core/ports/db/IInventoryRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type InventoryRow = Tables<'inventory'>;
type InventoryInsert = TablesInsert<'inventory'>;
type InventoryUpdate = TablesUpdate<'inventory'>;

export class SupabaseInventoryRepository extends SupabaseBaseRepository<
  InventoryRow,
  InventoryInsert,
  InventoryUpdate,
  string
> implements IInventoryRepository {
  protected tableName = 'inventory';
  protected idColumn = 'id';

  async findByLocation(locationId: string): Promise<InventoryRow[]> {
    return this.findAll({ filters: { location_id: locationId }, orderBy: 'product_id', ascending: true });
  }

  async findByProduct(productId: string): Promise<InventoryRow[]> {
    return this.findAll({ filters: { product_id: productId }, orderBy: 'location_id', ascending: true });
  }

  async findByContainer(containerId: string): Promise<InventoryRow[]> {
    return this.findAll({ filters: { container_id: containerId }, orderBy: 'product_id', ascending: true });
  }

  async findAvailable(productId: string, locationId?: string): Promise<InventoryRow[]> {
    const filters: Record<string, unknown> = { product_id: productId };
    if (locationId) filters.location_id = locationId;

    // 查找数量 > 0 且未被锁定/预留的库存
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .match(filters)
      .gt('quantity', 0)
      .is('container_id', null) // 简化：假设非容器库存为可用
      .order('picking_priority', { ascending: true })
      .order('created_at', { ascending: true }); // FEFO

    if (error) throw error;
    return (data as InventoryRow[]) || [];
  }

  async updateQuantities(updates: Array<{
    id: string;
    quantity: number;
    expectedVersion: number;
  }>): Promise<InventoryRow[]> {
    // 使用 RPC 或事务批量更新（乐观锁）
    // 这里简化为逐个更新，实际生产应使用批量 RPC
    const results: InventoryRow[] = [];
    for (const update of updates) {
      const { data, error } = await this.getClient()
        .from(this.tableName)
        .update({ quantity: update.quantity, version: update.expectedVersion + 1 })
        .eq('id', update.id)
        .eq('version', update.expectedVersion) // 乐观锁检查
        .select()
        .single();

      if (error) throw new Error(`乐观锁冲突: ${update.id}`);
      results.push(data as InventoryRow);
    }
    return results;
  }

  async getTotalQuantity(productId: string, tenantId: string): Promise<number> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('quantity')
      .eq('product_id', productId)
      .eq('tenant_id', tenantId);

    if (error) throw error;
    return (data as { quantity: number }[]).reduce((sum, row) => sum + (row.quantity || 0), 0);
  }

  async findReplenishmentNeeded(tenantId: string): Promise<Tables<'inventory'>[]> {
    // 查找库存低于补货阈值的记录
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*, locations(picking_threshold_pct, picking_max_qty)')
      .eq('tenant_id', tenantId)
      .lt('quantity', this.getClient().rpc('calculate_replenishment_threshold')); // 简化，实际需更复杂的查询

    if (error) throw error;
    return (data as Tables<'inventory'>[]) || [];
  }
}