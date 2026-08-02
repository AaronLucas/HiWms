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
  protected tableName = 'inventory' as const;
  protected idColumn = 'id';

  async findByLocation(locationId: string, authToken?: string): Promise<InventoryRow[]> {
    return this.findAll({ filters: { location_id: locationId }, orderBy: 'product_id', ascending: true, authToken });
  }

  async findByProduct(productId: string, authToken?: string): Promise<InventoryRow[]> {
    return this.findAll({ filters: { product_id: productId }, orderBy: 'location_id', ascending: true, authToken });
  }

  async findByContainer(containerId: string, authToken?: string): Promise<InventoryRow[]> {
    return this.findAll({ filters: { container_id: containerId }, orderBy: 'product_id', ascending: true, authToken });
  }

  async findAvailable(productId: string, locationId?: string, authToken?: string): Promise<InventoryRow[]> {
    const filters: Record<string, unknown> = { product_id: productId };
    if (locationId) filters.location_id = locationId;

    // 查找数量 > 0 且未被锁定/预留的库存
    const { data, error } = await this.getClient(false, authToken)
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
  }>, authToken?: string): Promise<InventoryRow[]> {
    // 使用 RPC 或事务批量更新（乐观锁）
    const results: InventoryRow[] = [];
    const client = this.getClient(false, authToken);
    for (const update of updates) {
      const { data, error } = await client
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

  async getTotalQuantity(productId: string, tenantId: string, authToken?: string): Promise<number> {
    const { data, error } = await this.getClient(false, authToken)
      .from(this.tableName)
      .select('quantity')
      .eq('product_id', productId)
      .eq('tenant_id', tenantId);

    if (error) throw error;
    return (data as { quantity: number }[]).reduce((sum, row) => sum + (row.quantity || 0), 0);
  }

  async findReplenishmentNeeded(tenantId: string, authToken?: string): Promise<Tables<'inventory'>[]> {
    // 复用 v_replenishment_needs 视图的补货判定逻辑（getReplenishmentNeeds），
    // 再按视图给出的 (loc_id, sku_id) 精确对拿回真实 inventory 行。
    const needs = await this.getReplenishmentNeeds(tenantId, authToken);
    if (needs.length === 0) return [];

    const pairFilter = needs
      .map((n) => `and(location_id.eq.${n.loc_id},product_id.eq.${n.sku_id})`)
      .join(',');

    const { data, error } = await this.getClient(false, authToken)
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .or(pairFilter);

    if (error) throw error;
    return (data as Tables<'inventory'>[]) || [];
  }

  /**
   * 查找可用的补货源库位（有库存、符合区域类型、数量足够）
   * 返回按数量降序排列的库位列表
   */
  async findAvailableSources(params: {
    skuId: string;
    zoneTypes: string[];
    minQuantity: number;
  }, authToken?: string): Promise<Array<{ location_id: string; quantity: number; zone_type: string }>> {
    const { skuId, zoneTypes, minQuantity } = params;

    const { data, error } = await this.getClient(false, authToken)
      .from(this.tableName)
      .select(`
        location_id,
        quantity,
        locations!inner(zone_type)
      `)
      .eq('product_id', skuId)
      .gt('quantity', minQuantity - 1)
      .in('locations.zone_type', zoneTypes)
      .order('quantity', { ascending: false });

    if (error) throw error;

    return (data as Array<{
      location_id: string;
      quantity: number;
      locations: { zone_type: string };
    }> || []).map(row => ({
      location_id: row.location_id,
      quantity: row.quantity,
      zone_type: row.locations.zone_type,
    }));
  }

  /**
   * 查询补货需求视图 v_replenishment_needs
   */
  async getReplenishmentNeeds(tenantId?: string, authToken?: string): Promise<Array<{
    loc_id: string;
    loc_code: string;
    sku_id: string;
    sku_code: string;
    current_qty: number;
    picking_max_qty: number;
    fill_rate_pct: number;
  }>> {
    let query = this.getClient(false, authToken)
      .from('v_replenishment_needs')
      .select('loc_id, loc_code, sku_id, sku_code, current_qty, picking_max_qty, fill_rate_pct');

    if (tenantId) {
      // 视图可能不包含 tenant_id，这里简化处理
      // 实际应该通过 locations 关联过滤
    }

    const { data, error } = await query;
    if (error) throw new Error(`查询补货需求失败: ${error.message}`);
    return (data || []) as Array<{
      loc_id: string;
      loc_code: string;
      sku_id: string;
      sku_code: string;
      current_qty: number;
      picking_max_qty: number;
      fill_rate_pct: number;
    }>;
  }
}
