/**
 * Supabase 设备同步状态仓储实现
 * 管理设备同步游标与状态：device_sync_state
 * 对应表：device_sync_state
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IDeviceSyncStateRepository } from '@core/ports/db/IDeviceSyncStateRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';
import { WmsSupabaseClient } from '../SupabaseClient';

type DeviceSyncStateRow = Tables<'device_sync_state'>;
type DeviceSyncStateInsert = TablesInsert<'device_sync_state'>;
type DeviceSyncStateUpdate = TablesUpdate<'device_sync_state'>;

export class SupabaseDeviceSyncStateRepository extends SupabaseBaseRepository<
  DeviceSyncStateRow,
  DeviceSyncStateInsert,
  DeviceSyncStateUpdate,
  string
> implements IDeviceSyncStateRepository {
  protected tableName = 'device_sync_state';
  protected idColumn = 'device_id';

  constructor(protected supabase: WmsSupabaseClient) {
    super(supabase);
  }

  /**
   * 获取设备同步状态（用于增量拉取游标）
   */
  async findByDevice(deviceId: string, tenantId: string): Promise<DeviceSyncStateRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('device_id', deviceId)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as DeviceSyncStateRow;
  }

  /**
   * 更新设备同步游标（最后成功拉取的 device_seq）
   */
  async updateCursor(deviceId: string, tenantId: string, lastPulledSeq: number): Promise<DeviceSyncStateRow> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .upsert({
        device_id: deviceId,
        tenant_id: tenantId,
        last_pulled_seq: lastPulledSeq,
        last_sync_at: new Date().toISOString(),
        sync_status: 'OK',
        error_message: null,
      } as DeviceSyncStateInsert, {
        onConflict: 'device_id,tenant_id',
      })
      .select()
      .single();

    if (error) throw error;
    return data as DeviceSyncStateRow;
  }

  /**
   * 记录同步失败（用于告警/重试）
   */
  async recordSyncFailure(deviceId: string, tenantId: string, error: string): Promise<void> {
    const { error: updateError } = await this.getClient()
      .from(this.tableName)
      .upsert({
        device_id: deviceId,
        tenant_id: tenantId,
        sync_status: 'ERROR',
        error_message: error,
        last_sync_at: new Date().toISOString(),
      } as DeviceSyncStateInsert, {
        onConflict: 'device_id,tenant_id',
      });

    if (updateError) throw updateError;
  }

  /**
   * 获取租户下所有设备的同步状态（管理后台用）
   */
  async findAllByTenant(tenantId: string): Promise<DeviceSyncStateRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('last_sync_at', { ascending: false });

    if (error) throw error;
    return (data as DeviceSyncStateRow[]) || [];
  }

  /**
   * 获取长时间未同步的设备（超过指定秒数）
   */
  async findStaleDevices(tenantId: string, thresholdSeconds: number): Promise<DeviceSyncStateRow[]> {
    const threshold = new Date(Date.now() - thresholdSeconds * 1000).toISOString();

    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .lt('last_sync_at', threshold)
      .order('last_sync_at', { ascending: true });

    if (error) throw error;
    return (data as DeviceSyncStateRow[]) || [];
  }

  /**
   * 重置设备同步状态（设备重新注册/全量同步时）
   */
  async resetDeviceState(deviceId: string, tenantId: string): Promise<void> {
    const { error } = await this.getClient()
      .from(this.tableName)
      .delete()
      .eq('device_id', deviceId)
      .eq('tenant_id', tenantId);

    if (error) throw error;
  }
}