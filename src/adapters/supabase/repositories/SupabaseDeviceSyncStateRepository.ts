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
   * 真实表（已用 psql \d device_sync_state 核实）：主键只有 device_id（不是
   * (device_id, tenant_id) 复合键），游标列叫 last_applied_seq（不是
   * last_pulled_seq），也没有 last_sync_at/sync_status/error_message 这几列——
   * 原实现写的是一套不存在的 schema，GET /sync/pull（唯一真实调用方，见
   * routes.ts）只要有新事件要返回就会调这个方法，之前每次调用都会因为
   * "column does not exist" 报错，整个拉取请求跟着 500。
   */
  async updateCursor(deviceId: string, tenantId: string, lastPulledSeq: number): Promise<DeviceSyncStateRow> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .upsert({
        device_id: deviceId,
        tenant_id: tenantId,
        last_applied_seq: lastPulledSeq,
        last_pull_at: new Date().toISOString(),
      } as DeviceSyncStateInsert, {
        onConflict: 'device_id',
      })
      .select()
      .single();

    if (error) throw error;
    return data as DeviceSyncStateRow;
  }

  /**
   * 记录同步失败（用于告警/重试）
   * 真实表没有 sync_status/error_message 列，没有地方存"为什么失败"——不是
   * 列名笔误，是这张表目前的设计压根不含错误追踪能力。只更新
   * last_seen_online_at（表示设备至少还联系得上，只是没能成功同步），不修改
   * last_applied_seq/last_pull_at，避免把失败误报成成功。若后续确实需要保留
   * 失败原因用于告警，需要 DBA 协调给表加列，不在本次纯 TS 修复范围内。
   */
  async recordSyncFailure(deviceId: string, tenantId: string, _error: string): Promise<void> {
    const { error: updateError } = await this.getClient()
      .from(this.tableName)
      .upsert({
        device_id: deviceId,
        tenant_id: tenantId,
        last_seen_online_at: new Date().toISOString(),
      } as DeviceSyncStateInsert, {
        onConflict: 'device_id',
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
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return (data as DeviceSyncStateRow[]) || [];
  }

  /**
   * 获取长时间未同步的设备（超过指定秒数）
   * 按 last_pull_at 判断（updateCursor 唯一真实写入的活跃度信号）；从未成功
   * 拉取过（last_pull_at IS NULL）的设备也应算作"该关注"，一并纳入。
   */
  async findStaleDevices(tenantId: string, thresholdSeconds: number): Promise<DeviceSyncStateRow[]> {
    const threshold = new Date(Date.now() - thresholdSeconds * 1000).toISOString();

    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .or(`last_pull_at.is.null,last_pull_at.lt.${threshold}`)
      .order('last_pull_at', { ascending: true, nullsFirst: true });

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