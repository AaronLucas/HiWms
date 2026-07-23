/**
 * Supabase 设备仓储实现
 *
 * 调用方：src/apps/device-api/routes.ts (通过 DI 容器注入)、DeviceAuthMiddleware.ts
 * 影响 API：新增 findByIdWithSecret/updateSecretHash/rotateSecret/revokeSecret 四个方法
 * 数据 schema：devices 表新增 secret_hash(text)、secret_rotated_at(timestamptz) 两列（待 DBA 迁移）
 * 用户指令：执行目前项目中计划的任务，使用中文
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IDeviceRepository, type DeviceRowWithSecret } from '@core/ports/db/IDeviceRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';
import { generateDeviceApiKey, hashApiKeySecret } from '@core/utils/crypto';

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
      .eq('device_code', code)
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
      .order('device_code', { ascending: true })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('is_active', status === 'active');
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

  async updateStatus(deviceId: string, status: string): Promise<DeviceRow> {
    return this.update(deviceId, { is_active: status === 'active' } as DeviceUpdate);
  }

  async updateHeartbeat(deviceId: string): Promise<DeviceRow> {
    // devices 表没有 last_heartbeat_at 列，跳过或记录到其他表
    // 这里返回当前行不做更新，避免报错
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('id', deviceId)
      .single();
    if (error) throw error;
    return data as DeviceRow;
  }

  async getStats(tenantId: string): Promise<{
    total: number;
    online: number;
    offline: number;
    byType: Record<string, number>;
  }> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('is_active, device_type')
      .eq('tenant_id', tenantId);

    if (error) throw error;
    const devices = data as { is_active: boolean | null; device_type: string }[];

    const byType: Record<string, number> = {};
    let online = 0, offline = 0;

    for (const d of devices) {
      if (d.is_active) online++;
      else offline++;
      byType[d.device_type] = (byType[d.device_type] || 0) + 1;
    }

    return {
      total: devices.length,
      online,
      offline,
      byType,
    };
  }

  // ===== 新增：设备密钥管理（ADR-019）=====

  async findByIdWithSecret(deviceId: string): Promise<DeviceRowWithSecret | null> {
    // 需要 admin client 绕过 RLS 读取 secret_hash
    const { data, error } = await this.getClient(true) // useAdmin = true
      .from(this.tableName)
      .select('*, secret_hash, secret_rotated_at')
      .eq('id', deviceId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as DeviceRowWithSecret;
  }

  async updateSecretHash(deviceId: string, secretHash: string): Promise<DeviceRow> {
    const { data, error } = await this.getClient(true)
      .from(this.tableName)
      .update({ secret_hash: secretHash, secret_rotated_at: new Date().toISOString() } as any)
      .eq('id', deviceId)
      .select()
      .single();

    if (error) throw error;
    return data as DeviceRow;
  }

  async rotateSecret(deviceId: string): Promise<{ device: DeviceRow; newApiKey: string }> {
    const { raw, secret } = generateDeviceApiKey(deviceId);
    const secretHash = await hashApiKeySecret(secret);

    const { data, error } = await this.getClient(true)
      .from(this.tableName)
      .update({ secret_hash: secretHash, secret_rotated_at: new Date().toISOString() } as any)
      .eq('id', deviceId)
      .select()
      .single();

    if (error) throw error;
    return { device: data as DeviceRow, newApiKey: raw };
  }

  async revokeSecret(deviceId: string): Promise<DeviceRow> {
    const { data, error } = await this.getClient(true)
      .from(this.tableName)
      .update({ secret_hash: null, secret_rotated_at: new Date().toISOString() } as any)
      .eq('id', deviceId)
      .select()
      .single();

    if (error) throw error;
    return data as DeviceRow;
  }
}