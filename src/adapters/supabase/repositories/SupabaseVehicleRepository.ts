/**
 * 车辆仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IVehicleRepository } from '@core/ports/db/IVehicleRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type VehicleRow = Tables<'vehicles'>;
type VehicleInsert = TablesInsert<'vehicles'>;
type VehicleUpdate = TablesUpdate<'vehicles'>;

export class SupabaseVehicleRepository extends SupabaseBaseRepository<
  VehicleRow,
  VehicleInsert,
  VehicleUpdate,
  string
> implements IVehicleRepository {
  protected tableName = 'vehicles';
  protected idColumn = 'id';

  async findByPlate(plate: string, tenantId: string): Promise<VehicleRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('plate', plate)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as VehicleRow;
  }

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; vehicleType?: string }
  ): Promise<VehicleRow[]> {
    const { limit = 100, offset = 0, status, vehicleType } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('plate', { ascending: true })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (vehicleType) query = query.eq('vehicle_type', vehicleType);

    const { data, error } = await query;
    if (error) throw error;
    return (data as VehicleRow[]) || [];
  }

  async findAvailable(tenantId: string, vehicleType?: string): Promise<VehicleRow[]> {
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'available');

    if (vehicleType) query = query.eq('vehicle_type', vehicleType);

    const { data, error } = await query;
    if (error) throw error;
    return (data as VehicleRow[]) || [];
  }

  async updateStatus(vehicleId: string, status: string): Promise<VehicleRow> {
    return this.update(vehicleId, { status } as VehicleUpdate);
  }

  async updateLocation(vehicleId: string, latitude: number, longitude: number): Promise<VehicleRow> {
    return this.update(vehicleId, { current_lat: latitude, current_lng: longitude } as VehicleUpdate);
  }

  async getStats(tenantId: string): Promise<{
    total: number;
    available: number;
    inUse: number;
    maintenance: number;
    byType: Record<string, number>;
  }> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('status, vehicle_type')
      .eq('tenant_id', tenantId);

    if (error) throw error;
    const vehicles = data as { status: string; vehicle_type: string }[];

    const byType: Record<string, number> = {};
    let total = 0, available = 0, inUse = 0, maintenance = 0;

    for (const v of vehicles) {
      total++;
      if (v.status === 'available') available++;
      else if (v.status === 'in_use') inUse++;
      else if (v.status === 'maintenance') maintenance++;
      byType[v.vehicle_type] = (byType[v.vehicle_type] || 0) + 1;
    }

    return { total, available, inUse, maintenance, byType };
  }
}