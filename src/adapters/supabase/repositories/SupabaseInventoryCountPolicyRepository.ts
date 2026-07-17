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
    const { data, error } = await this.getClient(true)
      .from(this.tableName)
      .upsert(policies as any, {
        onConflict: 'tenant_id,product_id',
        ignoreDuplicates: false,
      })
      .select();

    if (error) throw error;
    return (data as InventoryCountPolicyRow[]) || [];
  }

  /**
   * 创建或更新单个盘点策略
   */
  async upsertPolicy(policy: InventoryCountPolicyInsert): Promise<InventoryCountPolicyRow> {
    const { data, error } = await this.getClient(true)
      .from(this.tableName)
      .upsert(policy as any, {
        onConflict: 'tenant_id,product_id',
        ignoreDuplicates: false,
      })
      .select()
      .single();

    if (error) throw error;
    return data as InventoryCountPolicyRow;
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
