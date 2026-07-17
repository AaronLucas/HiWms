/**
 * 设备同步状态仓储端口接口
 * 管理设备同步游标与状态：device_sync_state
 * 对应表：device_sync_state
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type DeviceSyncStateRow = Tables<'device_sync_state'>;
export type DeviceSyncStateInsert = TablesInsert<'device_sync_state'>;
export type DeviceSyncStateUpdate = TablesUpdate<'device_sync_state'>;

export interface IDeviceSyncStateRepository extends IRepository<DeviceSyncStateRow, DeviceSyncStateInsert, DeviceSyncStateUpdate> {
  /**
   * 获取设备同步状态（用于增量拉取游标）
   */
  findByDevice(deviceId: string, tenantId: string): Promise<DeviceSyncStateRow | null>;

  /**
   * 更新设备同步游标（最后成功拉取的 device_seq）
   */
  updateCursor(deviceId: string, tenantId: string, lastPulledSeq: number): Promise<DeviceSyncStateRow>;

  /**
   * 记录同步失败（用于告警/重试）
   */
  recordSyncFailure(deviceId: string, tenantId: string, error: string): Promise<void>;

  /**
   * 获取租户下所有设备的同步状态（管理后台用）
   */
  findAllByTenant(tenantId: string): Promise<DeviceSyncStateRow[]>;

  /**
   * 获取长时间未同步的设备（超过指定秒数）
   */
  findStaleDevices(tenantId: string, thresholdSeconds: number): Promise<DeviceSyncStateRow[]>;

  /**
   * 重置设备同步状态（设备重新注册/全量同步时）
   */
  resetDeviceState(deviceId: string, tenantId: string): Promise<void>;
}