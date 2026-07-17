/**
 * 租户追踪策略仓储端口接口
 * CRUD tenant_tracking_policies，封装 fn_requires_unique_tracking / fn_get_tenant_abc_tracking_default
 * 对应表：tenant_tracking_policies
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type TenantTrackingPolicyRow = Tables<'tenant_tracking_policies'>;
export type TenantTrackingPolicyInsert = TablesInsert<'tenant_tracking_policies'>;
export type TenantTrackingPolicyUpdate = TablesUpdate<'tenant_tracking_policies'>;

export interface ITenantTrackingPolicyRepository extends IRepository<
  TenantTrackingPolicyRow,
  TenantTrackingPolicyInsert,
  TenantTrackingPolicyUpdate
> {
  /**
   * 按租户查找所有追踪策略
   */
  findByTenant(tenantId: string): Promise<TenantTrackingPolicyRow[]>;

  /**
   * 按租户和 ABC 分类查找策略
   */
  findByTenantAndClass(tenantId: string, abcClass: 'A' | 'B' | 'C'): Promise<TenantTrackingPolicyRow | null>;

  /**
   * 获取租户 ABC 分类的默认追踪策略
   * 封装 RPC fn_get_tenant_abc_tracking_default(p_tenant_id, p_abc_class)
   */
  getDefaultTracking(tenantId: string, abcClass: 'A' | 'B' | 'C'): Promise<boolean | null>;

  /**
   * 判断商品/库位是否需要唯一追踪
   * 封装 RPC fn_requires_unique_tracking(p_tenant_id, p_product_id, p_location_id)
   */
  requiresUniqueTracking(tenantId: string, productId: string, locationId: string): Promise<boolean>;

  /**
   * 批量创建/更新追踪策略
   */
  upsertBatch(policies: TenantTrackingPolicyInsert[]): Promise<TenantTrackingPolicyRow[]>;

  /**
   * 删除追踪策略
   */
  deletePolicy(id: string, tenantId: string): Promise<void>;
}