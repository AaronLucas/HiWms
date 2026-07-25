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

  async findByCode(deviceCode: string, tenantId: string): Promise<DeviceRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('device_code', deviceCode)
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
    options?: { limit?: number; offset?: number; isActive?: boolean; deviceType?: string }
  ): Promise<DeviceRow[]> {
    const { limit = 100, offset = 0, isActive, deviceType } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('device_code', { ascending: true })
      .range(offset, offset + limit - 1);

    if (typeof isActive === 'boolean') query = query.eq('is_active', isActive);
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
      .eq('is_active', true);

    if (deviceType) query = query.eq('device_type', deviceType);

    const { data, error } = await query;
    if (error) throw error;
    return (data as DeviceRow[]) || [];
  }

  async updateSecretHash(deviceId: string, secretHash: string, rotatedAt: string): Promise<DeviceRow> {
    return this.update(deviceId, {
      secret_hash: secretHash,
      secret_rotated_at: rotatedAt
    } as DeviceUpdate);
  }

  async findBySecretHash(secretHash: string): Promise<DeviceRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('secret_hash', secretHash)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as DeviceRow;
  }

  async updateStatus(deviceId: string, status: string): Promise<DeviceRow> {
    return this.update(deviceId, { is_active: status === 'active' } as DeviceUpdate);
  }

  async updateHeartbeat(deviceId: string): Promise<DeviceRow> {
    return this.update(deviceId, { last_heartbeat_at: new Date().toISOString() } as DeviceUpdate);
  }

  async rotateSecret(deviceId: string, newSecretHash: string): Promise<DeviceRow> {
    return this.update(deviceId, {
      secret_hash: newSecretHash,
      secret_rotated_at: new Date().toISOString()
    } as DeviceUpdate);
  }

  async revokeSecret(deviceId: string): Promise<DeviceRow> {
    return this.update(deviceId, {
      secret_hash: null,
      secret_rotated_at: new Date().toISOString()
    } as DeviceUpdate);
  }

  async getStats(tenantId: string): Promise<{
    total: number;
    active: number;
    inactive: number;
    byType: Record<string, number>;
  }> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('is_active, device_type')
      .eq('tenant_id', tenantId);

    if (error) throw error;
    const devices = data as { is_active: boolean | null; device_type: string }[];

    const byType: Record<string, number> = {};
    let active = 0, inactive = 0;

    for (const d of devices) {
      if (d.is_active) active++;
      else inactive++;
      byType[d.device_type] = (byType[d.device_type] || 0) + 1;
    }

    return {
      total: devices.length,
      active,
      inactive,
      byType,
    };
  }
}