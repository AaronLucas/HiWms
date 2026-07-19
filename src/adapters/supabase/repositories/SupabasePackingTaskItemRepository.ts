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
   * 去重键与真实唯一索引（uq_packing_task_items_no_container /
   * uq_packing_task_items_with_container，见 003 迁移）严格对齐：
   * packing_task_id + order_line_id（+ container_id，为空时按 IS NULL 匹配），
   * 不是 product_id——同一打包任务里两个不同订单行凑巧同码不应被合并。
   * 用乐观并发重试（基于 updated_at 比对）而非"先查后写"，避免并发批量插入
   * 命中数据库唯一索引时抛出未捕获的 23505。
   */
  async insertBatch(items: PackingTaskItemInsert[], dedupe = true): Promise<PackingTaskItemRow[]> {
    if (items.length === 0) return [];

    const results: PackingTaskItemRow[] = [];

    for (const item of items) {
      if (dedupe && item.packing_task_id && item.order_line_id) {
        results.push(await this.upsertDedupedItem(item));
        continue;
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
   * 按 packing_task_id + order_line_id (+ container_id) 查找去重匹配行
   */
  private async findDedupMatch(
    packingTaskId: string,
    orderLineId: string,
    containerId: string | null | undefined,
    tenantId: string
  ): Promise<PackingTaskItemRow | null> {
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('packing_task_id', packingTaskId)
      .eq('order_line_id', orderLineId)
      .eq('tenant_id', tenantId);

    query = containerId ? query.eq('container_id', containerId) : query.is('container_id', null);

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return (data as PackingTaskItemRow) ?? null;
  }

  /**
   * 乐观并发重试插入/合并一行：插入撞唯一索引（23505）或更新撞
   * updated_at 比对失败（乐观锁丢失）都视为"被并发请求抢先"，重新读取后重试。
   */
  private async upsertDedupedItem(item: PackingTaskItemInsert): Promise<PackingTaskItemRow> {
    const packingTaskId = item.packing_task_id as string;
    const orderLineId = item.order_line_id as string;
    const containerId = item.container_id ?? null;
    const tenantId = item.tenant_id || '';
    const qty = item.qty || 0;

    // 在高并发下（多个请求同一轮读到完全相同的 updated_at 快照），每一轮重试理论上只能
    // 保证恰好 1 个请求胜出，最坏情形下所需轮数与并发请求数同量级。用随机退避打散"所有
    // 落败者在同一轮再次撞车"的整队重试模式，把收敛所需轮数从最坏情形拉回到期望意义上的常数级。
    const MAX_ATTEMPTS = 20;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10 * attempt));
      }

      const existing = await this.findDedupMatch(packingTaskId, orderLineId, containerId, tenantId);

      if (!existing) {
        const { data, error } = await this.getClient()
          .from(this.tableName)
          .insert(item as any)
          .select()
          .single();

        if (!error) return data as PackingTaskItemRow;
        if ((error as { code?: string }).code !== '23505') throw error;
        continue; // 插入撞了唯一索引，说明并发请求已建行，回到循环重新读取后走合并
      }

      const { data, error } = await this.getClient()
        .from(this.tableName)
        .update({ qty: (existing.qty || 0) + qty, updated_at: new Date().toISOString() } as PackingTaskItemUpdate)
        .eq('id', existing.id)
        .eq('updated_at', existing.updated_at as string)
        .select()
        .single();

      if (!error) return data as PackingTaskItemRow;
      if ((error as { code?: string }).code !== 'PGRST116') throw error;
      // updated_at 比对未命中（乐观锁丢失，被并发请求抢先更新），重新读取后重试
    }

    throw new Error(
      `insertBatch: failed to reconcile duplicate packing_task_item after ${MAX_ATTEMPTS} attempts ` +
      `(packing_task_id=${packingTaskId}, order_line_id=${orderLineId}, container_id=${containerId ?? 'NULL'})`
    );
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