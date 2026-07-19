/**
 * ECC 治理 Phase 5/6/7 测试补齐（docs/03-database/REPOSITORY_ROADMAP.md P2 第 1 项）：
 * `SupabaseInventoryCountPolicyRepository` / `fn_get_count_tolerance` 正确性验证。
 *
 * === 可达性核查（测试方法论第 6 步）===
 * 全仓库搜索确认 `inventoryCountPolicies`（该仓储 DI 注册名）在 `device-api`/`admin-api`
 * 均无任何调用方。真实的盘点动作走 `fn_apply_count_action`（SQL 层），该函数直接在
 * SQL 内部调用 `fn_get_count_tolerance`，不经过本仓储。与 P0 第 3 项
 * PackingTaskItemRepository 同类，本文件测试的是一条当前系统里尚未被任何真实入口
 * 调用的应用层代码路径，仍按既定优先级补齐测试。
 *
 * === 发现并修复的真实缺陷（纯 TS 应用层代码，未触碰任何 .sql 文件）===
 * `upsertBatch`/`upsertPolicy` 原实现用 PostgREST 的
 * `.upsert(data, { onConflict: 'tenant_id,product_id' })`。但 `inventory_count_policies`
 * 表上只有两条局部唯一索引（`uq_count_policy_tenant_default (tenant_id) WHERE
 * product_id IS NULL` / `uq_count_policy_tenant_product (tenant_id, product_id)
 * WHERE product_id IS NOT NULL`，已用 `psql \d inventory_count_policies` 核实），
 * 没有覆盖 `(tenant_id, product_id)` 的普通唯一约束——这正是 `CONVENTIONS.md` §5.4.8
 * "全局默认 + 租户覆盖"字段设计约定要求的模式（不把可空覆盖字段放进主键/单一唯一约束）。
 * PostgREST 的 `on_conflict` 参数只能匹配非分区唯一索引，对分区索引必定报
 * `42P10 there is no unique or exclusion constraint matching the ON CONFLICT
 * specification`——已直接对本地 PostgREST 端点发 curl 请求实测复现，不是理论推测。
 * 也就是说原实现的 `upsertBatch`/`upsertPolicy` **每次调用都会失败**，不是并发边界
 * 情况。修复：改为查找后写入（product_id 为 NULL 时按 IS NULL 匹配，否则按等值匹配）
 * + 乐观并发重试，与 P0 第 3 项 PackingTaskItemRepository 的 `insertBatch` 同一类
 * 根因（PostgREST upsert 与真实分区唯一索引设计不兼容）、同一种修法。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset   # 依次应用 001→004 迁移脚本
 *
 * 默认跳过（避免无本地 Supabase 环境时拖垮 `npm run test`/CI）：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- fn_get_count_tolerance
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseRpcClient } from '../../../adapters/supabase/rpc/SupabaseRpcClient';
import { SupabaseInventoryCountPolicyRepository } from '../../../adapters/supabase/repositories/SupabaseInventoryCountPolicyRepository';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// `supabase start` 本地默认 service_role key（非生产密钥，仅用于本地一次性沙盒实例）。
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('SupabaseInventoryCountPolicyRepository 盘点容差策略正确性（Phase 5/6/7 P2 第 1 项）', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let repo: SupabaseInventoryCountPolicyRepository;
  let tenantId: string;

  const createTenant = async (name: string): Promise<string> => {
    const { data, error } = await client.from('tenants').insert({ name }).select().single();
    if (error) throw error;
    return data.id;
  };

  const createProduct = async (): Promise<string> => {
    const { data, error } = await client
      .from('products')
      .insert({ tenant_id: tenantId, sku: `p2-1-sku-${Date.now()}-${Math.random()}`, name: 'P2-1 测试商品' })
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
    repo = new SupabaseInventoryCountPolicyRepository(wms, new SupabaseRpcClient(wms));

    const { data: tenant, error: tenantErr } = await client
      .from('tenants')
      .insert({ name: `ecc-p2-1-tenant-${Date.now()}` })
      .select()
      .single();
    if (tenantErr) throw tenantErr;
    tenantId = tenant.id;
  });

  afterAll(async () => {
    if (tenantId) await client.from('tenants').delete().eq('id', tenantId);
  });

  test('upsertPolicy 首次调用应创建新行（回归防护：原实现的 onConflict 对分区唯一索引必报 42P10）', async () => {
    const productId = await createProduct();

    const created = await repo.upsertPolicy({ tenant_id: tenantId, product_id: productId, tolerance_qty: 5 });

    expect(created.tenant_id).toBe(tenantId);
    expect(created.product_id).toBe(productId);
    expect(Number(created.tolerance_qty)).toBe(5);
  });

  test('upsertPolicy 对同一 tenant_id + product_id 二次调用应更新而不是报错或产生第二行', async () => {
    const productId = await createProduct();

    await repo.upsertPolicy({ tenant_id: tenantId, product_id: productId, tolerance_qty: 3 });
    const updated = await repo.upsertPolicy({ tenant_id: tenantId, product_id: productId, tolerance_qty: 8 });

    expect(Number(updated.tolerance_qty)).toBe(8);
    const rows = await repo.findByProduct(tenantId, productId);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].tolerance_qty)).toBe(8);
  });

  test('upsertPolicy 对 product_id 为 NULL（租户默认容差）二次调用应更新而不是产生第二行', async () => {
    await repo.upsertPolicy({ tenant_id: tenantId, product_id: null, tolerance_qty: 1 });
    await repo.upsertPolicy({ tenant_id: tenantId, product_id: null, tolerance_qty: 2 });

    const defaultTolerance = await repo.getDefaultTolerance(tenantId);
    expect(defaultTolerance).toBe(2);

    const rows = await repo.findByTenant(tenantId);
    const nullRows = rows.filter((r) => r.product_id === null);
    expect(nullRows).toHaveLength(1);
  });

  test('upsertBatch 应正确处理多条记录（含 product 覆盖与租户默认混合）', async () => {
    const productA = await createProduct();
    const productB = await createProduct();

    const results = await repo.upsertBatch([
      { tenant_id: tenantId, product_id: productA, tolerance_qty: 4 },
      { tenant_id: tenantId, product_id: productB, tolerance_qty: 6 },
      { tenant_id: tenantId, product_id: null, tolerance_qty: 1.5 },
    ]);

    expect(results).toHaveLength(3);
    expect(await repo.getCountTolerance(tenantId, productA)).toBe(4);
    expect(await repo.getCountTolerance(tenantId, productB)).toBe(6);
  });

  test('getCountTolerance 应优先返回商品级覆盖，未配置商品级时回退租户默认，都未配置时回退 0（安全默认值）', async () => {
    const productWithOverride = await createProduct();
    const productWithoutOverride = await createProduct();

    await repo.upsertPolicy({ tenant_id: tenantId, product_id: null, tolerance_qty: 2 });
    await repo.upsertPolicy({ tenant_id: tenantId, product_id: productWithOverride, tolerance_qty: 9 });

    expect(await repo.getCountTolerance(tenantId, productWithOverride)).toBe(9);
    expect(await repo.getCountTolerance(tenantId, productWithoutOverride)).toBe(2);

    const otherTenantId = await createTenant(`ecc-p2-1-notol-${Date.now()}`);
    expect(await repo.getCountTolerance(otherTenantId, productWithOverride)).toBe(0);
    await client.from('tenants').delete().eq('id', otherTenantId);
  });

  test('findByTenant / findByProduct 按维度正确过滤', async () => {
    const otherTenantId = await createTenant(`ecc-p2-1-find-${Date.now()}`);
    const wms = WmsSupabaseClient.getInstance();
    const otherRepo = new SupabaseInventoryCountPolicyRepository(wms, new SupabaseRpcClient(wms));

    const { data: product, error: productErr } = await client
      .from('products')
      .insert({ tenant_id: otherTenantId, sku: `p2-1-find-sku-${Date.now()}`, name: 'find test' })
      .select()
      .single();
    if (productErr) throw productErr;

    await otherRepo.upsertPolicy({ tenant_id: otherTenantId, product_id: product.id, tolerance_qty: 7 });
    await otherRepo.upsertPolicy({ tenant_id: otherTenantId, product_id: null, tolerance_qty: 3 });

    const byTenant = await otherRepo.findByTenant(otherTenantId);
    expect(byTenant).toHaveLength(2);

    const byProduct = await otherRepo.findByProduct(otherTenantId, product.id);
    expect(byProduct).toHaveLength(1);
    expect(Number(byProduct[0].tolerance_qty)).toBe(7);

    await client.from('tenants').delete().eq('id', otherTenantId);
  });

  test('并发对同一 tenant_id + product_id 发起 5 次 upsertPolicy，最终应恰好 1 行，值为最后写入者，且无请求崩溃', async () => {
    const productId = await createProduct();

    const settled = await Promise.allSettled(
      [1, 2, 3, 4, 5].map((qty) => repo.upsertPolicy({ tenant_id: tenantId, product_id: productId, tolerance_qty: qty }))
    );

    const rejected = settled.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(0);

    const rows = await repo.findByProduct(tenantId, productId);
    expect(rows).toHaveLength(1);
    expect([1, 2, 3, 4, 5]).toContain(Number(rows[0].tolerance_qty));
  });
});
