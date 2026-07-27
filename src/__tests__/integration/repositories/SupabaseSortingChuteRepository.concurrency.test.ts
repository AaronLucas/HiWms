/**
 * Sprint 0 集成测试：SupabaseSortingChuteRepository 正确性验证
 *
 * 覆盖 ISortingChuteRepository 全部方法：CRUD + createBatch / findByWave / findByTarget /
 * findAvailable / updateCurrentQty / updateStatus / getUtilizationStats。
 * 直接实例化仓储类，验证"已实现未验证"的仓储代码路径本身。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start && supabase db reset
 *
 * 默认跳过：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- SupabaseSortingChuteRepository
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'crypto';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseSortingChuteRepository } from '../../../adapters/supabase/repositories/SupabaseSortingChuteRepository';
import type { SortingChuteInsert } from '../../../core/ports/db/ISortingChuteRepository';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('SupabaseSortingChuteRepository 滑道 CRUD 正确性（Sprint 0）', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let repo: SupabaseSortingChuteRepository;
  let tenantId: string;
  let waveId: string;
  const createdChuteIds: string[] = [];

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    const wms = WmsSupabaseClient.getInstance({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    client = wms.getClient();
    repo = new SupabaseSortingChuteRepository(wms);

    const { data: tenant, error: tenantError } = await client
      .from('tenants')
      .insert({ name: `sprint0-chute-tenant-${Date.now()}` })
      .select()
      .single();
    if (tenantError || !tenant) throw new Error(`创建测试租户失败: ${tenantError?.message}`);
    tenantId = tenant.id;

    const { data: wave, error: waveError } = await client
      .from('waves')
      .insert({ tenant_id: tenantId, wave_no: `WAVE-${Date.now()}`, status: 'active' })
      .select()
      .single();
    if (waveError || !wave) throw new Error(`创建测试波次失败: ${waveError?.message}`);
    waveId = wave.id;
  });

  afterAll(async () => {
    for (const id of createdChuteIds) {
      await client.from('sorting_chutes').delete().eq('id', id);
    }
    await client.from('waves').delete().eq('id', waveId);
    await client.from('tenants').delete().eq('id', tenantId);
  });

  test('create：创建新滑道并返回完整行', async () => {
    const chuteCode = `TEST_CHUTE_${randomUUID().slice(0, 8)}`;
    const chute: SortingChuteInsert = {
      tenant_id: tenantId,
      wave_id: waveId,
      chute_code: chuteCode,
      target_type: 'ORDER',
      capacity: 100,
      current_qty: 0,
      status: 'active',
      sort_sequence: 1,
    };

    const created = await repo.create(chute);
    createdChuteIds.push(created.id);

    expect(created.id).toBeTruthy();
    expect(created.chute_code).toBe(chuteCode);
    expect(created.target_type).toBe('ORDER');
    expect(created.tenant_id).toBe(tenantId);
    expect(created.capacity).toBe(100);
  });

  test('findById：按 ID 查找滑道', async () => {
    const chuteCode = `TEST_CHUTE_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      wave_id: waveId,
      chute_code: chuteCode,
      target_type: 'ORDER',
      capacity: 50,
      current_qty: 0,
      status: 'active',
    });
    createdChuteIds.push(created.id);

    const found = await repo.findById(created.id);
    expect(found).not.toBeNull();
    expect(found!.chute_code).toBe(chuteCode);
  });

  test('update：更新滑道字段', async () => {
    const chuteCode = `TEST_CHUTE_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      wave_id: waveId,
      chute_code: chuteCode,
      target_type: 'ORDER',
      capacity: 50,
      current_qty: 0,
      status: 'active',
    });
    createdChuteIds.push(created.id);

    const updated = await repo.update(created.id, { capacity: 80 });
    expect(updated.capacity).toBe(80);
    expect(updated.chute_code).toBe(chuteCode);
  });

  test('delete：删除滑道', async () => {
    const chuteCode = `TEST_DELETE_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      wave_id: waveId,
      chute_code: chuteCode,
      target_type: 'ORDER',
      capacity: 50,
      current_qty: 0,
      status: 'active',
    });

    await repo.delete(created.id);

    const found = await repo.findById(created.id);
    expect(found).toBeNull();
  });

  test('createBatch：批量创建滑道（波次初始化）', async () => {
    const codes = Array.from({ length: 3 }, () => `TEST_BATCH_${randomUUID().slice(0, 8)}`);
    const inserts: SortingChuteInsert[] = codes.map((code, i) => ({
      tenant_id: tenantId,
      wave_id: waveId,
      chute_code: code,
      target_type: 'ORDER',
      capacity: 100,
      current_qty: 0,
      status: 'active',
      sort_sequence: i + 10,
    }));

    const created = await repo.createBatch(inserts);
    created.forEach((c) => createdChuteIds.push(c.id));

    expect(created).toHaveLength(3);
    const returnedCodes = created.map((c) => c.chute_code).sort();
    expect(returnedCodes).toEqual(codes.sort());
  });

  test('findByWave：按波次查找滑道，按 sort_sequence 升序排列', async () => {
    const results = await repo.findByWave(waveId);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.wave_id).toBe(waveId);
    }
    const sequences = results.map((r) => r.sort_sequence ?? 0);
    const sorted = [...sequences].sort((a, b) => a - b);
    expect(sequences).toEqual(sorted);
  });

  test('findByTarget：按目标 ID + 类型查找滑道', async () => {
    const targetId = randomUUID();
    const chuteCode = `TEST_TARGET_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      wave_id: waveId,
      chute_code: chuteCode,
      target_type: 'LOCATION',
      target_id: targetId,
      capacity: 50,
      current_qty: 0,
      status: 'active',
    });
    createdChuteIds.push(created.id);

    const found = await repo.findByTarget(targetId, 'LOCATION');
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(created.id);

    const notFound = await repo.findByTarget(randomUUID(), 'LOCATION');
    expect(notFound).toHaveLength(0);
  });

  test('findAvailable：只返回 active 且 capacity > 0 的滑道，支持 waveId/targetType/minCapacity 过滤', async () => {
    const fullChuteCode = `TEST_FULL_${randomUUID().slice(0, 8)}`;
    const fullChute = await repo.create({
      tenant_id: tenantId,
      wave_id: waveId,
      chute_code: fullChuteCode,
      target_type: 'ORDER',
      capacity: 0,
      current_qty: 0,
      status: 'active',
    });
    createdChuteIds.push(fullChute.id);

    const inactiveChuteCode = `TEST_INACTIVE_${randomUUID().slice(0, 8)}`;
    const inactiveChute = await repo.create({
      tenant_id: tenantId,
      wave_id: waveId,
      chute_code: inactiveChuteCode,
      target_type: 'ORDER',
      capacity: 100,
      current_qty: 0,
      status: 'inactive',
    });
    createdChuteIds.push(inactiveChute.id);

    const available = await repo.findAvailable(tenantId, waveId);
    const availableIds = available.map((c) => c.id);
    expect(availableIds).not.toContain(fullChute.id);
    expect(availableIds).not.toContain(inactiveChute.id);
    for (const c of available) {
      expect(c.status).toBe('active');
      expect(c.capacity).toBeGreaterThan(0);
    }

    const highCapacityChuteCode = `TEST_HIGHCAP_${randomUUID().slice(0, 8)}`;
    const highCapacityChute = await repo.create({
      tenant_id: tenantId,
      wave_id: waveId,
      chute_code: highCapacityChuteCode,
      target_type: 'PALLET',
      capacity: 200,
      current_qty: 0,
      status: 'active',
    });
    createdChuteIds.push(highCapacityChute.id);

    const filteredByType = await repo.findAvailable(tenantId, waveId, { targetType: 'PALLET' });
    expect(filteredByType.every((c) => c.target_type === 'PALLET')).toBe(true);
    expect(filteredByType.map((c) => c.id)).toContain(highCapacityChute.id);

    const filteredByMinCapacity = await repo.findAvailable(tenantId, waveId, { minCapacity: 150 });
    expect(filteredByMinCapacity.every((c) => (c.capacity ?? 0) >= 150)).toBe(true);
    expect(filteredByMinCapacity.map((c) => c.id)).toContain(highCapacityChute.id);
  });

  test('updateCurrentQty：更新滑道当前数量', async () => {
    const chuteCode = `TEST_QTY_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      wave_id: waveId,
      chute_code: chuteCode,
      target_type: 'ORDER',
      capacity: 50,
      current_qty: 0,
      status: 'active',
    });
    createdChuteIds.push(created.id);

    const updated = await repo.updateCurrentQty(created.id, 25);
    expect(updated.current_qty).toBe(25);
  });

  test('updateStatus：更新滑道状态', async () => {
    const chuteCode = `TEST_STATUS_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      wave_id: waveId,
      chute_code: chuteCode,
      target_type: 'ORDER',
      capacity: 50,
      current_qty: 0,
      status: 'active',
    });
    createdChuteIds.push(created.id);

    const updated = await repo.updateStatus(created.id, 'full');
    expect(updated.status).toBe('full');
  });

  test('getUtilizationStats：计算利用率百分比', async () => {
    const chuteCode = `TEST_UTIL_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      wave_id: waveId,
      chute_code: chuteCode,
      target_type: 'ORDER',
      capacity: 40,
      current_qty: 10,
      status: 'active',
    });
    createdChuteIds.push(created.id);

    const stats = await repo.getUtilizationStats(tenantId, waveId);
    const stat = stats.find((s) => s.chuteId === created.id);
    expect(stat).toBeDefined();
    expect(stat!.chuteCode).toBe(chuteCode);
    expect(stat!.capacity).toBe(40);
    expect(stat!.currentQty).toBe(10);
    expect(stat!.utilizationPct).toBe(25);
  });

  test('并发更新 updateCurrentQty：最后写入生效，无异常抛出（无乐观锁，验证当前行为而非声称安全）', async () => {
    const chuteCode = `TEST_CONC_QTY_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      wave_id: waveId,
      chute_code: chuteCode,
      target_type: 'ORDER',
      capacity: 100,
      current_qty: 0,
      status: 'active',
    });
    createdChuteIds.push(created.id);

    const targetValues = [10, 20, 30, 40, 50];
    const results = await Promise.all(
      targetValues.map((v) => repo.updateCurrentQty(created.id, v))
    );

    expect(results).toHaveLength(targetValues.length);

    const final = await repo.findById(created.id);
    expect(final).not.toBeNull();
    // updateCurrentQty 是无条件覆盖写（非增量），因此并发结果是"某一次写入生效"，
    // 而不是任何形式的求和；这里验证最终值落在提交的候选值集合内，
    // 证明没有出现数据损坏（如 null / NaN / 未定义之外的值）。
    expect(targetValues).toContain(final!.current_qty);
  });

  test('并发 createBatch：不同编码并发批量创建不冲突', async () => {
    const batchA = Array.from({ length: 2 }, () => `TEST_PBATCH_A_${randomUUID().slice(0, 8)}`);
    const batchB = Array.from({ length: 2 }, () => `TEST_PBATCH_B_${randomUUID().slice(0, 8)}`);

    const toInsert = (codes: string[]): SortingChuteInsert[] =>
      codes.map((code) => ({
        tenant_id: tenantId,
        wave_id: waveId,
        chute_code: code,
        target_type: 'ORDER',
        capacity: 100,
        current_qty: 0,
        status: 'active',
      }));

    const [resultA, resultB] = await Promise.all([
      repo.createBatch(toInsert(batchA)),
      repo.createBatch(toInsert(batchB)),
    ]);

    [...resultA, ...resultB].forEach((c) => createdChuteIds.push(c.id));

    expect(resultA).toHaveLength(2);
    expect(resultB).toHaveLength(2);
    const allCodes = [...resultA, ...resultB].map((c) => c.chute_code).sort();
    expect(allCodes).toEqual([...batchA, ...batchB].sort());
  });
});
