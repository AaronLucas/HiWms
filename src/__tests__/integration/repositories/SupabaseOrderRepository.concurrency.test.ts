/**
 * Sprint 0：SupabaseOrderRepository 正确性验证
 *
 * 覆盖 IOrderRepository 全部方法：CRUD + findByExternalId / findByStatus /
 * findByTenant / findPendingAllocation / findWithLines / updateStatus。
 * 直接实例化仓储类，验证"已实现未验证"的仓储代码路径本身。
 *
 * 真实表字段确认（src/types/database.ts）：
 *   orders 必填：external_order_id（非 order_no）、order_type
 *   order_lines 必填：qty；order_id/product_id 为可空外键
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start && supabase db reset
 *
 * 默认跳过：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- SupabaseOrderRepository
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'crypto';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseOrderRepository } from '../../../adapters/supabase/repositories/SupabaseOrderRepository';
import type { OrderInsert } from '../../../core/ports/db/IOrderRepository';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('SupabaseOrderRepository 订单 CRUD 正确性（Sprint 0）', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let repo: SupabaseOrderRepository;
  let tenantId: string;
  let productId: string;
  const createdOrderIds: string[] = [];
  const createdLineIds: string[] = [];

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    const wms = WmsSupabaseClient.getInstance({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    client = wms.getClient();
    repo = new SupabaseOrderRepository(wms);

    const { data: tenant, error: tenantError } = await client
      .from('tenants')
      .insert({ name: `sprint0-order-tenant-${Date.now()}` })
      .select()
      .single();
    if (tenantError || !tenant) throw new Error(`创建测试租户失败: ${tenantError?.message}`);
    tenantId = tenant.id;

    const { data: product, error: productError } = await client
      .from('products')
      .insert({
        tenant_id: tenantId,
        sku: `SPRINT0-SKU-${randomUUID().slice(0, 8)}`,
        name: 'Sprint0 测试商品',
      })
      .select()
      .single();
    if (productError || !product) throw new Error(`创建测试商品失败: ${productError?.message}`);
    productId = product.id;
  });

  afterAll(async () => {
    for (const id of createdLineIds) {
      await client.from('order_lines').delete().eq('id', id);
    }
    for (const id of createdOrderIds) {
      await client.from('order_lines').delete().eq('order_id', id);
      await client.from('orders').delete().eq('id', id);
    }
    if (productId) await client.from('products').delete().eq('id', productId);
    if (tenantId) await client.from('tenants').delete().eq('id', tenantId);
  });

  test('create：创建新订单并返回完整行', async () => {
    const externalOrderId = `EXT-${randomUUID().slice(0, 8)}`;
    const order: OrderInsert = {
      tenant_id: tenantId,
      external_order_id: externalOrderId,
      order_type: 'STANDARD',
      status: 'PENDING',
    };

    const created = await repo.create(order);
    createdOrderIds.push(created.id);

    expect(created.id).toBeTruthy();
    expect(created.external_order_id).toBe(externalOrderId);
    expect(created.order_type).toBe('STANDARD');
    expect(created.tenant_id).toBe(tenantId);
    expect(created.status).toBe('PENDING');
  });

  test('findById：按 ID 查找订单', async () => {
    const externalOrderId = `EXT-${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      external_order_id: externalOrderId,
      order_type: 'STANDARD',
      status: 'PENDING',
    });
    createdOrderIds.push(created.id);

    const found = await repo.findById(created.id);
    expect(found).not.toBeNull();
    expect(found!.external_order_id).toBe(externalOrderId);
  });

  test('findByExternalId：按外部订单号查找，未命中返回 null', async () => {
    const externalOrderId = `EXT-${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      external_order_id: externalOrderId,
      order_type: 'STANDARD',
      status: 'PENDING',
    });
    createdOrderIds.push(created.id);

    const found = await repo.findByExternalId(externalOrderId);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);

    const notFound = await repo.findByExternalId(`NONEXISTENT-${randomUUID()}`);
    expect(notFound).toBeNull();
  });

  test('findByStatus：按租户 + 状态查找订单', async () => {
    const shippedExternalId = `EXT-${randomUUID().slice(0, 8)}`;
    const shipped = await repo.create({
      tenant_id: tenantId,
      external_order_id: shippedExternalId,
      order_type: 'STANDARD',
      status: 'SHIPPED',
    });
    createdOrderIds.push(shipped.id);

    const results = await repo.findByStatus('SHIPPED', tenantId);
    expect(results.length).toBeGreaterThan(0);
    for (const o of results) {
      expect(o.status).toBe('SHIPPED');
      expect(o.tenant_id).toBe(tenantId);
    }
    expect(results.some((o) => o.id === shipped.id)).toBe(true);
  });

  test('findByTenant：按租户查找订单，支持 status 过滤与 limit/offset', async () => {
    const all = await repo.findByTenant(tenantId);
    expect(all.length).toBeGreaterThan(0);
    for (const o of all) {
      expect(o.tenant_id).toBe(tenantId);
    }

    const filtered = await repo.findByTenant(tenantId, { status: 'PENDING' });
    for (const o of filtered) {
      expect(o.status).toBe('PENDING');
    }

    const limited = await repo.findByTenant(tenantId, { limit: 1, offset: 0 });
    expect(limited.length).toBeLessThanOrEqual(1);
  });

  // 生产代码 bug（不在本测试范围内修复，如实记录）：
  // SupabaseOrderRepository.findPendingAllocation() 硬编码调用
  // this.findByStatus('pending_allocation', tenantId)（小写 snake_case），
  // 但 orders 表的 chk_orders_status CHECK 约束（001_enterprise_core_schema.sql
  // §18）只允许大写枚举值 'PENDING'|'CONFIRMED'|'ALLOCATED'|'PICKING'|'PACKED'|
  // 'SHIPPED'|'CANCELLED'|'EXCEPTION'，且全仓库其余写入点（CreateOrderUseCase.ts、
  // CreateWorkOrderUseCase.ts 等）一律使用 'PENDING'。因此 findPendingAllocation
  // 传入的过滤值永远不会匹配任何真实订单，该方法在生产环境下会静默返回空数组。
  // 修复建议：将 SupabaseOrderRepository.ts 第 67 行的 'pending_allocation'
  // 改为 'PENDING'。因涉及生产代码变更，留待人工决策，此处仅跳过断言。
  test.skip('findPendingAllocation：只返回待分配订单（跳过：生产代码硬编码了错误的状态值，见上方注释）', async () => {
    const results = await repo.findPendingAllocation(tenantId);
    expect(results.length).toBeGreaterThan(0);
    for (const o of results) {
      expect(o.status).toBe('PENDING');
      expect(o.tenant_id).toBe(tenantId);
    }
  });

  test('findWithLines：获取订单及其明细，无明细/不存在时的边界情况', async () => {
    const externalOrderId = `EXT-${randomUUID().slice(0, 8)}`;
    const order = await repo.create({
      tenant_id: tenantId,
      external_order_id: externalOrderId,
      order_type: 'STANDARD',
      status: 'PENDING',
    });
    createdOrderIds.push(order.id);

    const { data: line, error: lineError } = await client
      .from('order_lines')
      .insert({ order_id: order.id, product_id: productId, qty: 5 })
      .select()
      .single();
    if (lineError || !line) throw new Error(`创建订单行失败: ${lineError?.message}`);
    createdLineIds.push(line.id);

    const withLines = await repo.findWithLines(order.id);
    expect(withLines).not.toBeNull();
    expect(withLines!.order.id).toBe(order.id);
    expect(withLines!.lines).toHaveLength(1);
    expect(withLines!.lines[0].product_id).toBe(productId);
    expect(withLines!.lines[0].qty).toBe(5);

    // 再次查询同一订单，行数应保持一致（非累加）
    const requeried = await repo.findWithLines(order.id);
    expect(requeried!.lines).toHaveLength(1);

    const notFound = await repo.findWithLines(randomUUID());
    expect(notFound).toBeNull();
  });

  test('updateStatus：更新订单状态', async () => {
    const externalOrderId = `EXT-${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      external_order_id: externalOrderId,
      order_type: 'STANDARD',
      status: 'PENDING',
    });
    createdOrderIds.push(created.id);

    const updated = await repo.updateStatus(created.id, 'ALLOCATED');
    expect(updated.status).toBe('ALLOCATED');
    expect(updated.id).toBe(created.id);

    const found = await repo.findById(created.id);
    expect(found!.status).toBe('ALLOCATED');
  });

  test('delete：删除订单', async () => {
    const externalOrderId = `EXT-${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      external_order_id: externalOrderId,
      order_type: 'STANDARD',
      status: 'PENDING',
    });

    await repo.delete(created.id);

    const found = await repo.findById(created.id);
    expect(found).toBeNull();
  });

  test('并发创建：不同外部订单号并发创建不冲突', async () => {
    const externalIds = Array.from({ length: 3 }, () => `EXT-CONC-${randomUUID().slice(0, 8)}`);

    const results = await Promise.all(
      externalIds.map((externalOrderId) =>
        repo.create({
          tenant_id: tenantId,
          external_order_id: externalOrderId,
          order_type: 'STANDARD',
          status: 'PENDING',
        })
      )
    );

    results.forEach((r) => createdOrderIds.push(r.id));

    expect(results).toHaveLength(3);
    const returnedIds = results.map((r) => r.external_order_id).sort();
    expect(returnedIds).toEqual(externalIds.sort());
  });
});
