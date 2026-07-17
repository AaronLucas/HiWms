/**
 * Supabase 租户追踪策略仓储实现
 * CRUD tenant_tracking_policies，封装 fn_requires_unique_tracking / fn_get_tenant_abc_tracking_default
 * 对应表：tenant_tracking_policies
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import {
  ITenantTrackingPolicyRepository,
  TenantTrackingPolicyRow,
  TenantTrackingPolicyInsert,
  TenantTrackingPolicyUpdate,
} from '@core/ports/db/ITenantTrackingPolicyRepository';
import { SupabaseRpcClient } from '../rpc/SupabaseRpcClient';
import { WmsSupabaseClient } from '../SupabaseClient';

export class SupabaseTenantTrackingPolicyRepository extends SupabaseBaseRepository<
  TenantTrackingPolicyRow,
  TenantTrackingPolicyInsert,
  TenantTrackingPolicyUpdate,
  string
> implements ITenantTrackingPolicyRepository {
  protected tableName = 'tenant_tracking_policies';
  protected idColumn = 'id';

  constructor(
    protected supabase: WmsSupabaseClient,
    private rpcClient: SupabaseRpcClient
  ) {
    super(supabase);
  }

  /**
   * 按租户查找所有追踪策略
   */
  async findByTenant(tenantId: string): Promise<TenantTrackingPolicyRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('abc_class', { ascending: true });

    if (error) throw error;
    return (data as TenantTrackingPolicyRow[]) || [];
  }

  /**
   * 按租户和 ABC 分类查找策略
   */
  async findByTenantAndClass(tenantId: string, abcClass: 'A' | 'B' | 'C'): Promise<TenantTrackingPolicyRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('abc_class', abcClass)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as TenantTrackingPolicyRow;
  }

  /**
   * 获取租户 ABC 分类的默认追踪策略
   * 封装 RPC fn_get_tenant_abc_tracking_default(p_tenant_id, p_abc_class)
   */
  async getDefaultTracking(tenantId: string, abcClass: 'A' | 'B' | 'C'): Promise<boolean | null> {
    const result = await this.rpcClient.raw('fn_get_tenant_abc_tracking_default', {
      p_tenant_id: tenantId,
      p_abc_class: abcClass,
    });
    return result === true || result === false ? result : null;
  }

  /**
   * 判断商品/库位是否需要唯一追踪
   * 封装 RPC fn_requires_unique_tracking(p_tenant_id, p_product_id, p_location_id)
   */
  async requiresUniqueTracking(tenantId: string, productId: string, locationId: string): Promise<boolean> {
    const result = await this.rpcClient.raw('fn_requires_unique_tracking', {
      p_tenant_id: tenantId,
      p_product_id: productId,
      p_location_id: locationId,
    });
    return result === true;
  }

  /**
   * 批量创建/更新追踪策略
   */
  async upsertBatch(policies: TenantTrackingPolicyInsert[]): Promise<TenantTrackingPolicyRow[]> {
    if (policies.length === 0) return [];

    const { data, error } = await this.getClient(true)
      .from(this.tableName)
      .upsert(policies as any, {
        onConflict: 'tenant_id,abc_class',
        ignoreDuplicates: false,
      })
      .select();

    if (error) throw error;
    return (data as TenantTrackingPolicyRow[]) || [];
  }

  /**
   * 删除追踪策略
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