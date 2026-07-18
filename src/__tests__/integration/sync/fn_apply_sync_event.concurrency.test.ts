/**
 * ECC 治理 Phase 5/6/7 测试补齐（docs/03-database/REPOSITORY_ROADMAP.md P0 第 2 项）：
 * `SupabaseSyncEventRepository` / `fn_apply_pick_action` 等 apply RPC 正确性验证。
 *
 * 覆盖缺口：所有 PDA 离线动作（拣货/上架/盘点/打包）都经过这条收件箱，是"全系统并发
 * 最密集的入口"。本文件直接实例化仓储类 `SupabaseSyncEventRepository`（而非绕过仓储直接
 * 调 RPC），验证的是"已实现未验证"的仓储代码路径本身。
 *
 * === 已知问题：已由 DBA 团队修复（2026-07-19 验证）===
 * 发现记录：`fn_apply_pick_action`（及同批 `fn_apply_putaway_action`/`fn_apply_count_action`/
 * `fn_apply_pack_action`，均在 supabase/migrations/003_extend_sync_event_actions.sql）曾用
 * 普通 `SELECT ... WHERE status = 'PENDING'` 判断事件是否可处理，没有原子转移，真实并发下
 * 同一事件可被重复 APPLIED（已用手工 psql 双并发复现：100 库存，qty=10 的 PICK 动作并发调用
 * 两次，两次都返回 APPLIED，最终库存 80 而非 90）；`fn_apply_sync_event` 处理未知 `action_type`
 * 时也没有登记进统一异常领域。完整复现步骤 + 修复建议见
 * `docs/03-database/BUG_REPORT_SYNC_EVENT_APPLY_FUNCTIONS_2026-07-19.md`（已提交 DBA）。
 *
 * 修复记录：DBA 团队交付 `supabase/migrations/005_concurrency_hardening_V1.sql`
 * （`.readonly/unWMS_Concurrency_Hardening_V1.sql`/`.md`），给 `sync_events.status` 补了
 * `PROCESSING` 中间态，`fn_apply_sync_event` 改用原子 `UPDATE ... WHERE status = 'PENDING'
 * RETURNING` 一次性完成"判断+转移"，四个动作子函数不再各自判断 PENDING（处理权已经由
 * dispatcher 原子抢占），并补上了未知 action_type 的 `fn_raise_exception` 登记。本地应用
 * 该迁移后连续 5 次整套重跑，原本的两个 `test.fails(...)` 全部稳定转为"意外通过"（不再有
 * 1/7 概率的时序抖动），已改回下面的普通 `test(...)`，作为这次修复的回归防护。
 *
 * DBA 顺着同一个"判断状态和转移状态没有原子锁"的模式排查全部 SQL 文件，额外发现并
 * 一并修复了 `fn_resolve_exception`（比这里报的问题更严重——会导致库存复盘收尾动作被
 * 执行两次）、`fn_expire_task_claims`、`fn_cross_dock_timeout_sweep` 的同类问题，不在本
 * 文件测试范围内，见 `docs/03-database/REPOSITORY_ROADMAP.md` P0 第 2 项执行记录。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset   # 依次应用 001→005 迁移脚本
 *
 * 默认跳过（避免无本地 Supabase 环境时拖垮 `npm run test`/CI）：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- fn_apply_sync_event
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'crypto';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseRpcClient } from '../../../adapters/supabase/rpc/SupabaseRpcClient';
import { SupabaseSyncEventRepository } from '../../../adapters/supabase/repositories/SupabaseSyncEventRepository';
import type { SyncEventInsert } from '../../../core/ports/db/ISyncEventRepository';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// `supabase start` 本地默认 service_role key（非生产密钥，仅用于本地一次性沙盒实例）。
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('SupabaseSyncEventRepository 同步事件收件箱正确性（Phase 5/6/7 P0 第 2 项）', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let repo: SupabaseSyncEventRepository;
  let tenantId: string;
  let deviceId: string;
  let productId: string;
  let deviceSeqCounter = 1;

  const createLocation = async (): Promise<string> => {
    const { data, error } = await client
      .from('locations')
      .insert({ tenant_id: tenantId, code: `p0-2-loc-${Date.now()}-${Math.random()}`, is_active: true })
      .select()
      .single();
    if (error) throw error;
    return data.id;
  };

  const createContainer = async (locationId: string): Promise<string> => {
    const { data, error } = await client
      .from('containers')
      .insert({ lpn_code: `p0-2-lpn-${Date.now()}-${Math.random()}`, current_location_id: locationId })
      .select()
      .single();
    if (error) throw error;
    return data.id;
  };

  const seedInventory = async (locationId: string, containerId: string, quantity: number): Promise<void> => {
    const { error } = await client
      .from('inventory')
      .insert({ tenant_id: tenantId, product_id: productId, location_id: locationId, container_id: containerId, quantity });
    if (error) throw error;
  };

  const getInventoryQty = async (locationId: string, containerId: string): Promise<number> => {
    const { data, error } = await client
      .from('inventory')
      .select('quantity')
      .eq('product_id', productId)
      .eq('location_id', locationId)
      .eq('container_id', containerId)
      .single();
    if (error) throw error;
    return Number(data!.quantity);
  };

  const createPickEvent = async (
    locationId: string,
    containerId: string,
    qty: number,
    overrides: Partial<SyncEventInsert> = {}
  ): Promise<string> => {
    const id = randomUUID();
    const { error } = await client.from('sync_events').insert({
      id,
      tenant_id: tenantId,
      device_id: deviceId,
      device_seq: deviceSeqCounter++,
      action_type: 'PICK',
      payload: { sku: 'P0-2-SKU', qty, location_id: locationId, container_id: containerId },
      captured_at: new Date().toISOString(),
      status: 'PENDING',
      ...overrides,
    } as SyncEventInsert);
    if (error) throw error;
    return id;
  };

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    const wms = WmsSupabaseClient.getInstance({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    client = wms.getClient();
    repo = new SupabaseSyncEventRepository(wms, new SupabaseRpcClient(wms));

    const { data: tenant, error: tenantErr } = await client
      .from('tenants')
      .insert({ name: `ecc-p0-2-tenant-${Date.now()}` })
      .select()
      .single();
    if (tenantErr) throw tenantErr;
    tenantId = tenant.id;

    const { data: device, error: deviceErr } = await client
      .from('devices')
      .insert({ tenant_id: tenantId, device_code: `ecc-p0-2-device-${Date.now()}`, device_type: 'PDA' })
      .select()
      .single();
    if (deviceErr) throw deviceErr;
    deviceId = device.id;

    const { data: product, error: productErr } = await client
      .from('products')
      .insert({ tenant_id: tenantId, sku: 'P0-2-SKU', name: 'P0 Item 2 Test Product' })
      .select()
      .single();
    if (productErr) throw productErr;
    productId = product.id;
  });

  afterAll(async () => {
    // tenants 上的外键均为 ON DELETE CASCADE，删除租户即可级联清理 device/product/location/container/inventory/sync_events。
    if (tenantId) await client.from('tenants').delete().eq('id', tenantId);
  });

  test('insertBatch：同一 device_id + device_seq 重复提交应记为 duplicate，不重复入库', async () => {
    // Arrange
    const id1 = randomUUID();
    const seq = deviceSeqCounter++;
    const event: SyncEventInsert = {
      id: id1,
      tenant_id: tenantId,
      device_id: deviceId,
      device_seq: seq,
      action_type: 'PICK',
      payload: { sku: 'P0-2-SKU', qty: 1 },
      captured_at: new Date().toISOString(),
      status: 'PENDING',
    };

    // Act：首次提交
    const first = await repo.insertBatch([event]);
    // Act：设备断线重传，携带不同的本地 id 但相同的 device_id+device_seq（真实场景：本地重试用了新 UUID）
    const retryEvent: SyncEventInsert = { ...event, id: randomUUID() };
    const second = await repo.insertBatch([retryEvent]);

    // Assert
    expect(first).toEqual({ inserted: 1, duplicates: 0 });
    expect(second).toEqual({ inserted: 0, duplicates: 1 });

    const { data: rows, error } = await client
      .from('sync_events')
      .select('id')
      .eq('device_id', deviceId)
      .eq('device_seq', seq);
    expect(error).toBeNull();
    expect(rows).toHaveLength(1); // 只应有首次提交的那一行，重传未产生第二行
  });

  test('applyEvent：库存充足时应用 PICK 动作，正确扣减库存并标记 APPLIED', async () => {
    // Arrange
    const locationId = await createLocation();
    const containerId = await createContainer(locationId);
    await seedInventory(locationId, containerId, 50);
    const eventId = await createPickEvent(locationId, containerId, 5);

    // Act
    const result = await repo.applyEvent(eventId);

    // Assert
    expect(result.success).toBe(true);
    expect(await getInventoryQty(locationId, containerId)).toBe(45);
    const { data: eventRow, error } = await client.from('sync_events').select('status').eq('id', eventId).single();
    expect(error).toBeNull();
    expect(eventRow!.status).toBe('APPLIED');
  });

  test('applyEvent：库存不足时不应静默标记为 APPLIED，应保留数据库函数已登记的 EXCEPTION 状态', async () => {
    // Arrange：库位库存 3，请求扣 10（库存不足）
    const locationId = await createLocation();
    const containerId = await createContainer(locationId);
    await seedInventory(locationId, containerId, 3);
    const eventId = await createPickEvent(locationId, containerId, 10);

    // Act
    const result = await repo.applyEvent(eventId);

    // Assert：applyEvent 的返回值应如实反映"这个动作没有真正生效"，不能因为 RPC 调用本身
    // 没有 throw 就报告 success:true——fn_apply_sync_event 对库存不足是"捕获后返回一个
    // 字符串"，不是抛异常，success 必须基于事件最终的真实 status 判断。
    expect(result.success).toBe(false);

    // Assert：库存不应被扣减（fn_apply_pick_action 在库存不足时不触碰 inventory）
    expect(await getInventoryQty(locationId, containerId)).toBe(3);

    // Assert：事件状态应为 EXCEPTION（fn_apply_pick_action 已经把这一行更新为 EXCEPTION 并登记
    // exceptions 记录 + 生成复盘工单），仓储层不应该在拿到 RPC 返回值后无条件覆盖回 APPLIED。
    const { data: eventRow, error } = await client.from('sync_events').select('status').eq('id', eventId).single();
    expect(error).toBeNull();
    expect(eventRow!.status).toBe('EXCEPTION');

    // Assert：exceptions 表应能查到对应的库存不足异常，findExceptions() 也应能查到这条事件
    const exceptions = await repo.findExceptions(tenantId);
    expect(exceptions.map((e) => e.id)).toContain(eventId);
  });

  test('[回归防护，原已知问题 Bug A，DBA 于 005_concurrency_hardening_V1.sql 修复] applyEvent 对同一事件真实并发调用两次时，应只有一次生效', async () => {
    // Arrange
    const locationId = await createLocation();
    const containerId = await createContainer(locationId);
    await seedInventory(locationId, containerId, 100);
    const eventId = await createPickEvent(locationId, containerId, 10);

    // Act：真正并发（Promise.all）对同一个事件调用两次 applyEvent
    const [r1, r2] = await Promise.all([repo.applyEvent(eventId), repo.applyEvent(eventId)]);

    // Assert：dispatcher 的原子抢占应保证有且仅有一次真正执行了业务逻辑（拿到
    // 'APPLIED'，或落后一步拿到 'SKIPPED_NOT_PENDING'），库存精确等于 90，不是 80。
    // 注意：不断言 success 字段在两次调用之间如何分布——两次调用各自独立重新查询
    // 事件最终状态来判定 success（见 applyEvent 实现），如果这次 SKIPPED_NOT_PENDING
    // 的那次调用查询时另一次已经跑完并落定为 APPLIED，它查到的也会是 APPLIED，从而
    // 同样报告 success:true，这是符合预期的幂等语义（"这个事件最终有没有被正确应用"
    // 与"是不是我这次调用做的"是两个不同的问题，success 只回答前者），不代表库存被
    // 重复扣减。
    const results = [r1, r2];
    expect(results.map((r) => r.result)).toContain('SKIPPED_NOT_PENDING');
    expect(results.map((r) => r.result)).toContain('APPLIED');
    expect(await getInventoryQty(locationId, containerId)).toBe(90);
  });

  test('applyEvent：未知 action_type 应通过 fn_apply_sync_event 统一分发入口标记为 REJECTED（验证未绕开该入口）', async () => {
    // Arrange：'MOVE' 在 SyncActionType 里存在，但没有专属 fn_apply_*_action 函数——
    // 只有 fn_apply_sync_event 自己的 dispatcher 知道把它标记为 REJECTED_UNKNOWN_ACTION。
    // 如果 applyEvent 曾经绕开这个统一入口直接调用专用函数，这类事件会永远卡在 PENDING。
    const eventId = randomUUID();
    const { error } = await client.from('sync_events').insert({
      id: eventId,
      tenant_id: tenantId,
      device_id: deviceId,
      device_seq: deviceSeqCounter++,
      action_type: 'MOVE',
      payload: {},
      captured_at: new Date().toISOString(),
      status: 'PENDING',
    } as SyncEventInsert);
    if (error) throw error;

    // Act
    const result = await repo.applyEvent(eventId);

    // Assert：这个动作没有真正被应用（最终 status 是 REJECTED，不是 APPLIED），success 必须
    // 是 false——不能因为 fn_apply_sync_event 这次调用本身没有 throw 就报告成功。
    expect(result.success).toBe(false);
    expect(result.result).toBe('REJECTED_UNKNOWN_ACTION');
    const { data: eventRow, error: readErr } = await client.from('sync_events').select('status').eq('id', eventId).single();
    expect(readErr).toBeNull();
    expect(eventRow!.status).toBe('REJECTED');
  });

  test('[回归防护，原已知问题 Bug E，DBA 于 005_concurrency_hardening_V1.sql 修复] applyEvent 对未知 action_type 应在统一异常域登记 SYNC_APPLY_FAILURE', async () => {
    // Arrange：同上一个用例，'MOVE' 会走 fn_apply_sync_event 的 ELSE 分支
    const eventId = randomUUID();
    const { error } = await client.from('sync_events').insert({
      id: eventId,
      tenant_id: tenantId,
      device_id: deviceId,
      device_seq: deviceSeqCounter++,
      action_type: 'MOVE',
      payload: {},
      captured_at: new Date().toISOString(),
      status: 'PENDING',
    } as SyncEventInsert);
    if (error) throw error;

    // Act
    await repo.applyEvent(eventId);

    // Assert：fn_apply_sync_event 的 ELSE 分支现在应该像同一函数里 WMS01/OTHERS 两个分支
    // 一样调用 fn_raise_exception，让"设备发了个系统不认识的动作类型"这类场景能在
    // exceptions 表/GET /exceptions 上被运维看到
    const { data: exceptionRows, error: excErr } = await client
      .from('exceptions')
      .select('id')
      .eq('source_table', 'sync_events')
      .eq('source_id', eventId)
      .eq('exception_type', 'SYNC_APPLY_FAILURE');
    expect(excErr).toBeNull();
    expect(exceptionRows).toHaveLength(1);
  });

  test('findPending / findAppliedSince：按 device_seq 顺序返回对应状态的事件', async () => {
    // Arrange
    const locationId = await createLocation();
    const containerId = await createContainer(locationId);
    await seedInventory(locationId, containerId, 100);
    const pendingId = await createPickEvent(locationId, containerId, 1);
    const appliedId = await createPickEvent(locationId, containerId, 1);
    await repo.applyEvent(appliedId);

    // Act
    const pending = await repo.findPending(tenantId);
    const appliedSinceZero = await repo.findAppliedSince(tenantId, 0);

    // Assert
    expect(pending.map((e) => e.id)).toContain(pendingId);
    expect(pending.map((e) => e.id)).not.toContain(appliedId);
    expect(appliedSinceZero.map((e) => e.id)).toContain(appliedId);
    expect(appliedSinceZero.map((e) => e.id)).not.toContain(pendingId);
  });

  test('findByIdempotencyKey：按 id + device_seq + tenant_id 精确匹配，查不到时返回 null', async () => {
    // Arrange
    const locationId = await createLocation();
    const containerId = await createContainer(locationId);
    const seq = deviceSeqCounter;
    const eventId = await createPickEvent(locationId, containerId, 1);

    // Act + Assert
    const found = await repo.findByIdempotencyKey(eventId, seq, tenantId);
    expect(found?.id).toBe(eventId);

    const notFound = await repo.findByIdempotencyKey(randomUUID(), 999999, tenantId);
    expect(notFound).toBeNull();
  });

  test('getMaxDeviceSeq：仅统计 APPLIED 状态事件，无已应用事件时返回 0', async () => {
    // Arrange：全新设备，尚无任何事件
    const { data: freshDevice, error: deviceErr } = await client
      .from('devices')
      .insert({ tenant_id: tenantId, device_code: `p0-2-fresh-device-${Date.now()}`, device_type: 'PDA' })
      .select()
      .single();
    if (deviceErr) throw deviceErr;

    // Act + Assert：无事件时应为 0
    expect(await repo.getMaxDeviceSeq(freshDevice.id, tenantId)).toBe(0);

    // Arrange：插入一个 PENDING（不应计入）和一个 APPLIED（应计入）事件
    const locationId = await createLocation();
    const containerId = await createContainer(locationId);
    await seedInventory(locationId, containerId, 100);

    const pendingSeq = 10;
    await client.from('sync_events').insert({
      id: randomUUID(),
      tenant_id: tenantId,
      device_id: freshDevice.id,
      device_seq: pendingSeq,
      action_type: 'PICK',
      payload: { sku: 'P0-2-SKU', qty: 1, location_id: locationId, container_id: containerId },
      captured_at: new Date().toISOString(),
      status: 'PENDING',
    } as SyncEventInsert);

    const appliedSeq = 5;
    const appliedEventId = randomUUID();
    await client.from('sync_events').insert({
      id: appliedEventId,
      tenant_id: tenantId,
      device_id: freshDevice.id,
      device_seq: appliedSeq,
      action_type: 'PICK',
      payload: { sku: 'P0-2-SKU', qty: 1, location_id: locationId, container_id: containerId },
      captured_at: new Date().toISOString(),
      status: 'PENDING',
    } as SyncEventInsert);
    await repo.applyEvent(appliedEventId);

    // Act + Assert：应返回已 APPLIED 事件的 device_seq（5），而不是更大的 PENDING 的 10
    expect(await repo.getMaxDeviceSeq(freshDevice.id, tenantId)).toBe(appliedSeq);
  });

  test('markAsDuplicate / retryEvent：状态转换正确', async () => {
    // Arrange
    const locationId = await createLocation();
    const containerId = await createContainer(locationId);
    const eventId = await createPickEvent(locationId, containerId, 1);

    // Act + Assert：标记为重复（sync_events.status 的 CHECK 约束没有 DUPLICATE 值，落库为 REJECTED；
    // 表也没有存储原因文本的列，仅验证状态转换）
    await repo.markAsDuplicate(eventId, '设备重传');
    let row = await client.from('sync_events').select('status').eq('id', eventId).single();
    expect(row.data!.status).toBe('REJECTED');

    // Act + Assert：重试后应回到 PENDING
    await repo.retryEvent(eventId);
    row = await client.from('sync_events').select('status').eq('id', eventId).single();
    expect(row.data!.status).toBe('PENDING');
  });

  test('getStatusStats：正确统计各状态事件数量', async () => {
    // Arrange：全新租户级隔离范围，避免与其他用例的事件互相干扰计数
    const { data: statsTenant, error: tenantErr } = await client
      .from('tenants')
      .insert({ name: `ecc-p0-2-stats-tenant-${Date.now()}` })
      .select()
      .single();
    if (tenantErr) throw tenantErr;

    const { data: statsDevice, error: deviceErr } = await client
      .from('devices')
      .insert({ tenant_id: statsTenant.id, device_code: `p0-2-stats-device-${Date.now()}`, device_type: 'PDA' })
      .select()
      .single();
    if (deviceErr) throw deviceErr;

    try {
      const insertRaw = (status: string, seq: number) =>
        client.from('sync_events').insert({
          id: randomUUID(),
          tenant_id: statsTenant.id,
          device_id: statsDevice.id,
          device_seq: seq,
          action_type: 'PICK',
          payload: { sku: 'P0-2-SKU', qty: 1 },
          captured_at: new Date().toISOString(),
          status,
        } as SyncEventInsert);

      await insertRaw('PENDING', 1);
      await insertRaw('PENDING', 2);
      await insertRaw('APPLIED', 3);
      await insertRaw('EXCEPTION', 4);
      await insertRaw('REJECTED', 5);

      // Act
      const stats = await repo.getStatusStats(statsTenant.id);

      // Assert
      expect(stats).toEqual({ PENDING: 2, PROCESSING: 0, APPLIED: 1, EXCEPTION: 1, REJECTED: 1 });
    } finally {
      await client.from('tenants').delete().eq('id', statsTenant.id);
    }
  });
});
