/**
 * 设备仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type DeviceRow = Tables<'devices'>;
export type DeviceInsert = TablesInsert<'devices'>;
export type DeviceUpdate = TablesUpdate<'devices'>;

export interface IDeviceRepository extends IRepository<DeviceRow, DeviceInsert, DeviceUpdate> {
  /**
   * 按编码查找设备
   */
  findByCode(code: string, tenantId: string): Promise<DeviceRow | null>;

  /**
   * 按租户查找设备（分页、状态过滤）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; deviceType?: string; isActive?: boolean }
  ): Promise<DeviceRow[]>;

  /**
   * 查找可用设备（在线、空闲）
   */
  findAvailable(tenantId: string, deviceType?: string): Promise<DeviceRow[]>;

  /**
   * 更新设备状态
   */
  updateStatus(deviceId: string, status: string): Promise<DeviceRow>;

  /**
   * 更新设备最后心跳时间
   */
  updateHeartbeat(deviceId: string): Promise<DeviceRow>;

  /**
   * 获取设备统计
   */
  getStats(tenantId: string): Promise<{
    total: number;
    active: number;
    inactive: number;
    byType: Record<string, number>;
  }>;

  /**
   * 按 secret_hash 查找设备（API Key 登录用）
   */
  findBySecretHash(secretHash: string): Promise<DeviceRow | null>;

  /**
   * 更新设备 secret_hash
   */
  updateSecretHash(deviceId: string, secretHash: string, rotatedAt: string): Promise<DeviceRow>;

  /**
   * 轮换设备密钥
   */
  rotateSecret(deviceId: string, newSecretHash: string): Promise<DeviceRow>;

  /**
   * 撤销设备密钥（设备丢失/注销）
   */
  revokeSecret(deviceId: string): Promise<DeviceRow>;
}