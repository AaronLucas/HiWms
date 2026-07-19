/**
 * ECC 治理 Phase 5/6/7 测试补齐（docs/03-database/REPOSITORY_ROADMAP.md P0 第 3 项）：
 * `SupabasePackingTaskItemRepository` 打包明细行 + 同箱/同码去重逻辑正确性验证。
 *
 * === 可达性核查（测试方法论第 6 步，见长期记忆 feedback_testing_methodology_hierarchy）===
 * 全仓库搜索确认：`packingTaskItems`（该仓储的 DI 注册名）在 `src/apps/device-api/routes.ts`
 * 和 `src/apps/admin-api/*` 均无任何调用方。真实的 PDA 打包动作走的是
 * `syncEventRepo.insertBatch(...)` → SQL 端 `fn_apply_sync_event` → `fn_apply_pack_action`
 * （supabase/migrations/003_extend_sync_event_actions.sql），后者已经在 SQL 层用
 * `INSERT ... ON CONFLICT (packing_task_id, order_line_id[, container_id]) DO UPDATE` 原子
 * 完成了去重累加，且已由 DBA 团队本地验证过（见 docs/02-api/SYNC_ACTIONS_EXTENSION.md §9）。
 * 也就是说：本文件测试的 `SupabasePackingTaskItemRepository.insertBatch()` 是当前系统里
 * 一条尚未被任何真实入口调用的应用层代码路径（可能是留给未来后台补录/管理端场景的通用
 * 批量写入工具）。以下发现的 3 个 bug 目前不会在生产环境实际触发，但一旦被接入
 * （例如管理端"手工补登打包明细"功能），会在真实并发/边界场景下必现故障，因此仍按
 * "已实现未验证"的既定优先级补齐测试与修复。
 *
 * === 测试过程中发现并修复的 3 个真实缺陷（均为纯 TS 应用层代码，未触碰任何 .sql 文件）===
 *
 * Bug 1（去重键错误）：原实现用 `findByProduct(packing_task_id, product_id, tenantId)` 判断
 * 是否已存在同一行，即按 `product_id` 去重；但真实的数据库唯一索引
 * （`uq_packing_task_items_no_container`/`uq_packing_task_items_with_container`，见 003 迁移）
 * 以及 SQL 端 `fn_apply_pack_action` 的 `ON CONFLICT` 目标列，去重键都是
 * `order_line_id`（不是 `product_id`）。同一打包任务下两个不同订单行凑巧引用同一 SKU 时，
 * 原实现会把它们的数量错误合并进同一行——这不是假设性风险，是与真实 schema 设计意图
 * 直接矛盾的数据正确性问题。
 *
 * Bug 2（container_id 为空时完全跳过去重）：原实现的去重条件是
 * `dedupe && item.packing_task_id && item.product_id && item.container_id`——`container_id`
 * 是 falsy 检查，为 NULL/undefined 时直接跳过去重分支，走"总是插入新行"。但根据设计文档
 * （SYNC_ACTIONS_EXTENSION.md §4.3）与真实数据库索引，`container_id` 为 NULL 恰恰是"同码/
 * 批量容器不追踪具体箱子"的正常业务场景，此时依然存在
 * `uq_packing_task_items_no_container (packing_task_id, order_line_id) WHERE container_id
 * IS NULL` 这条唯一索引约束。原实现对这个分支完全不做去重检查，同一订单行第二次打包
 * （不指定容器）必然撞上该唯一索引，抛出未捕获的 PostgREST 23505 错误。
 *
 * Bug 3（先查后写竞态）：即便命中去重分支，原实现也是"SELECT 判断是否存在 → 决定
 * INSERT 还是 UPDATE"的非原子读改写模式，中间存在窗口期。真实并发下两个请求都可能在
 * SELECT 阶段读到"不存在"，都尝试 INSERT，其中一个会撞上数据库唯一索引崩溃退出，而不是
 * 优雅地合并为一行——与 P0 第 1/2 项发现的"读改写竞态"是同一类问题。
 *
 * 修复方式：`insertBatch()` 改为按 `order_line_id`（而非 `product_id`）查找匹配行，去重
 * 判断条件改为 `packing_task_id && order_line_id`（不再要求 container_id 为真值），并把
 * 单次 SELECT+写入改为乐观并发重试循环——插入撞 23505 或更新因 `updated_at` 比对失败
 * （乐观锁丢失）都视为"被并发请求抢先"，重新读取当前状态后重试。首版重试上限设为 5 次、
 * 无退避，本文件下方 8 路并发用例最初复现了"落败者耗尽重试次数"的失败——多个请求在同一轮
 * 读到完全相同的 `updated_at` 快照时会集体重试，每轮理论上只能保证恰好 1 个请求胜出，最坏
 * 情形所需轮数与并发请求数同量级。改为随机退避（打散整队重试）+ 20 次上限后，8 路并发连续
 * 3 轮重跑稳定全部成功，详见 `REPOSITORY_ROADMAP.md` P0 第 3 项执行记录。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset   # 依次应用 001→004 迁移脚本
 *
 * 默认跳过（避免无本地 Supabase 环境时拖垮 `npm run test`/CI）：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- fn_apply_pack_action
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabasePackingTaskItemRepository } from '../../../adapters/supabase/repositories/SupabasePackingTaskItemRepository';
import type { PackingTaskItemInsert } from '../../../core/ports/db/IPackingTaskItemRepository';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// `supabase start` 本地默认 service_role key（非生产密钥，仅用于本地一次性沙盒实例）。
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('SupabasePackingTaskItemRepository 打包明细行去重正确性（Phase 5/6/7 P0 第 3 项）', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let repo: SupabasePackingTaskItemRepository;
  let tenantId: string;
  let packingTaskId: string;

  const createOrderWithLine = async (productId: string, qty: number): Promise<{ orderId: string; orderLineId: string }> => {
    const { data: order, error: orderErr } = await client
      .from('orders')
      .insert({ tenant_id: tenantId, external_order_id: `p0-3-order-${Date.now()}-${Math.random()}`, order_type: 'STANDARD' })
      .select()
      .single();
    if (orderErr) throw orderErr;

    const { data: line, error: lineErr } = await client
      .from('order_lines')
      .insert({ order_id: order.id, product_id: productId, qty })
      .select()
      .single();
    if (lineErr) throw lineErr;

    return { orderId: order.id, orderLineId: line.id };
  };

  const createProduct = async (): Promise<string> => {
    const { data, error } = await client
      .from('products')
      .insert({ tenant_id: tenantId, sku: `p0-3-sku-${Date.now()}-${Math.random()}`, name: 'P0-3 测试商品' })
      .select()
      .single();
    if (error) throw error;
    return data.id;
  };

  const createContainer = async (): Promise<string> => {
    const { data, error } = await client
      .from('containers')
      .insert({ lpn_code: `p0-3-lpn-${Date.now()}-${Math.random()}` })
      .select()
      .single();
    if (error) throw error;
    return data.id;
  };

  const item = (orderLineId: string, productId: string, containerId: string | null, qty: number): PackingTaskItemInsert => ({
    tenant_id: tenantId,
    packing_task_id: packingTaskId,
    order_line_id: orderLineId,
    product_id: productId,
    container_id: containerId,
    qty,
  });

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    const wms = WmsSupabaseClient.getInstance({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    client = wms.getClient();
    repo = new SupabasePackingTaskItemRepository(wms);

    const { data: tenant, error: tenantErr } = await client
      .from('tenants')
      .insert({ name: `ecc-p0-3-tenant-${Date.now()}` })
      .select()
      .single();
    if (tenantErr) throw tenantErr;
    tenantId = tenant.id;
  });

  afterAll(async () => {
    // tenants 上的外键均为 ON DELETE CASCADE，删除租户即可级联清理 order/order_lines/
    // packing_tasks/packing_task_items（containers 表本身无 tenant_id，独立清理）。
    if (tenantId) await client.from('tenants').delete().eq('id', tenantId);
  });

  const createPackingTask = async (orderId: string): Promise<string> => {
    const { data, error } = await client
      .from('packing_tasks')
      .insert({ tenant_id: tenantId, order_id: orderId, status: 'PACKING' })
      .select()
      .single();
    if (error) throw error;
    return data.id;
  };

  test('两个不同订单行凑巧引用同一 SKU 时，不应被错误合并进同一行（回归 Bug 1：去重键应为 order_line_id 而非 product_id）', async () => {
    // Arrange：同一 product，两条不同的 order_line
    const productId = await createProduct();
    const { orderId, orderLineId: lineA } = await createOrderWithLine(productId, 10);
    const { orderLineId: lineB } = await createOrderWithLine(productId, 10);
    // 两条订单行挂在同一个打包任务下（同一波次/打包场景常见），且共用同一个容器——
    // 必须共用容器才能真正触发原实现里"按 product_id + container_id 去重"的（错误）分支；
    // container_id 为 NULL 时原实现的 dedupe 条件本身就是 falsy 短路跳过，无法暴露这个 bug
    // （那是 Bug 2 覆盖的另一个独立问题，见下一个用例）。
    packingTaskId = await createPackingTask(orderId);
    const containerId = await createContainer();

    // Act
    const results = await repo.insertBatch([
      item(lineA, productId, containerId, 3),
      item(lineB, productId, containerId, 4),
    ]);

    // Assert：应产生两行独立记录，各自对应各自的 order_line，数量不应被合并
    expect(results).toHaveLength(2);
    const rows = await repo.findByPackingTask(packingTaskId, tenantId);
    expect(rows).toHaveLength(2);
    const byLine = new Map(rows.map((r) => [r.order_line_id, Number(r.qty)]));
    expect(byLine.get(lineA)).toBe(3);
    expect(byLine.get(lineB)).toBe(4);
  });

  test('container_id 为空时，同一订单行二次打包应合并数量而不是抛出唯一索引冲突（回归 Bug 2）', async () => {
    // Arrange
    const productId = await createProduct();
    const { orderId, orderLineId } = await createOrderWithLine(productId, 20);
    packingTaskId = await createPackingTask(orderId);

    // Act：分两批（模拟两次不同批次打包同一订单行，都不指定容器）
    await repo.insertBatch([item(orderLineId, productId, null, 5)]);
    await repo.insertBatch([item(orderLineId, productId, null, 7)]);

    // Assert：应合并为一行，数量累加，而不是抛错或产生两行
    const rows = await repo.findByOrderLine(orderLineId, tenantId);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].qty)).toBe(12);
  });

  test('container_id 不为空时，同一订单行+同一容器二次打包应合并数量', async () => {
    // Arrange
    const productId = await createProduct();
    const { orderId, orderLineId } = await createOrderWithLine(productId, 20);
    packingTaskId = await createPackingTask(orderId);
    const containerId = await createContainer();

    // Act
    await repo.insertBatch([item(orderLineId, productId, containerId, 6)]);
    await repo.insertBatch([item(orderLineId, productId, containerId, 9)]);

    // Assert
    const rows = await repo.findByContainer(containerId, tenantId);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].qty)).toBe(15);
  });

  test('同一订单行+同一容器不同批次应各自独立，不与空容器的行混淆', async () => {
    // Arrange
    const productId = await createProduct();
    const { orderId, orderLineId } = await createOrderWithLine(productId, 20);
    packingTaskId = await createPackingTask(orderId);
    const containerId = await createContainer();

    // Act：先不指定容器打包一部分，再指定容器打包另一部分
    await repo.insertBatch([item(orderLineId, productId, null, 4)]);
    await repo.insertBatch([item(orderLineId, productId, containerId, 6)]);

    // Assert：应产生两条独立记录（一条 container_id IS NULL，一条 container_id = containerId）
    const rows = await repo.findByOrderLine(orderLineId, tenantId);
    expect(rows).toHaveLength(2);
    const noContainerRow = rows.find((r) => r.container_id === null);
    const withContainerRow = rows.find((r) => r.container_id === containerId);
    expect(Number(noContainerRow?.qty)).toBe(4);
    expect(Number(withContainerRow?.qty)).toBe(6);
  });

  test('并发对同一订单行（不指定容器）发起 8 次打包写入，结果应恰好合并为 1 行，数量为全部之和，且无请求崩溃（回归 Bug 3：先查后写竞态）', async () => {
    // Arrange
    const productId = await createProduct();
    const { orderId, orderLineId } = await createOrderWithLine(productId, 100);
    packingTaskId = await createPackingTask(orderId);
    const quantities = [1, 2, 3, 4, 5, 6, 7, 8];

    // Act：8 个真正并发的 insertBatch 调用（Promise.all，非串行伪并发），各自写入 1 个明细
    const settled = await Promise.allSettled(
      quantities.map((qty) => repo.insertBatch([item(orderLineId, productId, null, qty)]))
    );

    // Assert：全部请求都应成功完成（不应有任何一个因未捕获的 23505/PGRST116 崩溃）
    const rejected = settled.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(0);

    // Assert：最终应恰好合并为 1 行，数量为全部并发写入之和，不丢单也不重复行
    const rows = await repo.findByOrderLine(orderLineId, tenantId);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].qty)).toBe(quantities.reduce((a, b) => a + b, 0));
  });

  test('updateQty 应正确更新数量并保留其余字段', async () => {
    // Arrange
    const productId = await createProduct();
    const { orderId, orderLineId } = await createOrderWithLine(productId, 20);
    packingTaskId = await createPackingTask(orderId);
    const [created] = await repo.insertBatch([item(orderLineId, productId, null, 3)]);

    // Act
    const updated = await repo.updateQty(created.id, tenantId, 99);

    // Assert
    expect(updated?.qty ? Number(updated.qty) : null).toBe(99);
    expect(updated?.order_line_id).toBe(orderLineId);
  });

  test('assignContainer 应批量关联容器并返回受影响行数', async () => {
    // Arrange：两个不同订单行，各打包一行（均不指定容器）
    const productId = await createProduct();
    const { orderId, orderLineId: lineA } = await createOrderWithLine(productId, 20);
    const { orderLineId: lineB } = await createOrderWithLine(productId, 20);
    packingTaskId = await createPackingTask(orderId);
    const [rowA] = await repo.insertBatch([item(lineA, productId, null, 2)]);
    const [rowB] = await repo.insertBatch([item(lineB, productId, null, 3)]);
    const containerId = await createContainer();

    // Act
    const affected = await repo.assignContainer([rowA.id, rowB.id], containerId, tenantId);

    // Assert
    expect(affected).toBe(2);
    const rows = await repo.findByContainer(containerId, tenantId);
    expect(rows.map((r) => r.id).sort()).toEqual([rowA.id, rowB.id].sort());
  });

  test('getStatsByPackingTask 应正确汇总总行数/总数量/按商品/按容器分组', async () => {
    // Arrange
    const productA = await createProduct();
    const productB = await createProduct();
    const { orderId, orderLineId: lineA } = await createOrderWithLine(productA, 20);
    const { orderLineId: lineB } = await createOrderWithLine(productB, 20);
    packingTaskId = await createPackingTask(orderId);
    const containerId = await createContainer();

    await repo.insertBatch([item(lineA, productA, containerId, 5)]);
    await repo.insertBatch([item(lineB, productB, null, 7)]);

    // Act
    const stats = await repo.getStatsByPackingTask(packingTaskId, tenantId);

    // Assert
    expect(stats.totalItems).toBe(2);
    expect(stats.totalQty).toBe(12);
    const byProduct = new Map(stats.byProduct.map((p) => [p.productId, p.qty]));
    expect(byProduct.get(productA)).toBe(5);
    expect(byProduct.get(productB)).toBe(7);
    const byContainer = new Map(stats.byContainer.map((c) => [c.containerId, c.itemCount]));
    expect(byContainer.get(containerId)).toBe(1);
  });

  test('deleteByPackingTask 应删除该打包任务下的全部明细行并返回删除数', async () => {
    // Arrange
    const productId = await createProduct();
    const { orderId, orderLineId: lineA } = await createOrderWithLine(productId, 20);
    const { orderLineId: lineB } = await createOrderWithLine(productId, 20);
    packingTaskId = await createPackingTask(orderId);
    await repo.insertBatch([item(lineA, productId, null, 2)]);
    await repo.insertBatch([item(lineB, productId, null, 3)]);

    // Act
    const deleted = await repo.deleteByPackingTask(packingTaskId, tenantId);

    // Assert
    expect(deleted).toBe(2);
    const remaining = await repo.findByPackingTask(packingTaskId, tenantId);
    expect(remaining).toHaveLength(0);
  });
});
