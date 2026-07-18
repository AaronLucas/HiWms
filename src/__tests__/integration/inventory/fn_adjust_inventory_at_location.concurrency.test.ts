/**
 * ECC 治理试点（docs/06-agents/AGENTS.md §8.4）：原子库存并发写入正确性验证。
 *
 * 覆盖缺口：`fn_adjust_inventory_at_location`（supabase/migrations/003_extend_sync_event_actions.sql）
 * 是本项目上一轮生产返工的 bug 类型（并发丢单）在当前部署版本中的修正实现，但从未被
 * 自动化测试验证过。本测试针对同一 (location_id, product_id, batch_no) 发起真实并发请求，
 * 断言最终库存等于串行执行的预期值（不发生 lost update）。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset   # 依次应用 001→004 迁移脚本
 *
 * 默认跳过（避免无本地 Supabase 环境时拖垮 `npm run test`/CI）：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- fn_adjust_inventory_at_location
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// `supabase start` 本地默认 service_role key（非生产密钥，仅用于本地一次性沙盒实例）。
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('fn_adjust_inventory_at_location 并发写入正确性（ECC 治理试点）', () => {
  let client: SupabaseClient;
  let tenantId: string;
  let productId: string;
  let locationId: string;
  const batchNo = 'ECC-PILOT-BATCH-01';

  beforeAll(async () => {
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: tenant, error: tenantErr } = await client
      .from('tenants')
      .insert({ name: `ecc-pilot-tenant-${Date.now()}` })
      .select()
      .single();
    if (tenantErr) throw tenantErr;
    tenantId = tenant.id;

    const { data: product, error: productErr } = await client
      .from('products')
      .insert({ tenant_id: tenantId, sku: `ECC-PILOT-SKU-${Date.now()}`, name: 'ECC Pilot Product' })
      .select()
      .single();
    if (productErr) throw productErr;
    productId = product.id;

    const { data: location, error: locationErr } = await client
      .from('locations')
      .insert({ tenant_id: tenantId, code: `ECC-PILOT-LOC-${Date.now()}` })
      .select()
      .single();
    if (locationErr) throw locationErr;
    locationId = location.id;
  });

  afterAll(async () => {
    // tenants 上的外键均为 ON DELETE CASCADE，删除租户即可级联清理 product/location/inventory。
    if (tenantId) await client.from('tenants').delete().eq('id', tenantId);
  });

  test('对已存在库存行的同一 (location, product, batch) 并发发起 5 个加/减请求时，最终库存等于串行执行的预期值', async () => {
    // Arrange：先串行建立一行基线库存，确保后续并发请求全部走"已有行"分支（SELECT ... FOR UPDATE 加锁路径），
    // 而不是"首次插入"分支——这正是历史返工 bug 命中的路径（读-改-写丢失更新）。
    const baseline = 100;
    const { error: seedErr } = await client.rpc('fn_adjust_inventory_at_location', {
      p_tenant_id: tenantId,
      p_product_id: productId,
      p_location_id: locationId,
      p_delta: baseline,
      p_batch_no: batchNo,
    });
    expect(seedErr).toBeNull();

    const deltas = [50, -20, 30, -10, 15]; // 混合加减，模拟真实入库/出库并发
    const expectedFinal = baseline + deltas.reduce((sum, d) => sum + d, 0);

    // Act：5 个请求真正并发发起（Promise.all，非串行伪并发）
    const results = await Promise.all(
      deltas.map((delta) =>
        client.rpc('fn_adjust_inventory_at_location', {
          p_tenant_id: tenantId,
          p_product_id: productId,
          p_location_id: locationId,
          p_delta: delta,
          p_batch_no: batchNo,
        })
      )
    );

    // Assert
    for (const result of results) {
      expect(result.error).toBeNull();
    }

    const { data: rows, error: readErr } = await client
      .from('inventory')
      .select('quantity')
      .eq('product_id', productId)
      .eq('location_id', locationId)
      .eq('batch_no', batchNo);
    expect(readErr).toBeNull();
    expect(rows).toHaveLength(1); // 全程只应有一行库存记录，不应因并发产生重复行
    expect(Number(rows![0].quantity)).toBe(expectedFinal);
  });
});
