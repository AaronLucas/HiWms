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
   *
   * 返回值只包含 fn_get_sync_policy 真实返回的两列，严格对齐 SYNC_API_CONTRACT.md §5.2
   * 文档契约。此前的实现（拆成 getSyncPolicy + getEffectivePolicy 两个近似重复的方法）
   * 额外返回过 requiresTaskClaim/conflictStrategy/policyId 三个 SQL 端并不提供的字段
   * （永远硬编码为固定常量，从未反映过真实配置），且路由层
   * （src/apps/device-api/routes.ts 的 GET /sync/policy）曾把这个 camelCase 结果对象
   * 原样透传给设备端——而文档契约与本文件同级的所有其他 Device API 响应
   * （event_id/next_cursor/lpn_code/exception_id 等）用的都是 snake_case。任何按文档
   * 实现的 PDA 客户端读取 `response.offline_mode` 只会读到 undefined，而这个字段正是
   * 冷链/危化品"是否必须强制在线"判定所依赖的字段（见 SYNC_API_CONTRACT.md §5.2 的
   * 客户端行为说明），fail-open 风险不是假设性的。修复已同步落到 routes.ts 的序列化处。
   *
   * ONLINE_ONLY 时 max_offline_duration_seconds 按契约应为 0；数据库 CHECK 约束
   * （chk_sync_policies_limited_duration）只强制 LIMITED 必须非空，ONLINE_ONLY 行的
   * max_offline_duration_seconds 允许是 NULL——此时归一化为 0，而不是退回 ALLOW 语境下
   * 的 8 小时默认值。
   */
  async getEffectivePolicy(tenantId: string, taskType?: string, zoneType?: string): Promise<{
    offlineMode: OfflineMode;
    maxOfflineDurationSeconds: number;
  }> {
    const result = await this.rpcClient.raw('fn_get_sync_policy', {
      p_tenant_id: tenantId,
      p_task_type: taskType,
      p_zone_type: zoneType,
    });

    // 返回第一条匹配策略（按优先级已在 RPC 内部处理）
    const policy = Array.isArray(result) && result.length > 0 ? result[0] : null;

    if (!policy) {
      return { offlineMode: 'ALLOW', maxOfflineDurationSeconds: 28800 };
    }

    const offlineMode = policy.offline_mode as OfflineMode;
    if (offlineMode === 'ONLINE_ONLY') {
      return { offlineMode, maxOfflineDurationSeconds: 0 };
    }
    return {
      offlineMode,
      maxOfflineDurationSeconds: policy.max_offline_duration_seconds ?? 28800,
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
    const policy = await this.getEffectivePolicy(tenantId, taskType, zoneType);
    return policy.offlineMode !== 'ONLINE_ONLY';
  }

  /**
   * 获取最大离线时长
   * 直接透传 getEffectivePolicy 已归一化的值——不再用 `|| 28800` 兜底，那样会把
   * ONLINE_ONLY 合法的 0 值当成 falsy 错误地改写回 8 小时默认值。
   */
  async getMaxOfflineDuration(tenantId: string, taskType: string, zoneType?: string): Promise<number> {
    const policy = await this.getEffectivePolicy(tenantId, taskType, zoneType);
    return policy.maxOfflineDurationSeconds;
  }
}
