/**
 * ECC 治理 Phase 5/6/7 测试补齐（docs/03-database/REPOSITORY_ROADMAP.md P2 第 2 项）：
 * `SupabaseTenantTrackingPolicyRepository` / `fn_requires_unique_tracking` /
 * `fn_get_tenant_abc_tracking_default` 正确性验证。
 *
 * === 可达性核查（测试方法论第 6 步）===
 * 全仓库搜索确认 `tenantTrackingPolicies`（DI 注册名）在 `device-api`/`admin-api`
 * 均无任何调用方。真实的追踪策略判定走 SQL 层 `fn_apply_putaway_action` 等函数内部
 * 直接调用 `fn_requires_unique_tracking`，不经过本仓储——与 P0 第 3 项
 * PackingTaskItemRepository 同类，仍按既定优先级补齐测试。
 *
 * === 与 P0 第 3 项 / P2 第 1 项不同：本项未发现需要修复的真实缺陷 ===
 * `upsertBatch` 用的 PostgREST `.upsert(data, { onConflict: 'tenant_id,abc_class' })`
 * 这次是正确的——`tenant_tracking_policies` 表上有真实的**非分区**唯一约束
 * `tenant_tracking_policies_tenant_id_abc_class_key UNIQUE (tenant_id, abc_class)`
 * （已用 `psql \d tenant_tracking_policies` 核实，`abc_class` 是 `NOT NULL`，不是
 * P2 第 1 项那种"全局默认+租户覆盖"的可空覆盖字段模式），已用 curl 直连本地 PostgREST
 * 端点实测确认 upsert 正常工作，不是理论推测。本文件纯粹是测试补齐，不含代码修复。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset   # 依次应用 001→004 迁移脚本
 *
 * 默认跳过（避免无本地 Supabase 环境时拖垮 `npm run test`/CI）：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- fn_requires_unique_tracking
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseRpcClient } from '../../../adapters/supabase/rpc/SupabaseRpcClient';
import { SupabaseTenantTrackingPolicyRepository } from '../../../adapters/supabase/repositories/SupabaseTenantTrackingPolicyRepository';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// `supabase start` 本地默认 service_role key（非生产密钥，仅用于本地一次性沙盒实例）。
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('SupabaseTenantTrackingPolicyRepository 追踪策略正确性（Phase 5/6/7 P2 第 2 项）', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let repo: SupabaseTenantTrackingPolicyRepository;
  let tenantId: string;

  const createTenant = async (name: string): Promise<string> => {
    const { data, error } = await client.from('tenants').insert({ name }).select().single();
    if (error) throw error;
    return data.id;
  };

  const createProduct = async (abcClass: 'A' | 'B' | 'C' | null): Promise<string> => {
    const { data, error } = await client
      .from('products')
      .insert({ tenant_id: tenantId, sku: `p2-2-sku-${Date.now()}-${Math.random()}`, name: 'P2-2 测试商品', abc_class: abcClass })
      .select()
      .single();
    if (error) throw error;
    return data.id;
  };

  const createLocation = async (forceUniqueTracking: boolean): Promise<string> => {
    const { data, error } = await client
      .from('locations')
      .insert({ tenant_id: tenantId, code: `p2-2-loc-${Date.now()}-${Math.random()}`, is_active: true, force_unique_tracking: forceUniqueTracking })
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
    repo = new SupabaseTenantTrackingPolicyRepository(wms, new SupabaseRpcClient(wms));

    tenantId = await createTenant(`ecc-p2-2-tenant-${Date.now()}`);
  });

  afterAll(async () => {
    if (tenantId) await client.from('tenants').delete().eq('id', tenantId);
  });

  test('upsertBatch 应正确创建多条 ABC 分类策略（回归防护：与 P2 第 1 项不同，onConflict 对本表的非分区唯一约束应正常工作）', async () => {
    const results = await repo.upsertBatch([
      { tenant_id: tenantId, abc_class: 'A', requires_unique_tracking: true },
      { tenant_id: tenantId, abc_class: 'B', requires_unique_tracking: false },
      { tenant_id: tenantId, abc_class: 'C', requires_unique_tracking: false },
    ]);

    expect(results).toHaveLength(3);
    const rows = await repo.findByTenant(tenantId);
    expect(rows).toHaveLength(3);
  });

  test('upsertBatch 对同一 tenant_id + abc_class 二次调用应更新而不是产生第二行', async () => {
    await repo.upsertBatch([{ tenant_id: tenantId, abc_class: 'A', requires_unique_tracking: true }]);
    await repo.upsertBatch([{ tenant_id: tenantId, abc_class: 'A', requires_unique_tracking: false }]);

    const policy = await repo.findByTenantAndClass(tenantId, 'A');
    expect(policy?.requires_unique_tracking).toBe(false);

    const rows = await repo.findByTenant(tenantId);
    expect(rows.filter((r) => r.abc_class === 'A')).toHaveLength(1);
  });

  test('getDefaultTracking 已配置时应返回配置值，未配置时按 A→true/C→false/B→true(保守兜底) 返回', async () => {
    const otherTenantId = await createTenant(`ecc-p2-2-default-${Date.now()}`);
    const otherRepo = new SupabaseTenantTrackingPolicyRepository(WmsSupabaseClient.getInstance(), new SupabaseRpcClient(WmsSupabaseClient.getInstance()));

    // 未配置任何策略时的兜底行为
    expect(await otherRepo.getDefaultTracking(otherTenantId, 'A')).toBe(true);
    expect(await otherRepo.getDefaultTracking(otherTenantId, 'C')).toBe(false);
    expect(await otherRepo.getDefaultTracking(otherTenantId, 'B')).toBe(true);

    // 显式配置后应覆盖兜底值
    await otherRepo.upsertBatch([{ tenant_id: otherTenantId, abc_class: 'A', requires_unique_tracking: false }]);
    expect(await otherRepo.getDefaultTracking(otherTenantId, 'A')).toBe(false);

    await client.from('tenants').delete().eq('id', otherTenantId);
  });

  test('requiresUniqueTracking 优先级：商品级覆盖 > 租户 ABC 默认，且库位强制追踪可把结果从 false 升级为 true（但不能反向覆盖为 false）', async () => {
    await repo.upsertBatch([{ tenant_id: tenantId, abc_class: 'B', requires_unique_tracking: false }]);

    const productNoOverride = await createProduct('B');
    const locationNoForce = await createLocation(false);
    const locationForce = await createLocation(true);

    // 无商品覆盖、无库位强制：落到租户 B 类默认 false
    expect(await repo.requiresUniqueTracking(tenantId, productNoOverride, locationNoForce)).toBe(false);

    // 库位强制追踪：即使租户默认是 false，也应升级为 true
    expect(await repo.requiresUniqueTracking(tenantId, productNoOverride, locationForce)).toBe(true);

    // 商品级覆盖（product_constraints.requires_unique_tracking = true）应优先于租户默认
    const productWithOverride = await createProduct('B');
    const { error: constraintErr } = await client
      .from('product_constraints')
      .insert({ product_id: productWithOverride, requires_unique_tracking: true });
    if (constraintErr) throw constraintErr;

    expect(await repo.requiresUniqueTracking(tenantId, productWithOverride, locationNoForce)).toBe(true);
  });

  test('findByTenant / findByTenantAndClass 按维度正确过滤，findByTenantAndClass 查不到时返回 null', async () => {
    const otherTenantId = await createTenant(`ecc-p2-2-find-${Date.now()}`);
    const otherRepo = new SupabaseTenantTrackingPolicyRepository(WmsSupabaseClient.getInstance(), new SupabaseRpcClient(WmsSupabaseClient.getInstance()));

    await otherRepo.upsertBatch([{ tenant_id: otherTenantId, abc_class: 'A', requires_unique_tracking: true }]);

    const found = await otherRepo.findByTenantAndClass(otherTenantId, 'A');
    expect(found?.abc_class).toBe('A');

    const notFound = await otherRepo.findByTenantAndClass(otherTenantId, 'C');
    expect(notFound).toBeNull();

    await client.from('tenants').delete().eq('id', otherTenantId);
  });

  test('deletePolicy 应删除指定策略且不影响其他租户的同名分类策略', async () => {
    const otherTenantId = await createTenant(`ecc-p2-2-delete-${Date.now()}`);
    const otherRepo = new SupabaseTenantTrackingPolicyRepository(WmsSupabaseClient.getInstance(), new SupabaseRpcClient(WmsSupabaseClient.getInstance()));

    const [created] = await otherRepo.upsertBatch([{ tenant_id: otherTenantId, abc_class: 'A', requires_unique_tracking: true }]);
    await otherRepo.deletePolicy(created.id, otherTenantId);

    const found = await otherRepo.findByTenantAndClass(otherTenantId, 'A');
    expect(found).toBeNull();

    await client.from('tenants').delete().eq('id', otherTenantId);
  });
});
