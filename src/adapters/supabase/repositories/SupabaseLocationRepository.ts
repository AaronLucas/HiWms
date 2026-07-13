/**
 * Supabase 库位仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { ILocationRepository } from '@core/ports/db/ILocationRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type LocationRow = Tables<'locations'>;
type LocationInsert = TablesInsert<'locations'>;
type LocationUpdate = TablesUpdate<'locations'>;

export class SupabaseLocationRepository extends SupabaseBaseRepository<
  LocationRow,
  LocationInsert,
  LocationUpdate,
  string
> implements ILocationRepository {
  protected tableName = 'locations';
  protected idColumn = 'id';

  async findByCode(code: string, tenantId: string): Promise<LocationRow | null> {
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
    return data as LocationRow;
  }

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; zoneType?: string; isActive?: boolean }
  ): Promise<LocationRow[]> {
    const { limit = 100, offset = 0, zoneType, isActive } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('code', { ascending: true })
      .range(offset, offset + limit - 1);

    if (zoneType) query = query.eq('zone_type', zoneType);
    if (isActive !== undefined) query = query.eq('is_active', isActive);

    const { data, error } = await query;
    if (error) throw error;
    return (data as LocationRow[]) || [];
  }

  async findAvailable(
    tenantId: string,
    options?: { zoneType?: string; minVolume?: number; minWeight?: number }
  ): Promise<LocationRow[]> {
    const { zoneType, minVolume, minWeight } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .eq('is_frozen', false);

    if (zoneType) query = query.eq('zone_type', zoneType);
    if (minVolume !== undefined) query = query.gte('max_volume', minVolume);
    if (minWeight !== undefined) query = query.gte('max_weight', minWeight);

    const { data, error } = await query;
    if (error) throw error;
    return (data as LocationRow[]) || [];
  }

  async findReplenishmentNeeded(tenantId: string): Promise<LocationRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .neq('picking_threshold_pct', null)
      .lt('current_volume', this.getClient().rpc('calculate_replenishment_threshold'));

    if (error) throw error;
    return (data as LocationRow[]) || [];
  }

  async findByZoneType(tenantId: string, zoneType: string): Promise<LocationRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('zone_type', zoneType)
      .eq('is_active', true)
      .order('code', { ascending: true });

    if (error) throw error;
    return (data as LocationRow[]) || [];
  }

  async updateStatus(locationId: string, isActive: boolean, isFrozen?: boolean): Promise<LocationRow> {
    const updateData: Partial<LocationUpdate> = { is_active: isActive };
    if (isFrozen !== undefined) updateData.is_frozen = isFrozen;
    return this.update(locationId, updateData as LocationUpdate);
  }

  async updateCapacity(
    locationId: string,
    capacity: { maxVolume?: number; maxWeight?: number; pickingMaxQty?: number; pickingThresholdPct?: number }
  ): Promise<LocationRow> {
    return this.update(locationId, capacity as LocationUpdate);
  }

  async getUtilizationStats(tenantId: string): Promise<Array<{
    locationId: string;
    code: string;
    currentVolume: number;
    currentWeight: number;
    maxVolume: number;
    maxWeight: number;
    utilizationPct: number;
  }>> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('id, code, current_volume, current_weight, max_volume, max_weight')
      .eq('tenant_id', tenantId)
      .eq('is_active', true);

    if (error) throw error;
    return ((data as LocationRow[]) || []).map(row => ({
      locationId: row.id,
      code: row.code,
      currentVolume: row.current_volume || 0,
      currentWeight: row.current_weight || 0,
      maxVolume: row.max_volume || 0,
      maxWeight: row.max_weight || 0,
      utilizationPct: row.max_volume && row.max_volume > 0
        ? Math.round((row.current_volume || 0) / row.max_volume * 100)
        : 0,
    }));
  }
}