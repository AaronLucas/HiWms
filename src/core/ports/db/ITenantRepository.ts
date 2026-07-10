/**
 * 租户仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

export type TenantRow = Tables<'tenants'>;
export type TenantInsert = TablesInsert<'tenants'>;
export type TenantUpdate = TablesUpdate<'tenants'>;

export interface ITenantRepository extends IRepository<TenantRow, TenantInsert, TenantUpdate> {
  /**
   * 按名称查找租户
   */
  findByName(name: string): Promise<TenantRow | null>;

  /**
   * 查找所有激活租户
   */
  findActive(): Promise<TenantRow[]>;

  /**
   * 更新租户计费策略
   */
  updateBillingStrategy(tenantId: string, strategy: Record<string, unknown>): Promise<TenantRow>;
}