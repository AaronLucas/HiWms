/**
 * Supabase 离线同步策略仓储实现
 * 封装：fn_get_sync_policy，CRUD sync_policies
 * 对应表：sync_policies
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { ISyncPolicyRepository, SyncPolicyRow, SyncPolicyInsert, SyncPolicyUpdate, OfflineMode } from '@core/ports/db/ISyncPolicyRepository';
import { SupabaseRpcClient } from '../rpc/SupabaseRpcClient';
import { WmsSupabaseClient } from '../SupabaseClient';

export class SupabaseSyncPolicyRepository extends SupabaseBaseRepository<
  SyncPolicyRow,
  SyncPolicyInsert,
  SyncPolicyUpdate,
  string
> implements ISyncPolicyRepository {
  protected tableName = 'sync_policies';
  protected idColumn = 'id';

  constructor(
    protected supabase: WmsSupabaseClient,
    private rpcClient: SupabaseRpcClient
  ) {
    super(supabase);
  }

  /**
   * 查询生效的同步策略（按优先级：租户+任务类型+库位类型 → 租户+任务类型 → 租户+库位类型 → 租户默认 → 系统默认）
   * 调用 RPC fn_get_sync_policy(p_tenant_id, p_task_type, p_zone_type)
   */
  async getSyncPolicy(params: {
    tenantId: string;
    taskType?: string;
    zoneType?: string;
  }): Promise<{
    offlineMode: OfflineMode;
    maxOfflineDurationSeconds: number;
    requiresTaskClaim: boolean;
    conflictStrategy: 'SERVER_WINS' | 'DEVICE_WINS' | 'MANUAL';
    policyId: string;
  } | null> {
    const result = await this.rpcClient.raw('fn_get_sync_policy', {
      p_tenant_id: params.tenantId,
      p_task_type: params.taskType,
      p_zone_type: params.zoneType,
    });

    // 返回第一条匹配策略（按优先级已在 RPC 内部处理）
    const policy = Array.isArray(result) && result.length > 0 ? result[0] : null;

    if (!policy) {
      return {
        offlineMode: 'ALLOW',
        maxOfflineDurationSeconds: 28800, // 8 hours default
        requiresTaskClaim: false,
        conflictStrategy: 'SERVER_WINS',
        policyId: 'default',
      };
    }

    return {
      offlineMode: policy.offline_mode as OfflineMode,
      maxOfflineDurationSeconds: policy.max_offline_duration_seconds,
      requiresTaskClaim: false, // Not in RPC return, default to false
      conflictStrategy: 'SERVER_WINS', // Not in RPC return, default
      policyId: policy.id || 'unknown',
    };
  }

  /**
   * 查询生效的同步策略（接口要求的方法名）
   * 按优先级：租户级 > 任务类型级 > 库位类型级 > 全局默认
   */
  async getEffectivePolicy(tenantId: string, taskType?: string, zoneType?: string): Promise<{
    offlineMode: OfflineMode;
    maxOfflineDurationSeconds: number;
    policyId: string;
  }> {
    const result = await this.getSyncPolicy({ tenantId, taskType, zoneType });
    return result ? {
      offlineMode: result.offlineMode,
      maxOfflineDurationSeconds: result.maxOfflineDurationSeconds,
      policyId: result.policyId,
    } : {
      offlineMode: 'ALLOW',
      maxOfflineDurationSeconds: 28800,
      policyId: 'default',
    };
  }

  /**
   * 获取租户的所有策略配置（用于管理后台）
   */
  async findByTenant(tenantId: string): Promise<SyncPolicyRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('priority', { ascending: false });

    if (error) throw error;
    return (data as SyncPolicyRow[]) || [];
  }

  /**
   * 获取特定任务类型的策略
   */
  async findByTaskType(tenantId: string, taskType: string): Promise<SyncPolicyRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('task_type', taskType)
      .order('priority', { ascending: false });

    if (error) throw error;
    return (data as SyncPolicyRow[]) || [];
  }

  /**
   * 获取特定库位类型的策略
   */
  async findByZoneType(tenantId: string, zoneType: string): Promise<SyncPolicyRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('zone_type', zoneType)
      .order('priority', { ascending: false });

    if (error) throw error;
    return (data as SyncPolicyRow[]) || [];
  }

  /**
   * 判断任务是否允许离线执行
   */
  async isOfflineAllowed(tenantId: string, taskType: string, zoneType?: string): Promise<boolean> {
    const policy = await this.getSyncPolicy({ tenantId, taskType, zoneType });
    return policy !== null && policy.offlineMode !== 'ONLINE_ONLY';
  }

  /**
   * 获取最大离线时长
   */
  async getMaxOfflineDuration(tenantId: string, taskType: string, zoneType?: string): Promise<number> {
    const policy = await this.getSyncPolicy({ tenantId, taskType, zoneType });
    return policy?.maxOfflineDurationSeconds || 28800;
  }
}