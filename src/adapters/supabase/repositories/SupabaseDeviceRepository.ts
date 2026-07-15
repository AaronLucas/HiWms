/**
 * Supabase 设备仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IDeviceRepository } from '@core/ports/db/IDeviceRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type DeviceRow = Tables<'devices'>;
type DeviceInsert = TablesInsert<'devices'>;
type DeviceUpdate = TablesUpdate<'devices'>;

export class SupabaseDeviceRepository extends SupabaseBaseRepository<
  DeviceRow,
  DeviceInsert,
  DeviceUpdate,
  string
> implements IDeviceRepository {
  protected tableName = 'devices';
  protected idColumn = 'id';

  async findByCode(code: string, tenantId: string): Promise<DeviceRow | null> {
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
    return data as DeviceRow;
  }

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; deviceType?: string }
  ): Promise<DeviceRow[]> {
    const { limit = 100, offset = 0, status, deviceType } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('code', { ascending: true })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (deviceType) query = query.eq('device_type', deviceType);

    const { data, error } = await query;
    if (error) throw error;
    return (data as DeviceRow[]) || [];
  }

  async findAvailable(tenantId: string, deviceType?: string): Promise<DeviceRow[]> {
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'online')
      .eq('current_task_id', null);

    if (deviceType) query = query.eq('device_type', deviceType);

    const { data, error } = await query;
    if (error) throw error;
    return (data as DeviceRow[]) || [];
  }

  async updateStatus(deviceId: string, status: string): Promise<DeviceRow> {
    return this.update(deviceId, { status } as DeviceUpdate);
  }

  async updateHeartbeat(deviceId: string): Promise<DeviceRow> {
    return this.update(deviceId, { last_heartbeat_at: new Date().toISOString() } as DeviceUpdate);
  }

  async getStats(tenantId: string): Promise<{
    total: number;
    online: number;
    offline: number;
    byType: Record<string, number>;
  }> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('status, device_type')
      .eq('tenant_id', tenantId);

    if (error) throw error;
    const devices = data as { status: string; device_type: string }[];

    const byType: Record<string, number> = {};
    let online = 0, offline = 0;

    for (const d of devices) {
      if (d.status === 'online') online++;
      else if (d.status === 'offline') offline++;
      byType[d.device_type] = (byType[d.device_type] || 0) + 1;
    }

    return {
      total: devices.length,
      online,
      offline,
      byType,
    };
  }
}