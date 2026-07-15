/**
 * Supabase 耗材使用仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IConsumableUsageRepository } from '@core/ports/db/IConsumableUsageRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type ConsumableUsageRow = Tables<'consumable_usages'>;
type ConsumableUsageInsert = TablesInsert<'consumable_usages'>;
type ConsumableUsageUpdate = TablesUpdate<'consumable_usages'>;

export class SupabaseConsumableUsageRepository extends SupabaseBaseRepository<
  ConsumableUsageRow,
  ConsumableUsageInsert,
  ConsumableUsageUpdate,
  string
> implements IConsumableUsageRepository {
  protected tableName = 'consumable_usages';
  protected idColumn = 'id';

  async findByTenant(
    tenantId: string,
    options?: {
      limit?: number;
      offset?: number;
      packingTaskId?: string;
      itemType?: string;
      startDate?: string;
      endDate?: string;
    }
  ): Promise<ConsumableUsageRow[]> {
    const { limit = 100, offset = 0, packingTaskId, itemType, startDate, endDate } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('used_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (packingTaskId) query = query.eq('packing_task_id', packingTaskId);
    if (itemType) query = query.eq('item_type', itemType);
    if (startDate) query = query.gte('used_at', startDate);
    if (endDate) query = query.lte('used_at', endDate);

    const { data, error } = await query;
    if (error) throw error;
    return (data as ConsumableUsageRow[]) || [];
  }

  async findByPackingTask(packingTaskId: string): Promise<ConsumableUsageRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('packing_task_id', packingTaskId)
      .order('used_at', { ascending: true });

    if (error) throw error;
    return (data as ConsumableUsageRow[]) || [];
  }

  async recordUsage(data: ConsumableUsageInsert): Promise<ConsumableUsageRow> {
    return this.create(data);
  }

  async getStats(tenantId: string, startDate: string, endDate: string): Promise<{
    totalQty: number;
    totalCost: number;
    byType: Record<string, { qty: number; cost: number }>;
    byTask: Record<string, { qty: number; cost: number }>;
  }> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('item_type, qty, total_cost, packing_task_id')
      .eq('tenant_id', tenantId)
      .gte('used_at', startDate)
      .lte('used_at', endDate);

    if (error) throw error;
    const usages = data as { item_type: string; qty: number; total_cost: number; packing_task_id: string }[];

    const byType: Record<string, { qty: number; cost: number }> = {};
    const byTask: Record<string, { qty: number; cost: number }> = {};
    let totalQty = 0, totalCost = 0;

    for (const u of usages) {
      totalQty += u.qty;
      totalCost += u.total_cost || 0;

      if (!byType[u.item_type]) byType[u.item_type] = { qty: 0, cost: 0 };
      byType[u.item_type].qty += u.qty;
      byType[u.item_type].cost += u.total_cost || 0;

      if (!byTask[u.packing_task_id]) byTask[u.packing_task_id] = { qty: 0, cost: 0 };
      byTask[u.packing_task_id].qty += u.qty;
      byTask[u.packing_task_id].cost += u.total_cost || 0;
    }

    return { totalQty, totalCost, byType, byTask };
  }

  async getLowStockAlerts(tenantId: string, thresholdDays: number): Promise<Array<{
    itemCode: string;
    itemType: string;
    avgDailyUsage: number;
    estimatedDaysLeft: number;
  }>> {
    // This would typically query inventory of consumables
    // For now, return empty array - implementation depends on consumable inventory table
    return [];
  }
}