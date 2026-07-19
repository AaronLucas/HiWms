/**
 * Supabase 盘点容差策略仓储实现
 * CRUD inventory_count_policies，封装 fn_get_count_tolerance
 * 对应表：inventory_count_policies
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IInventoryCountPolicyRepository, InventoryCountPolicyRow, InventoryCountPolicyInsert, InventoryCountPolicyUpdate } from '@core/ports/db/IInventoryCountPolicyRepository';
import { SupabaseRpcClient } from '../rpc/SupabaseRpcClient';
import { WmsSupabaseClient } from '../SupabaseClient';

export class SupabaseInventoryCountPolicyRepository extends SupabaseBaseRepository<
  InventoryCountPolicyRow,
  InventoryCountPolicyInsert,
  InventoryCountPolicyUpdate,
  string
> implements IInventoryCountPolicyRepository {
  protected tableName = 'inventory_count_policies';
  protected idColumn = 'id';

  constructor(
    protected supabase: WmsSupabaseClient,
    private rpcClient: SupabaseRpcClient
  ) {
    super(supabase);
  }

  /**
   * 按租户查找所有盘点策略
   */
  async findByTenant(tenantId: string): Promise<InventoryCountPolicyRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as InventoryCountPolicyRow[]) || [];
  }

  /**
   * 按产品查找盘点策略
   */
  async findByProduct(tenantId: string, productId: string): Promise<InventoryCountPolicyRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as InventoryCountPolicyRow[]) || [];
  }

  /**
   * 获取盘点容差（封装 RPC fn_get_count_tolerance）
   * @returns 容差值
   */
  async getCountTolerance(tenantId: string, productId: string): Promise<number> {
    const result = await this.rpcClient.raw('fn_get_count_tolerance', {
      p_tenant_id: tenantId,
      p_product_id: productId,
    });
    return Number(result) || 0;
  }

  /**
   * 获取默认盘点容差（租户级，无 product_id 筛选）
   */
  async getDefaultTolerance(tenantId: string): Promise<number> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('tolerance_qty')
      .eq('tenant_id', tenantId)
      .is('product_id', null)
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return 0;
      throw error;
    }
    return Number(data?.tolerance_qty) || 0;
  }

  /**
   * 批量创建/更新盘点策略
   */
  async upsertBatch(policies: InventoryCountPolicyInsert[]): Promise<InventoryCountPolicyRow[]> {
    const results: InventoryCountPolicyRow[] = [];
    for (const policy of policies) {
      results.push(await this.upsertPolicy(policy));
    }
    return results;
  }

  /**
   * 创建或更新单个盘点策略
   * 表上只有两条局部唯一索引（`uq_count_policy_tenant_default (tenant_id) WHERE
   * product_id IS NULL` / `uq_count_policy_tenant_product (tenant_id, product_id)
   * WHERE product_id IS NOT NULL`，见 CONVENTIONS.md §5.4.8 的既定设计约定），没有
   * 覆盖 (tenant_id, product_id) 的普通唯一约束。原实现用 PostgREST 的
   * `.upsert({ onConflict: 'tenant_id,product_id' })`，但 PostgREST 的 on_conflict
   * 只能匹配非分区唯一索引，对分区索引必定报 `42P10 there is no unique or exclusion
   * constraint matching the ON CONFLICT specification`（已用 curl 直连 PostgREST
   * 端点实测复现）——每次调用都会失败。改为查找后写入 + 乐观并发重试（与 P0 第 3 项
   * PackingTaskItemRepository 同一类根因：PostgREST upsert 与真实分区唯一索引设计
   * 不兼容）。
   */
  async upsertPolicy(policy: InventoryCountPolicyInsert): Promise<InventoryCountPolicyRow> {
    const tenantId = policy.tenant_id as string;
    const productId = policy.product_id ?? null;

    const MAX_ATTEMPTS = 5;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10 * attempt));
      }

      const existing = await this.findExistingPolicy(tenantId, productId);

      if (!existing) {
        const { data, error } = await this.getClient(true)
          .from(this.tableName)
          .insert(policy as any)
          .select()
          .single();

        if (!error) return data as InventoryCountPolicyRow;
        if ((error as { code?: string }).code !== '23505') throw error;
        continue; // 插入撞了唯一索引，说明并发请求已建行，回到循环重新读取后走合并
      }

      const { data, error } = await this.getClient(true)
        .from(this.tableName)
        .update({ tolerance_qty: policy.tolerance_qty, updated_at: new Date().toISOString() } as any)
        .eq('id', existing.id)
        .eq('updated_at', existing.updated_at as string)
        .select()
        .single();

      if (!error) return data as InventoryCountPolicyRow;
      if ((error as { code?: string }).code !== 'PGRST116') throw error;
      // updated_at 比对未命中（乐观锁丢失，被并发请求抢先更新），重新读取后重试
    }

    throw new Error(
      `upsertPolicy: failed to reconcile duplicate inventory_count_policy after ${MAX_ATTEMPTS} attempts ` +
      `(tenant_id=${tenantId}, product_id=${productId ?? 'NULL'})`
    );
  }

  /**
   * 按 tenant_id (+ product_id) 查找已存在的策略行（product_id 为 NULL 时按 IS NULL 匹配）
   */
  private async findExistingPolicy(tenantId: string, productId: string | null): Promise<InventoryCountPolicyRow | null> {
    let query = this.getClient(true)
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId);

    query = productId ? query.eq('product_id', productId) : query.is('product_id', null);

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return (data as InventoryCountPolicyRow) ?? null;
  }

  /**
   * 删除盘点策略
   */
  async deletePolicy(id: string, tenantId: string): Promise<void> {
    const { error } = await this.getClient()
      .from(this.tableName)
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) throw error;
  }
}
