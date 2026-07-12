/**
 * Supabase 物料约束仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IProductConstraintRepository, ProductConstraintRow, ProductConstraintInsert, ProductConstraintUpdate } from '@core/ports/db/IProductConstraintRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

export class SupabaseProductConstraintRepository extends SupabaseBaseRepository<
  ProductConstraintRow,
  ProductConstraintInsert,
  ProductConstraintUpdate,
  string
> implements IProductConstraintRepository {
  protected tableName = 'product_constraints';
  protected idColumn = 'sku_id';

  async findBySku(skuId: string): Promise<ProductConstraintRow | null> {
    return this.findById(skuId);
  }

  async findByTenant(tenantId: string): Promise<ProductConstraintRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*, products!inner(tenant_id)')
      .eq('products.tenant_id', tenantId);

    if (error) throw error;
    return (data || []) as ProductConstraintRow[];
  }

  async findBySkuBatch(skuIds: string[]): Promise<ProductConstraintRow[]> {
    const uniqueIds = [...new Set(skuIds)];
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .in('sku_id', uniqueIds);

    if (error) throw error;
    return (data || []) as ProductConstraintRow[];
  }
}