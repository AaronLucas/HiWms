/**
 * Supabase 库存历史仓储实现
 * 只读查询，用于审计追踪 - 不继承 SupabaseBaseRepository 因为 hist_id 是数字类型
 */
import { IInventoryHistoryRepository } from '@core/ports/db/IInventoryHistoryRepository';
import { WmsSupabaseClient } from '../SupabaseClient';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type InventoryHistoryRow = Tables<'inventory_history'>;
type InventoryHistoryInsert = TablesInsert<'inventory_history'>;
type InventoryHistoryUpdate = TablesUpdate<'inventory_history'>;

export class SupabaseInventoryHistoryRepository implements IInventoryHistoryRepository {
  constructor(protected supabase: WmsSupabaseClient) {}

  protected getClient(useAdmin = false): any {
    return useAdmin ? this.supabase.getAdminClient() : this.supabase.getClient();
  }

  async findById(id: number): Promise<InventoryHistoryRow | null> {
    const { data, error } = await this.getClient()
      .from('inventory_history')
      .select('*')
      .eq('hist_id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as InventoryHistoryRow;
  }

  async findAll(options: {
    limit?: number;
    offset?: number;
    orderBy?: string;
    ascending?: boolean;
    filters?: Record<string, unknown>;
  } = {}): Promise<InventoryHistoryRow[]> {
    const { limit = 100, offset = 0, orderBy = 'changed_at', ascending = false, filters = {} } = options;
    let query = this.getClient()
      .from('inventory_history')
      .select('*')
      .order(orderBy, { ascending })
      .range(offset, offset + limit - 1);

    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null) {
        query = query.eq(key, value);
      }
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data as InventoryHistoryRow[]) || [];
  }

  async count(filters: Record<string, unknown> = {}): Promise<number> {
    let query = this.getClient()
      .from('inventory_history')
      .select('*', { count: 'exact', head: true });

    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null) {
        query = query.eq(key, value);
      }
    }

    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  }

  async create(data: InventoryHistoryInsert): Promise<InventoryHistoryRow> {
    throw new Error('Inventory history is read-only');
  }

  async createMany(data: InventoryHistoryInsert[]): Promise<InventoryHistoryRow[]> {
    throw new Error('Inventory history is read-only');
  }

  async update(id: number, data: InventoryHistoryUpdate): Promise<InventoryHistoryRow> {
    throw new Error('Inventory history is read-only');
  }

  async delete(id: number): Promise<void> {
    throw new Error('Inventory history is read-only');
  }

  async exists(id: number): Promise<boolean> {
    const { data, error } = await this.getClient()
      .from('inventory_history')
      .select('hist_id')
      .eq('hist_id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return false;
      throw error;
    }
    return !!data;
  }

  async findByInventory(inventoryId: string): Promise<InventoryHistoryRow[]> {
    const { data, error } = await this.getClient()
      .from('inventory_history')
      .select('*')
      .eq('inv_id', inventoryId)
      .order('changed_at', { ascending: false });

    if (error) throw error;
    return (data as InventoryHistoryRow[]) || [];
  }

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; changeType?: string; startDate?: string; endDate?: string }
  ): Promise<InventoryHistoryRow[]> {
    const { limit = 100, offset = 0, changeType, startDate, endDate } = options || {};
    let query = this.getClient()
      .from('inventory_history')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('changed_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (changeType) query = query.eq('change_type', changeType);
    if (startDate) query = query.gte('changed_at', startDate);
    if (endDate) query = query.lte('changed_at', endDate);

    const { data, error } = await query;
    if (error) throw error;
    return (data as InventoryHistoryRow[]) || [];
  }

  async getStats(tenantId: string, startDate: string, endDate: string): Promise<{
    totalChanges: number;
    totalQtyChange: number;
    byType: Record<string, { count: number; totalQty: number }>;
    byProduct: Record<string, { count: number; totalQty: number }>;
  }> {
    const { data, error } = await this.getClient()
      .from('inventory_history')
      .select('change_type, change_qty, inv_id')
      .eq('tenant_id', tenantId)
      .gte('changed_at', startDate)
      .lte('changed_at', endDate);

    if (error) throw error;
    const history = data as { change_type: string; change_qty: number; inv_id: string | null }[];

    const byType: Record<string, { count: number; totalQty: number }> = {};
    const byProduct: Record<string, { count: number; totalQty: number }> = {};
    let totalChanges = 0, totalQtyChange = 0;

    for (const h of history) {
      totalChanges++;
      totalQtyChange += h.change_qty || 0;

      if (!byType[h.change_type]) byType[h.change_type] = { count: 0, totalQty: 0 };
      byType[h.change_type].count++;
      byType[h.change_type].totalQty += h.change_qty || 0;

      if (h.inv_id) {
        if (!byProduct[h.inv_id]) byProduct[h.inv_id] = { count: 0, totalQty: 0 };
        byProduct[h.inv_id].count++;
        byProduct[h.inv_id].totalQty += h.change_qty || 0;
      }
    }

    return { totalChanges, totalQtyChange, byType, byProduct };
  }
}