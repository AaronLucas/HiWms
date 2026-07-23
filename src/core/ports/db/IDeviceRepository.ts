/**
 * 设备仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type DeviceRow = Tables<'devices'>;
export type DeviceInsert = TablesInsert<'devices'>;
export type DeviceUpdate = TablesUpdate<'devices'>;

/** 带密钥哈希的设备行（用于认证验证，需 admin client） */
export interface DeviceRowWithSecret extends DeviceRow {
  secret_hash: string | null;
  secret_rotated_at: string | null;
}

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
    options?: { limit?: number; offset?: number; status?: string; deviceType?: string }
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
    online: number;
    offline: number;
    byType: Record<string, number>;
  }>;

  // ===== 新增：设备密钥管理（ADR-019）=====

  /**
   * 查询设备含密钥哈希（仅认证中间件使用，需 admin client 绕过 RLS）
   * @returns 含 secret_hash/secret_rotated_at 的行，未找到返回 null
   */
  findByIdWithSecret(deviceId: string): Promise<DeviceRowWithSecret | null>;

  /**
   * 更新设备密钥哈希（密钥轮换/首次配发）
   * @param deviceId 设备 ID
   * @param secretHash argon2 哈希值
   * @returns 更新后的行
   */
  updateSecretHash(deviceId: string, secretHash: string): Promise<DeviceRow>;

  /**
   * 轮换设备密钥（生成新 API Key、更新哈希、记录轮换时间）
   * @returns { device: 更新后行, newApiKey: 完整新 API Key(raw, 仅此次返回) }
   */
  rotateSecret(deviceId: string): Promise<{ device: DeviceRow; newApiKey: string }>;

  /**
   * 吊销设备密钥（置空哈希、记录轮换时间）
   * @returns 更新后的行
   */
  revokeSecret(deviceId: string): Promise<DeviceRow>;
}