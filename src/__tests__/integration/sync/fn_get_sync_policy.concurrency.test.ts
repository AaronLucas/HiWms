/**
 * ECC 治理 Phase 5/6/7 测试补齐（docs/03-database/REPOSITORY_ROADMAP.md P1 第 2 项）：
 * `SupabaseSyncPolicyRepository` / `fn_get_sync_policy` 正确性验证。
 *
 * === 可达性核查（测试方法论第 6 步）===
 * 与 P0 第 3 项（PackingTaskItemRepository）不同，本仓储是**真实生产路径**：
 * `src/apps/device-api/routes.ts` 的 `GET /sync/policy` 端点直接调用它，PDA 设备在开始
 * 任务前必须先查询这个端点判定"该任务/库位是否必须强制在线"（冷链/危化品合规场景，见
 * SYNC_API_CONTRACT.md §5.2）。
 *
 * === 发现并修复的真实缺陷（纯 TS 应用层 + 路由层代码，未触碰任何 .sql 文件）===
 *
 * **主要缺陷（响应字段命名与合规判定不一致）**：`SYNC_API_CONTRACT.md` §5.2 明确文档化
 * 响应契约为 `{"offline_mode": ..., "max_offline_duration_seconds": ...}`（snake_case，
 * 与本文件同级的其余 Device API 响应字段命名约定一致：`event_id`/`next_cursor`/
 * `lpn_code`/`exception_id` 等）。但原实现里 `SupabaseSyncPolicyRepository.getSyncPolicy()`
 * 返回的是 camelCase 的 `{offlineMode, maxOfflineDurationSeconds, requiresTaskClaim,
 * conflictStrategy, policyId}`，且 `routes.ts` 把这个对象原样透传给客户端（`res.json(result)`，
 * 未做任何字段映射）。全仓库确认没有任何全局中间件做驼峰/下划线转换。按文档实现的 PDA
 * 客户端读取 `response.offline_mode` 只会读到 `undefined`——这正是决定"该任务是否必须
 * 强制在线"的关键字段，fail-open 会让冷链/危化品的强制在线合规检查被静默绕过，不是
 * 假设性风险。另外三个字段（`requiresTaskClaim`/`conflictStrategy`/`policyId`）在
 * `fn_get_sync_policy` 的真实返回列（仅 `offline_mode`/`max_offline_duration_seconds`
 * 两列，已用 SQL 源码核实）里根本不存在，原实现里是永远不变的硬编码常量。
 *
 * 修复：删除未在 `ISyncPolicyRepository` 接口上声明、但被 `routes.ts` 实际调用的重复方法
 * `getSyncPolicy()`，把逻辑合并进接口方法 `getEffectivePolicy()`，返回值只保留真实存在的
 * 两个字段；`routes.ts` 改为调用 `getEffectivePolicy()` 并显式映射为 snake_case 响应。
 *
 * **次要缺陷（ONLINE_ONLY 的 max_offline_duration_seconds 归一化）**：数据库 CHECK 约束
 * `chk_sync_policies_limited_duration` 只强制 `LIMITED` 的策略行必须填写
 * `max_offline_duration_seconds`，`ONLINE_ONLY` 行允许该列为 NULL。原实现对 NULL 简单做
 * `|| 28800`（ALLOW 语境下的默认值）兜底，会让 `ONLINE_ONLY` 策略被上报成"最长可离线 8
 * 小时"，与文档"ONLINE_ONLY 时为 0"的约定矛盾。且 `getMaxOfflineDuration()` 原本还对
 * 已经算出来的结果再做一次 `|| 28800`——如果上游已正确算出 `0`，这里的 falsy 判断会把
 * 合法的 `0` 也错误改写回 `28800`。修复：`getEffectivePolicy()` 内部对 `ONLINE_ONLY`
 * 直接归一化为 0；`getMaxOfflineDuration()` 不再做二次 `||` 兜底，直接透传。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset   # 依次应用 001→005 迁移脚本
 *
 * 默认跳过（避免无本地 Supabase 环境时拖垮 `npm run test`/CI）：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- fn_get_sync_policy
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseRpcClient } from '../../../adapters/supabase/rpc/SupabaseRpcClient';
import { SupabaseSyncPolicyRepository } from '../../../adapters/supabase/repositories/SupabaseSyncPolicyRepository';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// `supabase start` 本地默认 service_role key（非生产密钥，仅用于本地一次性沙盒实例）。
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('SupabaseSyncPolicyRepository 离线策略查询正确性（Phase 5/6/7 P1 第 2 项）', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let repo: SupabaseSyncPolicyRepository;
  let tenantId: string;

  const createTenant = async (name: string): Promise<string> => {
    const { data, error } = await client.from('tenants').insert({ name }).select().single();
    if (error) throw error;
    return data.id;
  };

  const createPolicy = async (overrides: {
    taskType?: string | null;
    zoneType?: string | null;
    offlineMode: 'ALLOW' | 'LIMITED' | 'ONLINE_ONLY';
    maxOfflineDurationSeconds?: number | null;
    priority: number;
  }): Promise<string> => {
    const { data, error } = await client
      .from('sync_policies')
      .insert({
        tenant_id: tenantId,
        task_type: overrides.taskType ?? null,
        zone_type: overrides.zoneType ?? null,
        offline_mode: overrides.offlineMode,
        max_offline_duration_seconds: overrides.maxOfflineDurationSeconds ?? null,
        priority: overrides.priority,
      })
      .select()
      .single();
    if (error) throw error;
    return data.id;
  };

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    const wms = WmsSupabaseClient.getInstance({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    client = wms.getClient();
    repo = new SupabaseSyncPolicyRepository(wms, new SupabaseRpcClient(wms));

    const { data: tenant, error: tenantErr } = await client
      .from('tenants')
      .insert({ name: `ecc-p1-2-tenant-${Date.now()}` })
      .select()
      .single();
    if (tenantErr) throw tenantErr;
    tenantId = tenant.id;
  });

  afterAll(async () => {
    if (tenantId) await client.from('tenants').delete().eq('id', tenantId);
  });

  test('未配置任何策略时返回安全默认值 ALLOW + 28800 秒', async () => {
    const otherTenantId = await createTenant(`ecc-p1-2-empty-${Date.now()}`);
    const policy = await repo.getEffectivePolicy(otherTenantId, 'PICK', 'COLD');
    expect(policy).toEqual({ offlineMode: 'ALLOW', maxOfflineDurationSeconds: 28800 });
    await client.from('tenants').delete().eq('id', otherTenantId);
  });

  test('按优先级匹配：租户+任务+库位 > 租户+任务 > 租户+库位 > 租户默认', async () => {
    // Arrange：四个维度递增具体化的策略，priority 越高的应越优先命中
    await createPolicy({ offlineMode: 'ALLOW', priority: 0 }); // 租户默认
    await createPolicy({ taskType: 'PICK', offlineMode: 'LIMITED', maxOfflineDurationSeconds: 1800, priority: 10 }); // 租户+任务
    await createPolicy({ zoneType: 'COLD', offlineMode: 'ONLINE_ONLY', priority: 10 }); // 租户+库位
    await createPolicy({ taskType: 'PICK', zoneType: 'COLD', offlineMode: 'ONLINE_ONLY', priority: 20 }); // 租户+任务+库位（最具体）

    // Act + Assert：最具体的组合命中
    const mostSpecific = await repo.getEffectivePolicy(tenantId, 'PICK', 'COLD');
    expect(mostSpecific).toEqual({ offlineMode: 'ONLINE_ONLY', maxOfflineDurationSeconds: 0 });

    // Act + Assert：只有任务类型匹配时命中"租户+任务"这条
    const taskOnly = await repo.getEffectivePolicy(tenantId, 'PICK', 'BULK');
    expect(taskOnly).toEqual({ offlineMode: 'LIMITED', maxOfflineDurationSeconds: 1800 });

    // Act + Assert：都不匹配时落到租户默认
    const noMatch = await repo.getEffectivePolicy(tenantId, 'PUTAWAY', 'BULK');
    expect(noMatch).toEqual({ offlineMode: 'ALLOW', maxOfflineDurationSeconds: 28800 });
  });

  test('回归防护：ONLINE_ONLY 策略的 max_offline_duration_seconds 为 NULL 时应归一化为 0，而不是退回 28800', async () => {
    // Arrange：ONLINE_ONLY 行不指定 max_offline_duration_seconds（CHECK 约束允许 NULL）
    await createPolicy({ taskType: 'LOAD', offlineMode: 'ONLINE_ONLY', maxOfflineDurationSeconds: null, priority: 15 });

    // Act
    const policy = await repo.getEffectivePolicy(tenantId, 'LOAD');
    const maxDuration = await repo.getMaxOfflineDuration(tenantId, 'LOAD');
    const offlineAllowed = await repo.isOfflineAllowed(tenantId, 'LOAD');

    // Assert
    expect(policy.offlineMode).toBe('ONLINE_ONLY');
    expect(policy.maxOfflineDurationSeconds).toBe(0);
    expect(maxDuration).toBe(0); // 不应被 `|| 28800` 误判为 falsy 而改写
    expect(offlineAllowed).toBe(false);
  });

  test('回归防护：getEffectivePolicy 只返回文档契约声明的两个字段，不包含 SQL 端不存在的字段', async () => {
    await createPolicy({ taskType: 'COUNT', offlineMode: 'LIMITED', maxOfflineDurationSeconds: 600, priority: 15 });

    const policy = await repo.getEffectivePolicy(tenantId, 'COUNT');

    expect(Object.keys(policy).sort()).toEqual(['maxOfflineDurationSeconds', 'offlineMode']);
    expect(policy).not.toHaveProperty('requiresTaskClaim');
    expect(policy).not.toHaveProperty('conflictStrategy');
    expect(policy).not.toHaveProperty('policyId');
  });

  test('isOfflineAllowed 对 ALLOW/LIMITED 返回 true，对 ONLINE_ONLY 返回 false', async () => {
    await createPolicy({ taskType: 'RECEIVE', offlineMode: 'ALLOW', priority: 15 });
    await createPolicy({ taskType: 'INVENTORY', offlineMode: 'ONLINE_ONLY', priority: 15 });

    expect(await repo.isOfflineAllowed(tenantId, 'RECEIVE')).toBe(true);
    expect(await repo.isOfflineAllowed(tenantId, 'INVENTORY')).toBe(false);
  });

  test('findByTenant / findByTaskType / findByZoneType 按维度正确过滤', async () => {
    const otherTenantId = await createTenant(`ecc-p1-2-find-${Date.now()}`);
    const { data: p1, error: p1Err } = await client.from('sync_policies').insert({ tenant_id: otherTenantId, task_type: 'PICK', offline_mode: 'ALLOW', priority: 5 }).select().single();
    if (p1Err) throw p1Err;
    const { data: p2, error: p2Err } = await client.from('sync_policies').insert({ tenant_id: otherTenantId, zone_type: 'HAZMAT', offline_mode: 'ONLINE_ONLY', priority: 5 }).select().single();
    if (p2Err) throw p2Err;

    const byTenant = await repo.findByTenant(otherTenantId);
    expect(byTenant.map((r) => r.id).sort()).toEqual([p1.id, p2.id].sort());

    const byTaskType = await repo.findByTaskType(otherTenantId, 'PICK');
    expect(byTaskType.map((r) => r.id)).toEqual([p1.id]);

    const byZoneType = await repo.findByZoneType(otherTenantId, 'HAZMAT');
    expect(byZoneType.map((r) => r.id)).toEqual([p2.id]);

    await client.from('tenants').delete().eq('id', otherTenantId);
  });
});
