/**
 * Sprint 0 集成测试：SupabaseProductConstraintRepository 正确性验证
 *
 * 覆盖 IProductConstraintRepository 全部方法：CRUD + findBySku / findBySkuBatch / findByTenant。
 * 直接实例化仓储类，验证"已实现未验证"的仓储代码路径本身。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start && supabase db reset
 *
 * 默认跳过：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- SupabaseProductConstraintRepository
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'crypto';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseProductConstraintRepository } from '../../../adapters/supabase/repositories/SupabaseProductConstraintRepository';
import type { ProductConstraintInsert } from '../../../core/ports/db/IProductConstraintRepository';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('SupabaseProductConstraintRepository 产品约束 CRUD 正确性（Sprint 0）', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let repo: SupabaseProductConstraintRepository;
  let tenantId: string;
  const createdProductIds: string[] = [];

  /** 建一个测试产品，返回其 id（product_constraints.product_id 外键依赖 products.id） */
  async function createTestProduct(namePrefix: string): Promise<string> {
    const sku = `TEST_PC_SKU_${randomUUID().slice(0, 8)}`;
    const { data: product, error } = await client
      .from('products')
      .insert({ tenant_id: tenantId, sku, name: `${namePrefix}_${sku}` })
      .select()
      .single();
    if (error || !product) throw new Error(`创建测试产品失败: ${error?.message}`);
    createdProductIds.push(product.id);
    return product.id;
  }

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    const wms = WmsSupabaseClient.getInstance({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    client = wms.getClient();
    repo = new SupabaseProductConstraintRepository(wms);

    const { data: tenant } = await client
      .from('tenants')
      .insert({ name: `sprint0-constraint-tenant-${Date.now()}` })
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

  test('create：创建产品约束并返回完整行', async () => {
    const productId = await createTestProduct('约束产品A');
    const constraint: ProductConstraintInsert = {
      product_id: productId,
      is_dangerous: true,
      required_zone_type: 'COLD',
      hs_code: 'HS0001',
    };

    const created = await repo.create(constraint);

    expect(created.product_id).toBe(productId);
    expect(created.is_dangerous).toBe(true);
    expect(created.required_zone_type).toBe('COLD');
  });

  test('findBySku：按 product_id 查找约束', async () => {
    const productId = await createTestProduct('约束产品B');
    await repo.create({
      product_id: productId,
      storage_temp_range: '2-8C',
    });

    const found = await repo.findBySku(productId);
    expect(found).not.toBeNull();
    expect(found!.product_id).toBe(productId);
    expect(found!.storage_temp_range).toBe('2-8C');

    const notFound = await repo.findBySku(randomUUID());
    expect(notFound).toBeNull();
  });

  test('findBySkuBatch：批量按 product_id 查找约束', async () => {
    const productId1 = await createTestProduct('约束产品C1');
    const productId2 = await createTestProduct('约束产品C2');
    const productId3WithoutConstraint = await createTestProduct('约束产品C3无约束');

    await repo.create({ product_id: productId1, is_dangerous: false });
    await repo.create({ product_id: productId2, is_dangerous: true });

    const batch = await repo.findBySkuBatch([productId1, productId2, productId3WithoutConstraint]);

    expect(batch).toHaveLength(2);
    const ids = batch.map((c) => c.product_id).sort();
    expect(ids).toEqual([productId1, productId2].sort());
  });

  test('findByTenant：按租户查找所有约束', async () => {
    const productId = await createTestProduct('约束产品D');
    await repo.create({ product_id: productId, hs_code: 'HS_TENANT_TEST' });

    const all = await repo.findByTenant(tenantId);
    expect(all.some((c) => c.product_id === productId)).toBe(true);
  });

  test('update：更新约束字段', async () => {
    const productId = await createTestProduct('约束产品E');
    await repo.create({ product_id: productId, expiry_threshold_days: 30 });

    const updated = await repo.update(productId, {
      expiry_threshold_days: 90,
      must_scan_sn: true,
    });

    expect(updated.expiry_threshold_days).toBe(90);
    expect(updated.must_scan_sn).toBe(true);
    expect(updated.product_id).toBe(productId);
  });

  test('delete：删除约束', async () => {
    const productId = await createTestProduct('约束产品F');
    await repo.create({ product_id: productId, is_dangerous: true });

    await repo.delete(productId);

    const found = await repo.findBySku(productId);
    expect(found).toBeNull();
  });

  test('并发创建：不同产品并发创建约束不冲突', async () => {
    const productIds = await Promise.all([
      createTestProduct('并发约束G1'),
      createTestProduct('并发约束G2'),
      createTestProduct('并发约束G3'),
    ]);

    const results = await Promise.all(
      productIds.map((productId) =>
        repo.create({
          product_id: productId,
          hs_code: `HS_CONC_${productId.slice(0, 8)}`,
        })
      )
    );

    expect(results).toHaveLength(3);
    const returnedProductIds = results.map((r) => r.product_id).sort();
    expect(returnedProductIds).toEqual(productIds.sort());
  });
});
