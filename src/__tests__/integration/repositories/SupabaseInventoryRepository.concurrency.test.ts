/**
 * Sprint 0 集成测试：SupabaseInventoryRepository 正确性验证
 *
 * 覆盖 IInventoryRepository 全部方法：CRUD + findByLocation / findByProduct /
 * findByContainer / findAvailable / findAvailableSources / getReplenishmentNeeds /
 * getTotalQuantity / updateQuantities（乐观锁），以及一个并发创建场景。
 * 直接实例化仓储类，验证"已实现未验证"的仓储代码路径本身。
 *
 * 已知技术债（不在本测试文件修复，如实反映）：
 * 1. `findReplenishmentNeeded()` 原实现调用不存在的 RPC `calculate_replenishment_threshold`
 *    且把未 await 的查询构建器直接传给 `.lt()`；已改为复用 `getReplenishmentNeeds()` 已验证
 *    的 `v_replenishment_needs` 视图逻辑，本文件已补上对应测试（见下方），不再是已知技术债。
 * 2. `containers` 表的 RLS 策略（tenant_isolation）在本地环境下会触发
 *    `fn_current_tenant_id()` 反复抛出 "stack depth limit exceeded"
 *    (SQLSTATE 54001)，最终导致 PostgREST 对 `containers` 表的任何查询
 *    （即使使用 service_role key）都以 57014 statement timeout 失败；
 *    而 tenants/products/locations/inventory 四张表用同一把 service_role key
 *    查询完全正常。这是 containers 表 RLS/相关函数层面的真实环境缺陷，与
 *    SupabaseInventoryRepository.ts 本身无关（该文件从不直接查询 containers
 *    表，findByContainer 只过滤 inventory.container_id）。为了不被这个环境缺陷
 *    卡住 findByContainer 的正确性验证，本文件绕过 PostgREST，直接用本地
 *    docker exec psql（服务端持有 postgres 超级用户，不受 RLS 影响）创建/清理
 *    测试用的 containers 行；findByContainer 本身仍然是通过仓储类经
 *    PostgREST 查询 inventory 表来验证的。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start && supabase db reset
 *
 * 默认跳过：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- SupabaseInventoryRepository
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'crypto';
import { execSync } from 'node:child_process';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseInventoryRepository } from '../../../adapters/supabase/repositories/SupabaseInventoryRepository';
import type { InventoryInsert } from '../../../core/ports/db/IInventoryRepository';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/**
 * 在本地 supabase Postgres 容器内以超级用户身份执行原始 SQL。
 * 仅用于绕过 containers 表已知的 RLS/环境缺陷（见文件头部说明），
 * 不用于测试 SupabaseInventoryRepository 本身的任何查询路径。
 */
function execRawSql(sql: string): void {
  const containerName = execSync(
    `docker ps --filter "name=supabase_db" --format "{{.Names}}"`
  )
    .toString()
    .trim()
    .split('\n')[0];
  if (!containerName) {
    throw new Error('未找到本地 supabase_db 容器，无法为 containers 表创建测试数据');
  }
  execSync(`docker exec ${containerName} psql -U postgres -d postgres -t -A -c "${sql}"`);
}

