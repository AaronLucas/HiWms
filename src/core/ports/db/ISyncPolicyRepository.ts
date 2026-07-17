/**
 * 同步策略仓储端口接口
 * 离线策略配置：封装 fn_get_sync_policy，CRUD sync_policies
 * 对应表：sync_policies
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type SyncPolicyRow = Tables<'sync_policies'>;
export type SyncPolicyInsert = TablesInsert<'sync_policies'>;
export type SyncPolicyUpdate = TablesUpdate<'sync_policies'>;

export type OfflineMode = 'ALLOW' | 'LIMITED' | 'ONLINE_ONLY';

export interface ISyncPolicyRepository extends IRepository<SyncPolicyRow, SyncPolicyInsert, SyncPolicyUpdate> {
  /**
   * 查询生效的同步策略（按优先级：租户级 > 任务类型级 > 库位类型级 > 全局默认）
   * 调用 RPC fn_get_sync_policy(p_tenant_id, p_task_type, p_zone_type)
   */
  getEffectivePolicy(tenantId: string, taskType?: string, zoneType?: string): Promise<{
    offlineMode: OfflineMode;
    maxOfflineDurationSeconds: number;
    policyId: string;
  }>;

  /**
   * 按租户查找所有策略
   */
  findByTenant(tenantId: string): Promise<SyncPolicyRow[]>;

  /**
   * 按任务类型查找策略
   */
  findByTaskType(tenantId: string, taskType: string): Promise<SyncPolicyRow[]>;

  /**
   * 按库位类型查找策略
   */
  findByZoneType(tenantId: string, zoneType: string): Promise<SyncPolicyRow[]>;

  /**
   * 判断任务类型/库位类型是否允许离线
   */
  isOfflineAllowed(tenantId: string, taskType: string, zoneType?: string): Promise<boolean>;

  /**
   * 获取最大离线时长
   */
  getMaxOfflineDuration(tenantId: string, taskType: string, zoneType?: string): Promise<number>;
}