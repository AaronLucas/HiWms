/**
 * Phase 8 集成测试：SupabaseInventoryUnitRepository 正确性验证
 *
 * 覆盖 IInventoryUnitRepository 全部只读方法：
 * findBySerial / findByLocation / findByStatus / findByOrderLine / serialLookup。
 *
 * 注：inventory_units 的写入由 SQL 函数在事务内原子完成，
 * TS 层不直接 INSERT/UPDATE。种子数据中无序列化商品时查询返回空结果是合法路径。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start && supabase db reset
 *
 * 默认跳过：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- SupabaseInventoryUnit
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseInventoryUnitRepository } from '../../../adapters/supabase/repositories/SupabaseInventoryUnitRepository';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('SupabaseInventoryUnitRepository 序列号追踪正确性（Phase 8）', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let repo: SupabaseInventoryUnitRepository;
  let tenantId: string;

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    const wms = WmsSupabaseClient.getInstance({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    client = wms.getClient();
    repo = new SupabaseInventoryUnitRepository(wms);

    const { data: tenant } = await client
      .from('tenants')
      .insert({ name: `phase8-iu-tenant-${Date.now()}` })
      .select()
      .single();
    if (!tenant) throw new Error('创建测试租户失败');
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await client.from('tenants').delete().eq('id', tenantId);
  });

  test('findBySerial：不存在的序列号返回 null', async () => {
    const result = await repo.findBySerial(
      tenantId,
      '00000000-0000-0000-0000-000000000000',
      'NONEXISTENT_SERIAL'
    );
    expect(result).toBeNull();
  });

  test('findByLocation：按库位查找（空结果合法）', async () => {
    const { data: locations } = await client.from('locations').select('id').limit(1);
    if (locations && locations.length > 0) {
      const result = await repo.findByLocation(locations[0].id);
      expect(Array.isArray(result)).toBe(true);
    }
  });

  test('findByStatus：按状态查找', async () => {
    const result = await repo.findByStatus(tenantId, 'IN_STOCK');
    expect(Array.isArray(result)).toBe(true);
  });

  test('findByOrderLine：不存在的订单行返回空数组', async () => {
    const result = await repo.findByOrderLine('00000000-0000-0000-0000-000000000000');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  test('serialLookup：不存在的序列号返回 null（视图 v_serial_lookup）', async () => {
    const result = await repo.serialLookup(tenantId, 'NONEXISTENT_SERIAL');
    expect(result).toBeNull();
  });

  test('并发查询：多方法并发执行不冲突', async () => {
    const results = await Promise.all([
      repo.findBySerial(tenantId, '00000000-0000-0000-0000-000000000000', 'CONC_1'),
      repo.findByStatus(tenantId, 'IN_STOCK'),
      repo.serialLookup(tenantId, 'CONC_2'),
      repo.findByOrderLine('00000000-0000-0000-0000-000000000000'),
    ]);

    expect(results).toHaveLength(4);
    expect(results[0]).toBeNull();
    expect(Array.isArray(results[1])).toBe(true);
    expect(results[2]).toBeNull();
    expect(Array.isArray(results[3])).toBe(true);
  });
});