describe.skipIf(!RUN)('SupabaseInventoryRepository 库存 CRUD 正确性（Sprint 0）', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let repo: SupabaseInventoryRepository;
  let tenantId: string;
  let productId: string;
  let locationPickId: string;
  let locationBulkId: string;
  let containerId: string;
  const createdInventoryIds: string[] = [];

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    const wms = WmsSupabaseClient.getInstance({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    client = wms.getClient();
    repo = new SupabaseInventoryRepository(wms);

    const { data: tenant, error: tenantError } = await client
      .from('tenants')
      .insert({ name: `sprint0-inventory-tenant-${Date.now()}` })
      .select()
      .single();
    if (tenantError || !tenant) throw new Error(`创建测试租户失败: ${tenantError?.message}`);
    tenantId = tenant.id;

    const { data: product, error: productError } = await client
      .from('products')
      .insert({ tenant_id: tenantId, sku: `TEST_INV_SKU_${randomUUID().slice(0, 8)}`, name: '测试库存商品' })
      .select()
      .single();
    if (productError || !product) throw new Error(`创建测试产品失败: ${productError?.message}`);
    productId = product.id;

    const { data: locPick, error: locPickError } = await client
      .from('locations')
      .insert({
        tenant_id: tenantId,
        code: `TEST_LOC_PICK_${randomUUID().slice(0, 8)}`,
        zone_type: 'PICK',
        picking_max_qty: 100,
        is_active: true,
      })
      .select()
      .single();
    if (locPickError || !locPick) throw new Error(`创建测试库位（PICK）失败: ${locPickError?.message}`);
    locationPickId = locPick.id;

    const { data: locBulk, error: locBulkError } = await client
      .from('locations')
      .insert({
        tenant_id: tenantId,
        code: `TEST_LOC_BULK_${randomUUID().slice(0, 8)}`,
        zone_type: 'BULK',
        is_active: true,
      })
      .select()
      .single();
    if (locBulkError || !locBulk) throw new Error(`创建测试库位（BULK）失败: ${locBulkError?.message}`);
    locationBulkId = locBulk.id;

    // containers 表通过 PostgREST 查询会触发已知 RLS 环境缺陷（见文件头部说明），
    // 这里用原始 SQL 直接创建，绕开该缺陷，仅为满足 inventory.container_id 的外键约束。
    containerId = randomUUID();
    execRawSql(
      `INSERT INTO containers (id, lpn_code, lpn_source, status) VALUES ('${containerId}', 'TEST_LPN_${randomUUID().slice(0, 8)}', 'SYSTEM_GENERATED', 'IN_USE');`
    );
  });

  afterAll(async () => {
    for (const id of createdInventoryIds) {
      await client.from('inventory').delete().eq('id', id);
    }
    execRawSql(`DELETE FROM containers WHERE id = '${containerId}';`);
    await client.from('locations').delete().eq('id', locationPickId);
    await client.from('locations').delete().eq('id', locationBulkId);
    await client.from('products').delete().eq('id', productId);
    await client.from('tenants').delete().eq('id', tenantId);
  });

  test('create：创建库存记录并返回完整行', async () => {
    const insert: InventoryInsert = {
      tenant_id: tenantId,
      product_id: productId,
      location_id: locationBulkId,
      quantity: 50,
    };

    const created = await repo.create(insert);
    createdInventoryIds.push(created.id);

    expect(created.id).toBeTruthy();
    expect(Number(created.quantity)).toBe(50);
    expect(created.tenant_id).toBe(tenantId);
    expect(created.product_id).toBe(productId);
    expect(created.version).toBe(1);
  });

  test('findById：按 ID 查找库存', async () => {
    const created = await repo.create({
      tenant_id: tenantId,
      product_id: productId,
      location_id: locationBulkId,
      quantity: 20,
    });
    createdInventoryIds.push(created.id);

    const found = await repo.findById(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(Number(found!.quantity)).toBe(20);

    const notFound = await repo.findById(randomUUID());
    expect(notFound).toBeNull();
  });

  test('findByLocation：按库位查找库存', async () => {
    const created1 = await repo.create({
      tenant_id: tenantId,
      product_id: productId,
      location_id: locationBulkId,
      quantity: 5,
    });
    const created2 = await repo.create({
      tenant_id: tenantId,
      product_id: productId,
      location_id: locationBulkId,
      quantity: 6,
    });
    createdInventoryIds.push(created1.id, created2.id);

    const rows = await repo.findByLocation(locationBulkId);
    for (const row of rows) {
      expect(row.location_id).toBe(locationBulkId);
    }
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(created1.id);
    expect(ids).toContain(created2.id);
  });

  test('findByProduct：按产品查找库存（隔离其他产品）', async () => {
    const { data: otherProduct, error } = await client
      .from('products')
      .insert({ tenant_id: tenantId, sku: `TEST_OTHER_SKU_${randomUUID().slice(0, 8)}`, name: '测试其他商品' })
      .select()
      .single();
    if (error || !otherProduct) throw new Error(`创建对照产品失败: ${error?.message}`);

    const created = await repo.create({
      tenant_id: tenantId,
      product_id: productId,
      location_id: locationBulkId,
      quantity: 7,
    });
    const otherRow = await repo.create({
      tenant_id: tenantId,
      product_id: otherProduct.id,
      location_id: locationBulkId,
      quantity: 8,
    });
    createdInventoryIds.push(created.id, otherRow.id);

    const rows = await repo.findByProduct(productId);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(created.id);
    expect(ids).not.toContain(otherRow.id);
    for (const row of rows) {
      expect(row.product_id).toBe(productId);
    }

    await client.from('inventory').delete().eq('id', otherRow.id);
    await client.from('products').delete().eq('id', otherProduct.id);
  });

  test('findByContainer：按容器查找库存', async () => {
    const created = await repo.create({
      tenant_id: tenantId,
      product_id: productId,
      location_id: locationBulkId,
      container_id: containerId,
      quantity: 3,
    });
    createdInventoryIds.push(created.id);

    const rows = await repo.findByContainer(containerId);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(created.id);
    for (const row of rows) {
      expect(row.container_id).toBe(containerId);
    }

    const notFound = await repo.findByContainer(randomUUID());
    expect(notFound).toEqual([]);
  });

  test('findAvailable：仅返回数量 > 0 且未装箱的库存', async () => {
    const available = await repo.create({
      tenant_id: tenantId,
      product_id: productId,
      location_id: locationBulkId,
      quantity: 15,
    });
    const zeroQty = await repo.create({
      tenant_id: tenantId,
      product_id: productId,
      location_id: locationBulkId,
      quantity: 0,
    });
    const boxed = await repo.create({
      tenant_id: tenantId,
      product_id: productId,
      location_id: locationBulkId,
      container_id: containerId,
      quantity: 12,
    });
    createdInventoryIds.push(available.id, zeroQty.id, boxed.id);

    const rows = await repo.findAvailable(productId);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(available.id);
    expect(ids).not.toContain(zeroQty.id);
    expect(ids).not.toContain(boxed.id);

    const rowsWithLocation = await repo.findAvailable(productId, locationBulkId);
    expect(rowsWithLocation.map((r) => r.id)).toContain(available.id);
  });

  test('findAvailableSources：按库区类型 + 最小数量查找补货源库位', async () => {
    const pickSource = await repo.create({
      tenant_id: tenantId,
      product_id: productId,
      location_id: locationPickId,
      quantity: 30,
    });
    const bulkSource = await repo.create({
      tenant_id: tenantId,
      product_id: productId,
      location_id: locationBulkId,
      quantity: 40,
    });
    createdInventoryIds.push(pickSource.id, bulkSource.id);

    const sources = await repo.findAvailableSources({
      skuId: productId,
      zoneTypes: ['PICK'],
      minQuantity: 10,
    });

    const locationIds = sources.map((s) => s.location_id);
    expect(locationIds).toContain(locationPickId);
    expect(locationIds).not.toContain(locationBulkId);
    const pickEntry = sources.find((s) => s.location_id === locationPickId);
    expect(pickEntry?.zone_type).toBe('PICK');

    const noneAboveThreshold = await repo.findAvailableSources({
      skuId: productId,
      zoneTypes: ['PICK'],
      minQuantity: 1000,
    });
    expect(noneAboveThreshold.map((s) => s.location_id)).not.toContain(locationPickId);
  });

  test('getTotalQuantity：按产品 + 租户聚合库存总量', async () => {
    const { data: sumProduct, error } = await client
      .from('products')
      .insert({ tenant_id: tenantId, sku: `TEST_SUM_SKU_${randomUUID().slice(0, 8)}`, name: '测试聚合商品' })
      .select()
      .single();
    if (error || !sumProduct) throw new Error(`创建聚合测试产品失败: ${error?.message}`);

    const rowA = await repo.create({
      tenant_id: tenantId,
      product_id: sumProduct.id,
      location_id: locationBulkId,
      quantity: 10,
    });
    const rowB = await repo.create({
      tenant_id: tenantId,
      product_id: sumProduct.id,
      location_id: locationPickId,
      quantity: 25,
    });
    createdInventoryIds.push(rowA.id, rowB.id);

    const total = await repo.getTotalQuantity(sumProduct.id, tenantId);
    expect(total).toBe(35);

    await client.from('inventory').delete().eq('id', rowA.id);
    await client.from('inventory').delete().eq('id', rowB.id);
    await client.from('products').delete().eq('id', sumProduct.id);
  });

  test('updateQuantities：乐观锁批量更新库存数量', async () => {
    const created = await repo.create({
      tenant_id: tenantId,
      product_id: productId,
      location_id: locationBulkId,
      quantity: 9,
    });
    createdInventoryIds.push(created.id);
    expect(created.version).toBe(1);

    const [updated] = await repo.updateQuantities([
      { id: created.id, quantity: 99, expectedVersion: 1 },
    ]);
    expect(Number(updated.quantity)).toBe(99);
    expect(updated.version).toBe(2);

    // 使用过期版本号重试应因乐观锁冲突而失败（实际版本已是 2）
    await expect(
      repo.updateQuantities([{ id: created.id, quantity: 199, expectedVersion: 1 }])
    ).rejects.toThrow(/乐观锁冲突/);
  });

  test('getReplenishmentNeeds：查询 v_replenishment_needs 补货需求视图', async () => {
    // 视图按 (loc_id, sku_id) 分组聚合数量，为避免与其他用例共用
    // locationPickId/productId 时的库存量互相干扰导致 fill_rate_pct 漂出 <20% 窗口，
    // 这里用独立的产品 + 独立的 PICK 库位隔离验证视图口径本身。
    const { data: replProduct, error: replProductError } = await client
      .from('products')
      .insert({ tenant_id: tenantId, sku: `TEST_REPL_SKU_${randomUUID().slice(0, 8)}`, name: '测试补货商品' })
      .select()
      .single();
    if (replProductError || !replProduct) throw new Error(`创建补货测试产品失败: ${replProductError?.message}`);

    const { data: replLocation, error: replLocationError } = await client
      .from('locations')
      .insert({
        tenant_id: tenantId,
        code: `TEST_LOC_REPL_${randomUUID().slice(0, 8)}`,
        zone_type: 'PICK',
        picking_max_qty: 100,
        is_active: true,
      })
      .select()
      .single();
    if (replLocationError || !replLocation) throw new Error(`创建补货测试库位失败: ${replLocationError?.message}`);

    // picking_max_qty = 100，这里放 10（10% < 20%）触发命中。
    const lowFill = await repo.create({
      tenant_id: tenantId,
      product_id: replProduct.id,
      location_id: replLocation.id,
      quantity: 10,
    });

    const needs = await repo.getReplenishmentNeeds();
    const match = needs.find((n) => n.loc_id === replLocation.id && n.sku_id === replProduct.id);
    expect(match).toBeDefined();
    expect(match!.fill_rate_pct).toBeLessThan(20);
    expect(Number(match!.current_qty)).toBeGreaterThan(0);

    // tenantId 参数当前实现未按租户过滤视图（已知简化实现），调用本身不应报错
    const needsWithTenant = await repo.getReplenishmentNeeds(tenantId);
    expect(Array.isArray(needsWithTenant)).toBe(true);

    await client.from('inventory').delete().eq('id', lowFill.id);
    await client.from('locations').delete().eq('id', replLocation.id);
    await client.from('products').delete().eq('id', replProduct.id);
  });

  test('findReplenishmentNeeded：复用 getReplenishmentNeeds 的 (loc_id, sku_id) 精确对，拿回真实 inventory 行', async () => {
    const { data: replProduct, error: replProductError } = await client
      .from('products')
      .insert({
        tenant_id: tenantId,
        sku: `TEST_SKU_FRN_${randomUUID().slice(0, 8)}`,
        name: '补货测试商品(findReplenishmentNeeded)',
      })
      .select()
      .single();
    if (replProductError || !replProduct) throw new Error(`创建补货测试商品失败: ${replProductError?.message}`);

    const { data: replLocation, error: replLocationError } = await client
      .from('locations')
      .insert({
        tenant_id: tenantId,
        code: `TEST_LOC_FRN_${randomUUID().slice(0, 8)}`,
        zone_type: 'PICK',
        picking_max_qty: 100,
        is_active: true,
      })
      .select()
      .single();
    if (replLocationError || !replLocation) throw new Error(`创建补货测试库位失败: ${replLocationError?.message}`);

    // picking_max_qty = 100，放 10（10% < 20%）触发补货判定命中。
    const lowFill = await repo.create({
      tenant_id: tenantId,
      product_id: replProduct.id,
      location_id: replLocation.id,
      quantity: 10,
    });

    const needed = await repo.findReplenishmentNeeded(tenantId);
    const match = needed.find((row) => row.id === lowFill.id);
    expect(match).toBeDefined();
    expect(match!.location_id).toBe(replLocation.id);
    expect(match!.product_id).toBe(replProduct.id);
    expect(Number(match!.quantity)).toBe(10);

    await client.from('inventory').delete().eq('id', lowFill.id);
    await client.from('locations').delete().eq('id', replLocation.id);
    await client.from('products').delete().eq('id', replProduct.id);
  });

  test('并发创建：不同库存记录并发创建不冲突', async () => {
    const quantities = [11, 12, 13];

    const results = await Promise.all(
      quantities.map((quantity) =>
        repo.create({
          tenant_id: tenantId,
          product_id: productId,
          location_id: locationBulkId,
          quantity,
        })
      )
    );

    results.forEach((r) => createdInventoryIds.push(r.id));

    expect(results).toHaveLength(3);
    const returnedQuantities = results.map((r) => Number(r.quantity)).sort();
    expect(returnedQuantities).toEqual(quantities.sort());
  });
});
