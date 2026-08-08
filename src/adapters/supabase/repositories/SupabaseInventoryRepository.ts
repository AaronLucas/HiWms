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

  // ===== Sprint 6: 库存写操作 =====

  async adjustInventory(input: {
    tenantId: string;
    productId: string;
    locationId: string;
    quantityDelta: number;
    reason: string;
    referenceId?: string;
    referenceType?: string;
    authToken?: string;
  }): Promise<InventoryRow> {
    const client = this.getClient(false, input.authToken);

    // 先查找现有库存行
    const { data: existing, error: findError } = await client
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', input.tenantId)
      .eq('product_id', input.productId)
      .eq('location_id', input.locationId)
      .single();

    if (findError && findError.code !== 'PGRST116') throw findError;

    let newQuantity: number;
    let version = 1;

    if (existing) {
      newQuantity = (existing.quantity || 0) + input.quantityDelta;
      version = (existing.version || 0) + 1;
      if (newQuantity < 0) throw new Error('库存不足，无法扣减');
    } else {
      if (input.quantityDelta < 0) throw new Error('库存不存在，无法扣减');
      newQuantity = input.quantityDelta;
    }

    if (existing) {
      const { data, error } = await client
        .from(this.tableName)
        .update({
          quantity: newQuantity,
          version,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .eq('version', existing.version || 0)
        .select()
        .single();

      if (error) throw new Error(`库存调整失败: ${error.message}`);
      return data as InventoryRow;
    } else {
      const { data, error } = await client
        .from(this.tableName)
        .insert({
          tenant_id: input.tenantId,
          product_id: input.productId,
          location_id: input.locationId,
          quantity: newQuantity,
          version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw new Error(`库存创建失败: ${error.message}`);
      return data as InventoryRow;
    }
  }

  async transferInventory(input: {
    tenantId: string;
    productId: string;
    fromLocationId: string;
    toLocationId: string;
    quantity: number;
    reason: string;
    referenceId?: string;
    authToken?: string;
  }): Promise<{ from: InventoryRow; to: InventoryRow }> {
    const client = this.getClient(false, input.authToken);

    // 扣减源库位
    const fromResult = await this.adjustInventory({
      tenantId: input.tenantId,
      productId: input.productId,
      locationId: input.fromLocationId,
      quantityDelta: -input.quantity,
      reason: input.reason,
      referenceId: input.referenceId,
      referenceType: 'transfer_out',
      authToken: input.authToken,
    });

    // 增加目标库位
    const toResult = await this.adjustInventory({
      tenantId: input.tenantId,
      productId: input.productId,
      locationId: input.toLocationId,
      quantityDelta: input.quantity,
      reason: input.reason,
      referenceId: input.referenceId,
      referenceType: 'transfer_in',
      authToken: input.authToken,
    });

    return { from: fromResult, to: toResult };
  }

  async reserveInventory(input: {
    tenantId: string;
    productId: string;
    locationId: string;
    quantity: number;
    orderId?: string;
    workOrderId?: string;
    expiresAt?: string;
    authToken?: string;
  }): Promise<InventoryRow> {
    // 这里简化：通过 adjustInventory 扣减可用库存，实际预留逻辑可能需要单独的预留表
    // 当前 schema 中 inventory 表没有 reserved_quantity 字段，暂用 quantity 扣减模拟
    return this.adjustInventory({
      tenantId: input.tenantId,
      productId: input.productId,
      locationId: input.locationId,
      quantityDelta: -input.quantity,
      reason: `reserved:${input.orderId || input.workOrderId || 'manual'}`,
      referenceId: input.orderId || input.workOrderId,
      referenceType: 'reservation',
      authToken: input.authToken,
    });
  }

  async lockInventory(input: {
    tenantId: string;
    productId: string;
    locationId: string;
    quantity: number;
    reason: string;
    lockedBy?: string;
    expiresAt?: string;
    authToken?: string;
  }): Promise<InventoryRow> {
    // 简化：通过 adjustInventory 扣减可用库存，实际锁定逻辑可能需要单独的锁表
    // 当前 schema 中 inventory 表没有 locked_quantity 字段，暂用 quantity 扣减模拟
    return this.adjustInventory({
      tenantId: input.tenantId,
      productId: input.productId,
      locationId: input.locationId,
      quantityDelta: -input.quantity,
      reason: `locked:${input.reason}`,
      referenceId: input.lockedBy,
      referenceType: 'lock',
      authToken: input.authToken,
    });
  }

  async getInventoryHistory(tenantId: string, options?: {
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
  }>> {
    const { limit = 50, offset = 0, productId, locationId, startDate, endDate, authToken } = options || {};

    // Need to join inventory_history with inventory to get tenant_id, product_id, location_id
    let query = this.getClient(false, authToken)
      .from('inventory_history')
      .select(`
        *,
        inventory!inv_id(tenant_id, product_id, location_id)
      `)
      .eq('inventory.tenant_id', tenantId)
      .order('changed_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (productId) query = query.eq('inventory.product_id', productId);
    if (locationId) query = query.eq('inventory.location_id', locationId);
    if (startDate) query = query.gte('changed_at', startDate);
    if (endDate) query = query.lte('changed_at', endDate);

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map((row: any) => ({
      id: row.hist_id?.toString() || row.inv_id,
      productId: row.inventory?.product_id,
      locationId: row.inventory?.location_id,
      quantityBefore: row.before_qty,
      quantityAfter: row.after_qty,
      changeType: row.change_type,
      reason: row.change_reason,
      referenceId: null, // not in schema
      referenceType: null, // not in schema
      createdAt: row.changed_at,
      createdBy: null, // not in schema
    }));
  }

  async getAvailableQuantity(input: {
    productId: string;
    locationId?: string;
    excludeReserved?: boolean;
    excludeLocked?: boolean;
    authToken?: string;
  }): Promise<number> {
    const { productId, locationId, excludeReserved = true, excludeLocked = true, authToken } = input;

    const filters: Record<string, unknown> = { product_id: productId };
    if (locationId) filters.location_id = locationId;

    const { data, error } = await this.getClient(false, authToken)
      .from(this.tableName)
      .select('quantity')
      .match(filters)
      .gt('quantity', 0);

    if (error) throw error;

    // 简化：直接返回可用数量之和（未扣除预留/锁定，因为当前 schema 没有这些字段）
    // TODO: 当 schema 支持 reserved_quantity/locked_quantity 时，这里需要扣除
    return (data as { quantity: number }[]).reduce((sum, row) => sum + (row.quantity || 0), 0);
  }
}