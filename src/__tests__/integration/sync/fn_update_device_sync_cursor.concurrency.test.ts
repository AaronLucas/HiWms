/**
 * ECC 治理 Phase 5/6/7 测试补齐（docs/03-database/REPOSITORY_ROADMAP.md P2 第 4 项，
 * 也是本轮测试补齐工程的最后一项）：`SupabaseDeviceSyncStateRepository` 正确性验证。
 *
 * === 可达性核查（测试方法论第 6 步）===
 * `updateCursor` 是**真实生产路径**：`src/apps/device-api/routes.ts` 的 `GET /sync/pull`
 * （PDA 增量拉取的核心端点）只要本次有新事件要返回就会调用它。`recordSyncFailure`/
 * `findAllByTenant`/`findStaleDevices`/`resetDeviceState` 目前无真实调用方。
 *
 * === 发现并修复的真实缺陷（本轮测试补齐工程里最严重的一项，纯 TS 应用层代码，
 * 未触碰任何 .sql 文件）===
 * 原实现整个仓储写的是一套跟真实 schema 对不上的列名/主键假设（已用
 * `psql \d device_sync_state` 核实真实结构：主键只有 `device_id`，不是
 * `(device_id, tenant_id)` 复合键；列是 `last_applied_seq`/`last_pull_at`/
 * `last_push_at`/`last_seen_online_at`，没有 `last_pulled_seq`/`last_sync_at`/
 * `sync_status`/`error_message` 这几个原实现写过的列）：
 *
 * - `updateCursor`：`onConflict: 'device_id,tenant_id'` 找不到匹配的唯一约束
 *   （`42P10`）；即便约束对了，写入的 `last_pulled_seq`/`last_sync_at`/
 *   `sync_status`/`error_message` 四个字段全部不存在（`42703`）。**这是唯一真实
 *   调用方 `GET /sync/pull` 的必经路径**——本次测试补齐前，任何一次有新事件要
 *   返回的拉取请求都会因为这个方法报错而整体 500，是本轮测试补齐工程里目前
 *   最严重的真实生产 bug（原先的 P2 排序依据"结构最简单，历史上没有 bug 记录"
 *   与实际情况相反）。
 * - `recordSyncFailure`：同样引用不存在的列；真实表也没有任何列可以承载
 *   "失败原因"这个信息（不是列名笔误，是这张表设计上就不含错误追踪能力）。
 * - `findAllByTenant`/`findStaleDevices`：排序/过滤依据的 `last_sync_at` 列不存在。
 *
 * 修复：
 * - `updateCursor`：`onConflict` 改为 `device_id`；写入真实存在的
 *   `last_applied_seq`/`last_pull_at`。
 * - `recordSyncFailure`：改为只更新 `last_seen_online_at`（表示设备至少还联系
 *   得上，只是没能成功同步），不修改 `last_applied_seq`/`last_pull_at`，避免把
 *   失败误报成成功；若确实需要保留失败原因用于告警，需要 DBA 协调加列，不在
 *   本次范围内。
 * - `findAllByTenant`：改为按 `updated_at` 排序（真实存在、有默认值的通用
 *   "最近改动"列）。
 * - `findStaleDevices`：改为按 `last_pull_at` 判断（`updateCursor` 唯一真实写入
 *   的活跃度信号），并把"从未成功拉取过"（`last_pull_at IS NULL`）的设备也
 *   一并纳入"该关注"范围，而不是被 `.lt()` 天然排除在外。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset   # 依次应用 001→004 迁移脚本
 *
 * 默认跳过（避免无本地 Supabase 环境时拖垮 `npm run test`/CI）：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- fn_update_device_sync_cursor
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseDeviceSyncStateRepository } from '../../../adapters/supabase/repositories/SupabaseDeviceSyncStateRepository';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// `supabase start` 本地默认 service_role key（非生产密钥，仅用于本地一次性沙盒实例）。
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('SupabaseDeviceSyncStateRepository 设备同步游标正确性（Phase 5/6/7 P2 第 4 项）', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let repo: SupabaseDeviceSyncStateRepository;
  let tenantId: string;

  const createDevice = async (): Promise<string> => {
    const { data, error } = await client
      .from('devices')
      .insert({ tenant_id: tenantId, device_code: `p2-4-device-${Date.now()}-${Math.random()}`, device_type: 'PDA' })
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
    repo = new SupabaseDeviceSyncStateRepository(wms);

    const { data: tenant, error: tenantErr } = await client
      .from('tenants')
      .insert({ name: `ecc-p2-4-tenant-${Date.now()}` })
      .select()
      .single();
    if (tenantErr) throw tenantErr;
    tenantId = tenant.id;
  });

  afterAll(async () => {
    if (tenantId) await client.from('tenants').delete().eq('id', tenantId);
  });

  test('updateCursor 首次调用应创建游标行（回归防护：原实现每次调用必报 42P10/42703，这是 GET /sync/pull 的必经路径）', async () => {
    const deviceId = await createDevice();

    const updated = await repo.updateCursor(deviceId, tenantId, 42);

    expect(updated.device_id).toBe(deviceId);
    expect(Number(updated.last_applied_seq)).toBe(42);
    expect(updated.last_pull_at).toBeTruthy();
  });

  test('updateCursor 对同一设备二次调用应更新游标而不是产生第二行', async () => {
    const deviceId = await createDevice();

    await repo.updateCursor(deviceId, tenantId, 10);
    const updated = await repo.updateCursor(deviceId, tenantId, 25);

    expect(Number(updated.last_applied_seq)).toBe(25);

    const { data: rows, error } = await client.from('device_sync_state').select('*').eq('device_id', deviceId);
    if (error) throw error;
    expect(rows).toHaveLength(1);
  });

  test('recordSyncFailure 应更新 last_seen_online_at 但不影响已有的 last_applied_seq/last_pull_at（回归防护：原实现引用不存在的 sync_status/error_message 列）', async () => {
    const deviceId = await createDevice();
    await repo.updateCursor(deviceId, tenantId, 7);

    await repo.recordSyncFailure(deviceId, tenantId, 'network timeout');

    const state = await repo.findByDevice(deviceId, tenantId);
    expect(Number(state?.last_applied_seq)).toBe(7); // 失败不应回退/清空已成功的游标
    expect(state?.last_seen_online_at).toBeTruthy();
  });

  test('findByDevice 查不到时应返回 null', async () => {
    const deviceId = await createDevice();
    const result = await repo.findByDevice(deviceId, tenantId);
    expect(result).toBeNull();
  });

  test('findAllByTenant 应返回该租户全部设备状态，按更新时间倒序（回归防护：原实现排序依据的 last_sync_at 列不存在）', async () => {
    const { data: otherTenant, error: tenantErr } = await client.from('tenants').insert({ name: `ecc-p2-4-findall-${Date.now()}` }).select().single();
    if (tenantErr) throw tenantErr;
    const otherTenantId = otherTenant.id;
    const otherRepo = new SupabaseDeviceSyncStateRepository(WmsSupabaseClient.getInstance());

    const { data: deviceARow, error: deviceAErr } = await client.from('devices').insert({ tenant_id: otherTenantId, device_code: `p2-4-findall-a-${Date.now()}`, device_type: 'PDA' }).select().single();
    if (deviceAErr) throw deviceAErr;
    const { data: deviceBRow, error: deviceBErr } = await client.from('devices').insert({ tenant_id: otherTenantId, device_code: `p2-4-findall-b-${Date.now()}`, device_type: 'PDA' }).select().single();
    if (deviceBErr) throw deviceBErr;

    await otherRepo.updateCursor(deviceARow.id, otherTenantId, 1);
    await otherRepo.updateCursor(deviceBRow.id, otherTenantId, 2);

    const all = await otherRepo.findAllByTenant(otherTenantId);
    expect(all.map((r) => r.device_id).sort()).toEqual([deviceARow.id, deviceBRow.id].sort());

    await client.from('tenants').delete().eq('id', otherTenantId);
  });

  test('findStaleDevices 应识别超过阈值未拉取的设备，且从未拉取过的设备也应被纳入（回归防护：原实现过滤依据的 last_sync_at 列不存在）', async () => {
    const staleDevice = await createDevice();
    const freshDevice = await createDevice();
    const neverPulledDevice = await createDevice();

    // staleDevice：手工把 last_pull_at 设为很久以前
    await repo.updateCursor(staleDevice, tenantId, 1);
    await client
      .from('device_sync_state')
      .update({ last_pull_at: new Date(Date.now() - 100_000).toISOString() })
      .eq('device_id', staleDevice);

    // freshDevice：刚刚拉取过
    await repo.updateCursor(freshDevice, tenantId, 1);

    // neverPulledDevice：从未调用过 updateCursor，但通过 recordSyncFailure 产生了一行
    await repo.recordSyncFailure(neverPulledDevice, tenantId, 'never synced');

    const stale = await repo.findStaleDevices(tenantId, 10);
    const staleIds = stale.map((d) => d.device_id);

    expect(staleIds).toContain(staleDevice);
    expect(staleIds).toContain(neverPulledDevice);
    expect(staleIds).not.toContain(freshDevice);
  });

  test('resetDeviceState 应删除该设备的同步状态行', async () => {
    const deviceId = await createDevice();
    await repo.updateCursor(deviceId, tenantId, 5);

    await repo.resetDeviceState(deviceId, tenantId);

    const result = await repo.findByDevice(deviceId, tenantId);
    expect(result).toBeNull();
  });

  test('并发对同一设备发起 5 次 updateCursor，最终应恰好 1 行，游标为其中一次写入的值，且无请求崩溃', async () => {
    const deviceId = await createDevice();

    const settled = await Promise.allSettled(
      [1, 2, 3, 4, 5].map((seq) => repo.updateCursor(deviceId, tenantId, seq))
    );

    const rejected = settled.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(0);

    const { data: rows, error } = await client.from('device_sync_state').select('*').eq('device_id', deviceId);
    if (error) throw error;
    expect(rows).toHaveLength(1);
    expect([1, 2, 3, 4, 5]).toContain(Number(rows![0].last_applied_seq));
  });
});
