/**
 * Sprint 0 集成测试：SupabaseProductRepository 正确性验证
 *
 * 覆盖 IProductRepository 全部方法：CRUD + findBySku / findByTenant / search / skuExists，
 * 以及具体类比端口接口多出的 findWithConstraints / updateAbcClass。
 * 直接实例化仓储类，验证"已实现未验证"的仓储代码路径本身。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start && supabase db reset
 *
 * 默认跳过：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- SupabaseProductRepository
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'crypto';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseProductRepository } from '../../../adapters/supabase/repositories/SupabaseProductRepository';
import type { ProductInsert } from '../../../core/ports/db/IProductRepository';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('SupabaseProductRepository 产品 CRUD 正确性（Sprint 0）', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let repo: SupabaseProductRepository;
  let tenantId: string;
  const createdProductIds: string[] = [];

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    const wms = WmsSupabaseClient.getInstance({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    client = wms.getClient();
    repo = new SupabaseProductRepository(wms);

    const { data: tenant } = await client
      .from('tenants')
      .insert({ name: `sprint0-product-tenant-${Date.now()}` })
      .select()
      .single();
    if (!tenant) throw new Error('创建测试租户失败');
    tenantId = tenant.id;
  });

  afterAll(async () => {
    for (const id of createdProductIds) {
      await client.from('product_constraints').delete().eq('product_id', id);
      await client.from('products').delete().eq('id', id);
    }
    await client.from('tenants').delete().eq('id', tenantId);
  });

  test('create：创建新产品并返回完整行', async () => {
    const sku = `TEST_SKU_${randomUUID().slice(0, 8)}`;
    const product: ProductInsert = {
      tenant_id: tenantId,
      sku,
      name: '测试产品 A',
      abc_class: 'A',
    };

    const created = await repo.create(product);
    createdProductIds.push(created.id);

    expect(created.id).toBeTruthy();
    expect(created.sku).toBe(sku);
    expect(created.name).toBe('测试产品 A');
    expect(created.tenant_id).toBe(tenantId);
  });

  test('findById：按 ID 查找产品', async () => {
    const sku = `TEST_SKU_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      sku,
      name: '测试产品 B',
    });
    createdProductIds.push(created.id);

    const found = await repo.findById(created.id);
    expect(found).not.toBeNull();
    expect(found!.sku).toBe(sku);
  });

  test('findBySku：按 SKU 查找产品', async () => {
    const sku = `TEST_SKU_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      sku,
      name: '测试产品 C',
    });
    createdProductIds.push(created.id);

    const found = await repo.findBySku(sku);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);

    const notFound = await repo.findBySku('NONEXISTENT_SKU_XXXXX');
    expect(notFound).toBeNull();
  });

  test('findByTenant：按租户查找所有产品', async () => {
    const all = await repo.findByTenant(tenantId);
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) {
      expect(p.tenant_id).toBe(tenantId);
    }
  });

  test('findByTenant：支持 abcClass 过滤', async () => {
    const sku = `TEST_SKU_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      sku,
      name: '测试产品 ABC 过滤',
      abc_class: 'B',
    });
    createdProductIds.push(created.id);

    const filtered = await repo.findByTenant(tenantId, { abcClass: 'B' });
    for (const p of filtered) {
      expect(p.abc_class).toBe('B');
    }
    const found = filtered.find((p) => p.id === created.id);
    expect(found).toBeDefined();
  });

  test('search：按名称/SKU 模糊匹配产品', async () => {
    const uniqueToken = randomUUID().slice(0, 8);
    const sku = `TEST_SEARCH_${uniqueToken}`;
    const created = await repo.create({
      tenant_id: tenantId,
      sku,
      name: `可搜索产品_${uniqueToken}`,
    });
    createdProductIds.push(created.id);

    const bySkuResults = await repo.search(uniqueToken, tenantId);
    expect(bySkuResults.some((p) => p.id === created.id)).toBe(true);

    const byNameResults = await repo.search(`可搜索产品_${uniqueToken}`, tenantId);
    expect(byNameResults.some((p) => p.id === created.id)).toBe(true);

    const noResults = await repo.search('NO_SUCH_QUERY_ZZZZZ', tenantId);
    expect(noResults.some((p) => p.id === created.id)).toBe(false);
  });

  test('skuExists：检查 SKU 是否存在', async () => {
    const sku = `TEST_SKU_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      sku,
      name: '测试产品 D',
    });
    createdProductIds.push(created.id);

    const exists = await repo.skuExists(sku);
    expect(exists).toBe(true);

    const existsWithTenant = await repo.skuExists(sku, tenantId);
    expect(existsWithTenant).toBe(true);

    const notExists = await repo.skuExists('NONEXISTENT_SKU_YYYYY');
    expect(notExists).toBe(false);
  });

  test('update：更新产品字段', async () => {
    const sku = `TEST_SKU_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      sku,
      name: '测试产品 E',
      abc_class: 'C',
    });
    createdProductIds.push(created.id);

    const updated = await repo.update(created.id, {
      name: '测试产品 E（已更新）',
      abc_class: 'A',
    });

    expect(updated.name).toBe('测试产品 E（已更新）');
    expect(updated.abc_class).toBe('A');
    expect(updated.sku).toBe(sku);
  });

  test('updateAbcClass：单独更新 ABC 分类', async () => {
    const sku = `TEST_SKU_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      sku,
      name: '测试产品 F',
      abc_class: 'C',
    });
    createdProductIds.push(created.id);

    const updated = await repo.updateAbcClass(created.id, 'A');
    expect(updated.abc_class).toBe('A');
    expect(updated.id).toBe(created.id);
  });

  test('findWithConstraints：无约束时返回 constraints: null', async () => {
    const sku = `TEST_SKU_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      sku,
      name: '测试产品 G（无约束）',
    });
    createdProductIds.push(created.id);

    const result = await repo.findWithConstraints(created.id);
    expect(result).not.toBeNull();
    expect(result!.product.id).toBe(created.id);
    expect(result!.constraints).toBeNull();
  });

  test('findWithConstraints：有约束时返回约束行', async () => {
    const sku = `TEST_SKU_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      sku,
      name: '测试产品 H（有约束）',
    });
    createdProductIds.push(created.id);

    await client.from('product_constraints').insert({
      product_id: created.id,
      is_dangerous: true,
      required_zone_type: 'COLD',
    });

    const result = await repo.findWithConstraints(created.id);
    expect(result).not.toBeNull();
    expect(result!.product.id).toBe(created.id);
    expect(result!.constraints).not.toBeNull();
    expect(result!.constraints!.is_dangerous).toBe(true);
    expect(result!.constraints!.required_zone_type).toBe('COLD');
  });

  test('findWithConstraints：产品不存在时返回 null', async () => {
    const result = await repo.findWithConstraints(randomUUID());
    expect(result).toBeNull();
  });

  test('delete：删除产品', async () => {
    const sku = `TEST_DELETE_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      sku,
      name: '测试产品 I（待删除）',
    });

    await repo.delete(created.id);

    const found = await repo.findById(created.id);
    expect(found).toBeNull();
  });

  test('并发创建：不同 SKU 并发创建不冲突', async () => {
    const skus = Array.from({ length: 3 }, () => `TEST_CONC_${randomUUID().slice(0, 8)}`);

    const results = await Promise.all(
      skus.map((sku) =>
        repo.create({
          tenant_id: tenantId,
          sku,
          name: `并发测试产品_${sku}`,
        })
      )
    );

    results.forEach((r) => createdProductIds.push(r.id));

    expect(results).toHaveLength(3);
    const returnedSkus = results.map((r) => r.sku).sort();
    expect(returnedSkus).toEqual(skus.sort());
  });
});
