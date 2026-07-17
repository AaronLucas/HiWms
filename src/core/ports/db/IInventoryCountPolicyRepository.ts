/**
 * 盘点容差策略仓储端口接口
 * CRUD inventory_count_policies，封装 fn_get_count_tolerance
 * 对应表：inventory_count_policies
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type InventoryCountPolicyRow = Tables<'inventory_count_policies'>;
export type InventoryCountPolicyInsert = TablesInsert<'inventory_count_policies'>;
export type InventoryCountPolicyUpdate = TablesUpdate<'inventory_count_policies'>;

export interface IInventoryCountPolicyRepository extends IRepository<InventoryCountPolicyRow, InventoryCountPolicyInsert, InventoryCountPolicyUpdate> {
  /**
   * 按租户查找所有盘点策略
   */
  findByTenant(tenantId: string): Promise<InventoryCountPolicyRow[]>;

  /**
   * 按产品查找盘点策略
   */
  findByProduct(tenantId: string, productId: string): Promise<InventoryCountPolicyRow[]>;

  /**
   * 获取盘点容差（封装 RPC fn_get_count_tolerance）
   * @returns 容差值（数量或百分比）
   */
  getCountTolerance(tenantId: string, productId: string): Promise<number>;

  /**
   * 获取默认盘点容差（租户级）
   */
  getDefaultTolerance(tenantId: string): Promise<number>;

  /**
   * 批量创建/更新盘点策略
   */
  upsertBatch(policies: InventoryCountPolicyInsert[]): Promise<InventoryCountPolicyRow[]>;
}