/**
 * Supabase VAS BOM 仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IVasBomRepository } from '@core/ports/db/IVasBomRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type VasBomRow = Tables<'vas_boms'>;
type VasBomInsert = TablesInsert<'vas_boms'>;
type VasBomUpdate = TablesUpdate<'vas_boms'>;

type VasBomItemRow = Tables<'vas_bom_items'>;
type VasBomItemInsert = TablesInsert<'vas_bom_items'>;
type VasBomItemUpdate = TablesUpdate<'vas_bom_items'>;

export class SupabaseVasBomRepository extends SupabaseBaseRepository<
  VasBomRow,
  VasBomInsert,
  VasBomUpdate,
  string
> implements IVasBomRepository {
  protected tableName = 'vas_boms';
  protected idColumn = 'id';

  async findByCode(code: string, tenantId: string): Promise<VasBomRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('code', code)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as VasBomRow;
  }

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; processType?: string }
  ): Promise<VasBomRow[]> {
    const { limit = 100, offset = 0, status, processType } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (processType) query = query.eq('process_type', processType);

    const { data, error } = await query;
    if (error) throw error;
    return (data as VasBomRow[]) || [];
  }

  async findWithItems(bomId: string): Promise<{
    bom: VasBomRow;
    items: Tables<'vas_bom_items'>[];
  } | null> {
    const { data: bom, error: bomError } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('id', bomId)
      .single();

    if (bomError) {
      if (bomError.code === 'PGRST116') return null;
      throw bomError;
    }

    const { data: items, error: itemsError } = await this.getClient()
      .from('vas_bom_items')
      .select('*')
      .eq('bom_id', bomId)
      .order('sequence', { ascending: true });

    if (itemsError) throw itemsError;

    return {
      bom: bom as VasBomRow,
      items: (items as Tables<'vas_bom_items'>[]) || [],
    };
  }

  async findByOutputProduct(outputProductId: string, tenantId: string): Promise<VasBomRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('output_product_id', outputProductId)
      .order('version', { ascending: false });

    if (error) throw error;
    return (data as VasBomRow[]) || [];
  }

  async createBomItems(items: TablesInsert<'vas_bom_items'>[]): Promise<Tables<'vas_bom_items'>[]> {
    const { data, error } = await this.getClient()
      .from('vas_bom_items')
      .insert(items as any)
      .select();

    if (error) throw error;
    return (data as Tables<'vas_bom_items'>[]) || [];
  }

  async updateBomItem(itemId: string, data: TablesUpdate<'vas_bom_items'>): Promise<Tables<'vas_bom_items'>> {
    const { data, error } = await this.getClient()
      .from('vas_bom_items')
      .update(data as any)
      .eq('id', itemId)
      .select()
      .single();

    if (error) throw error;
    return data as Tables<'vas_bom_items'>;
  }

  async deleteBomItem(itemId: string): Promise<void> {
    const { error } = await this.getClient()
      .from('vas_bom_items')
      .delete()
      .eq('id', itemId);

    if (error) throw error;
  }

  async getUsageStats(tenantId: string, startDate: string, endDate: string): Promise<Array<{
    bomId: string;
    bomCode: string;
    usageCount: number;
    totalQty: number;
  }>> {
    // This would typically query a work order or task table that references BOMs
    // For now, return empty array - implementation depends on specific schema
    return [];
  }
}