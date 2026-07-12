/**
 * 物料约束仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

export type ProductConstraintRow = Tables<'product_constraints'>;
export type ProductConstraintInsert = TablesInsert<'product_constraints'>;
export type ProductConstraintUpdate = TablesUpdate<'product_constraints'>;

export interface IProductConstraintRepository extends IRepository<ProductConstraintRow, ProductConstraintInsert, ProductConstraintUpdate> {
  /**
   * 按 SKU 查找约束
   */
  findBySku(skuId: string): Promise<ProductConstraintRow | null>;

  /**
   * 按租户查找所有约束
   */
  findByTenant(tenantId: string): Promise<ProductConstraintRow[]>;

  /**
   * 批量查找约束
   */
  findBySkuBatch(skuIds: string[]): Promise<ProductConstraintRow[]>;
}