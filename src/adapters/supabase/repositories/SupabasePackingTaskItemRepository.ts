/**
 * Supabase 打包明细行仓储实现
 * packing_task_items CRUD、同箱/同码去重逻辑
 * 对应表：packing_task_items
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import {
  IPackingTaskItemRepository,
  PackingTaskItemRow,
  PackingTaskItemInsert,
  PackingTaskItemUpdate,
} from '@core/ports/db/IPackingTaskItemRepository';
import { WmsSupabaseClient } from '../SupabaseClient';

export class SupabasePackingTaskItemRepository extends SupabaseBaseRepository<
  PackingTaskItemRow,
  PackingTaskItemInsert,
  PackingTaskItemUpdate,
  string
> implements IPackingTaskItemRepository {
  protected tableName = 'packing_task_items';
  protected idColumn = 'id';

  constructor(protected supabase: WmsSupabaseClient) {
    super(supabase);
  }

  /**
   * 按打包任务查找明细行
   */
  async findByPackingTask(packingTaskId: string, tenantId: string): Promise<PackingTaskItemRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('packing_task_id', packingTaskId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as PackingTaskItemRow[]) || [];
  }

  /**
   * 按订单行查找明细行
   */
  async findByOrderLine(orderLineId: string, tenantId: string): Promise<PackingTaskItemRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('order_line_id', orderLineId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as PackingTaskItemRow[]) || [];
  }

  /**
   * 按容器查找明细行
   */
  async findByContainer(containerId: string, tenantId: string): Promise<PackingTaskItemRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('container_id', containerId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as PackingTaskItemRow[]) || [];
  }

  /**
   * 按产品查找明细行（同码去重用）
   */
  async findByProduct(packingTaskId: string, productId: string, tenantId: string): Promise<PackingTaskItemRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('packing_task_id', packingTaskId)
      .eq('product_id', productId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as PackingTaskItemRow[]) || [];
  }

  /**
   * 批量插入明细行（支持同箱/同码去重）
   * 如果同一 packing_task_id + product_id + container_id 已存在，则合并数量
   */
  async insertBatch(items: PackingTaskItemInsert[], dedupe = true): Promise<PackingTaskItemRow[]> {
    if (items.length === 0) return [];

    const results: PackingTaskItemRow[] = [];

    for (const item of items) {
      if (dedupe && item.packing_task_id && item.product_id && item.container_id) {
        // 查找是否已存在相同的 packing_task + product + container 组合
        const existing = await this.findByProduct(item.packing_task_id, item.product_id, item.tenant_id || '');
        const match = existing.find(e => e.container_id === item.container_id);

        if (match) {
          // 合并数量
          const newQty = (match.qty || 0) + (item.qty || 0);
          const updated = await this.updateQty(match.id, item.tenant_id || '', newQty);
          if (updated) results.push(updated);
          continue;
        }
      }

      // 插入新行
      const { data, error } = await this.getClient()
        .from(this.tableName)
        .insert(item as any)
        .select()
        .single();

      if (error) throw error;
      results.push(data as PackingTaskItemRow);
    }

    return results;
  }

  /**
   * 更新明细行数量
   */
  async updateQty(id: string, tenantId: string, qty: number): Promise<PackingTaskItemRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .update({ qty, updated_at: new Date().toISOString() } as PackingTaskItemUpdate)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as PackingTaskItemRow;
  }

  /**
   * 关联容器（封箱时调用）
   */
  async assignContainer(ids: string[], containerId: string, tenantId: string): Promise<number> {
    if (ids.length === 0) return 0;

    const { data, error } = await this.getClient()
      .from(this.tableName)
      .update({ container_id: containerId, updated_at: new Date().toISOString() } as PackingTaskItemUpdate)
      .in('id', ids)
      .eq('tenant_id', tenantId)
      .select('id');

    if (error) throw error;
    return (data as { id: string }[])?.length || 0;
  }

  /**
   * 获取打包任务的明细统计
   */
  async getStatsByPackingTask(packingTaskId: string, tenantId: string): Promise<{
    totalItems: number;
    totalQty: number;
    byProduct: Array<{ productId: string; qty: number }>;
    byContainer: Array<{ containerId: string; itemCount: number }>;
  }> {
    const items = await this.findByPackingTask(packingTaskId, tenantId);

    const byProductMap = new Map<string, number>();
    const byContainerMap = new Map<string, number>();

    for (const item of items) {
      byProductMap.set(item.product_id || '', (byProductMap.get(item.product_id || '') || 0) + (item.qty || 0));
      if (item.container_id) {
        byContainerMap.set(item.container_id, (byContainerMap.get(item.container_id) || 0) + 1);
      }
    }

    return {
      totalItems: items.length,
      totalQty: items.reduce((sum, item) => sum + (item.qty || 0), 0),
      byProduct: Array.from(byProductMap.entries()).map(([productId, qty]) => ({ productId, qty })),
      byContainer: Array.from(byContainerMap.entries()).map(([containerId, itemCount]) => ({ containerId, itemCount })),
    };
  }

  /**
   * 删除打包任务的所有明细行
   */
  async deleteByPackingTask(packingTaskId: string, tenantId: string): Promise<number> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .delete()
      .eq('packing_task_id', packingTaskId)
      .eq('tenant_id', tenantId)
      .select('id');

    if (error) throw error;
    return (data as { id: string }[])?.length || 0;
  }
}