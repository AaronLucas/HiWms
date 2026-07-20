/**
 * Supabase 库区仓储实现
 * 对应表：zones
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IZoneRepository, ZoneRow, ZoneInsert, ZoneUpdate } from '@core/ports/db/IZoneRepository';

export class SupabaseZoneRepository extends SupabaseBaseRepository<
  ZoneRow,
  ZoneInsert,
  ZoneUpdate,
  string
> implements IZoneRepository {
  protected tableName = 'zones';
  protected idColumn = 'id';

  async findByCode(tenantId: string, code: string): Promise<ZoneRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('code', code)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as ZoneRow;
  }

  async findByTenant(tenantId: string): Promise<ZoneRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('code', { ascending: true });

    if (error) throw error;
    return (data as ZoneRow[]) || [];
  }

  async findActive(tenantId: string): Promise<ZoneRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('code', { ascending: true });

    if (error) throw error;
    return (data as ZoneRow[]) || [];
  }
}
