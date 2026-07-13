/**
 * 包装规格仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IPackageSpecRepository } from '@core/ports/db/IPackageSpecRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type PackageSpecRow = Tables<'package_specs'>;
type PackageSpecInsert = TablesInsert<'package_specs'>;
type PackageSpecUpdate = TablesUpdate<'package_specs'>;

export class SupabasePackageSpecRepository extends SupabaseBaseRepository<
  PackageSpecRow,
  PackageSpecInsert,
  PackageSpecUpdate,
  string
> implements IPackageSpecRepository {
  protected tableName = 'package_specs';
  protected idColumn = 'id';

  async findBySku(skuId: string, tenantId: string): Promise<PackageSpecRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .or(`sku_id.is.null,sku_id.eq.${skuId}`)
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (error) throw error;
    return (data as PackageSpecRow[]) || [];
  }

  async findDefault(tenantId: string, boxType?: string): Promise<PackageSpecRow | null> {
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_default', true)
      .eq('is_active', true);

    if (boxType) query = query.eq('box_type', boxType);

    const { data, error } = await query.single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as PackageSpecRow;
  }

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; boxType?: string; isActive?: boolean }
  ): Promise<PackageSpecRow[]> {
    const { limit = 100, offset = 0, boxType, isActive } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (boxType) query = query.eq('box_type', boxType);
    if (isActive !== undefined) query = query.eq('is_active', isActive);

    const { data, error } = await query;
    if (error) throw error;
    return (data as PackageSpecRow[]) || [];
  }

  async findSuitable(
    tenantId: string,
    qty: number,
    weight?: number,
    volume?: number
  ): Promise<PackageSpecRow[]> {
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .gte('max_qty', qty);

    if (weight !== undefined) query = query.gte('max_weight', weight);

    const { data, error } = await query;
    if (error) throw error;
    return (data as PackageSpecRow[]) || [];
  }
}