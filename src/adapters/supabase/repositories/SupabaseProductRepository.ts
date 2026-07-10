/**
 * Supabase 产品仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IProductRepository } from '../../../core/ports/db/IProductRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type ProductRow = Tables<'products'>;
type ProductInsert = TablesInsert<'products'>;
type ProductUpdate = TablesUpdate<'products'>;

export class SupabaseProductRepository extends SupabaseBaseRepository<
  ProductRow,
  ProductInsert,
  ProductUpdate,
  string
> implements IProductRepository {
  protected tableName = 'products';
  protected idColumn = 'id';

  async findBySku(sku: string): Promise<ProductRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('sku', sku)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as ProductRow;
  }

  async findByTenant(
    tenantId: string,
    options: { limit?: number; offset?: number; abcClass?: string } = {}
  ): Promise<ProductRow[]> {
    const { limit = 50, offset = 0, abcClass } = options;
    const filters: Record<string, unknown> = { tenant_id: tenantId };
    if (abcClass) filters.abc_class = abcClass;

    return this.findAll({ limit, offset, filters, orderBy: 'sku', ascending: true });
  }

  async findWithConstraints(productId: string): Promise<{
    product: ProductRow;
    constraints: Tables<'product_constraints'> | null;
  } | null> {
    const [product, constraints] = await Promise.all([
      this.findById(productId),
      this.getClient()
        .from('product_constraints')
        .select('*')
        .eq('product_id', productId)
        .single(),
    ]);

    if (!product) return null;
    return { product, constraints: (constraints.data as Tables<'product_constraints'>) ?? null };
  }

  async updateAbcClass(productId: string, abcClass: string): Promise<ProductRow> {
    return this.update(productId, { abc_class: abcClass, updated_at: new Date().toISOString() } as TablesUpdate<'products'>);
  }

  async search(query: string, tenantId: string): Promise<ProductRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .or(`name.ilike.%${query}%,sku.ilike.%${query}%`)
      .order('sku', { ascending: true });

    if (error) throw error;
    return (data as ProductRow[]) || [];
  }

  async skuExists(sku: string, tenantId?: string): Promise<boolean> {
    let query = this.getClient()
      .from(this.tableName)
      .select('id')
      .eq('sku', sku);

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data, error } = await query.limit(1);
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }
}