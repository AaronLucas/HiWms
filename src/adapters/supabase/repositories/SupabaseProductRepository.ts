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
  protected tableName = 'products' as const;
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
    options: { limit?: number; offset?: number; abcClass?: string; authToken?: string } = {}
  ): Promise<ProductRow[]> {
    const { limit = 50, offset = 0, abcClass, authToken } = options;
    const filters: Record<string, unknown> = { tenant_id: tenantId };
    if (abcClass) filters.abc_class = abcClass;

    return this.findAll({ limit, offset, filters, orderBy: 'sku', ascending: true, authToken });
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

  async search(query: string, tenantId: string, authToken?: string): Promise<ProductRow[]> {
    const { data, error } = await this.getClient(false, authToken)
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

  async getConstraints(productId: string): Promise<Tables<'product_constraints'> | null> {
    const { data, error } = await this.getClient()
      .from('product_constraints')
      .select('*')
      .eq('product_id', productId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as Tables<'product_constraints'>;
  }

  // ===== Sprint 6: 商品全量写操作 =====

  async addBarcode(productId: string, barcode: string, targetType: string, targetSubtype?: string, isPrimary?: boolean): Promise<Tables<'barcode_mappings'>> {
    const product = await this.findById(productId);
    if (!product) throw new Error('产品不存在');

    const { data, error } = await this.getClient()
      .from('barcode_mappings')
      .insert({
        target_id: productId,
        target_table: 'products',
        target_type: targetType,
        target_subtype: targetSubtype ?? null,
        barcode,
        tenant_id: product.tenant_id,
      })
      .select()
      .single();

    if (error) throw new Error(`添加条码失败: ${error.message}`);
    return data as Tables<'barcode_mappings'>;
  }

  async removeBarcode(barcodeId: string): Promise<void> {
    const { error } = await this.getClient()
      .from('barcode_mappings')
      .delete()
      .eq('id', barcodeId);

    if (error) throw new Error(`删除条码失败: ${error.message}`);
  }

  async getBarcodes(productId: string): Promise<Tables<'barcode_mappings'>[]> {
    const { data, error } = await this.getClient()
      .from('barcode_mappings')
      .select('*')
      .eq('target_id', productId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as Tables<'barcode_mappings'>[]) || [];
  }

  async upsertConstraint(productId: string, constraintType: string, constraintValue: string, severity?: string): Promise<Tables<'product_constraints'>> {
    // product_constraints is a 1:1 table with products, use product_id as conflict key
    const updateData: Record<string, unknown> = { product_id: productId, updated_at: new Date().toISOString() };

    // Map constraintType to actual columns
    switch (constraintType) {
      case 'location_type':
        updateData.required_zone_type = constraintValue;
        break;
      case 'temperature':
        updateData.storage_temp_range = constraintValue;
        break;
      case 'hazardous':
        updateData.is_dangerous = constraintValue === 'true';
        break;
      case 'segregation':
        updateData.hazmat_incompatibility_tags = constraintValue ? [constraintValue] : [];
        break;
      case 'expiry_threshold':
        updateData.expiry_threshold_days = parseInt(constraintValue, 10);
        break;
      case 'max_out_fridge':
        updateData.max_out_fridge_seconds = parseInt(constraintValue, 10);
        break;
      case 'must_scan_sn':
        updateData.must_scan_sn = constraintValue === 'true';
        break;
      case 'requires_unique_tracking':
        updateData.requires_unique_tracking = constraintValue === 'true';
        break;
      case 'hs_code':
        updateData.hs_code = constraintValue;
        break;
      default:
        throw new Error(`未知的约束类型: ${constraintType}`);
    }

    const { data, error } = await this.getClient()
      .from('product_constraints')
      .upsert(updateData, { onConflict: 'product_id' })
      .select()
      .single();

    if (error) throw new Error(`添加/更新约束失败: ${error.message}`);
    return data as Tables<'product_constraints'>;
  }

  async removeConstraint(constraintId: string): Promise<void> {
    // Since it's 1:1, constraintId should be product_id
    const { error } = await this.getClient()
      .from('product_constraints')
      .delete()
      .eq('product_id', constraintId);

    if (error) throw new Error(`删除约束失败: ${error.message}`);
  }
}