/**
 * ECC 治理 Phase 5/6/7 测试补齐（docs/03-database/REPOSITORY_ROADMAP.md P2 第 3 项）：
 * `SupabaseUnidentifiedGoodsRepository` / `fn_receive_unidentified_goods` /
 * `fn_identify_unidentified_goods` 正确性验证。
 *
 * === 可达性核查（测试方法论第 6 步）===
 * `receiveUnidentifiedGoods`/`identifyUnidentifiedGoods` 是真实生产路径
 * （`src/apps/device-api/routes.ts` 的 `POST /unidentified/receive`/`POST /unidentified/identify`
 * 直接调用）。`findContainerByException`/`createContainer`/`findContainerByLpn`/
 * `findSystemGeneratedContainers` 目前无真实调用方。
 *
 * === 发现并修复的真实缺陷（纯 TS 应用层代码，未触碰任何 .sql 文件）===
 *
 * **缺陷 1（比 P1 第 3 项更严重：不是列名笔误，是整个方法的领域模型错误）**：
 * `findContainerByException` 原实现对 `containers` 表过滤
 * `.eq('exception_id', exceptionId).eq('tenant_id', tenantId)`。但读
 * `fn_receive_unidentified_goods`/`fn_identify_unidentified_goods` SQL 源码
 * （supabase/migrations/004_tracking_policy_missing_label.sql）确认：
 * UNIDENTIFIED_GOODS 闭环从头到尾只操作 `inventory` 表（`product_id` 记为 NULL
 * 暂存，`fn_identify_unidentified_goods` 直接 `UPDATE inventory SET product_id`
 * 回填），**从不创建 `containers` 行**——与 MISSING_LABEL 闭环（会生成
 * `SYSTEM_GENERATED` 容器）是完全不同的两条路径（见 `.readonly/
 * unWMS_Tracking_Policy_Missing_Label_V1.md` §3 的"两条完全不同的异常路径"）。
 * `containers` 表本身也没有 `exception_id` 列（已用 `psql \d containers` 核实）。
 * 也就是说"按异常查容器"这个问题在真实数据模型里没有答案，不是可以通过改列名
 * 修好的 bug——修复为恒返回 `null` 并在代码注释里说明原因，而不是编一个跨表
 * join 到 `inventory` 的新查询逻辑（那会改变方法的返回类型语义，属于需要人工
 * 确认的接口设计变更，不在本次测试补齐范围内）。
 *
 * **缺陷 2（与 P1 第 3 项同一类）**：`findContainerByLpn`/`findSystemGeneratedContainers`
 * 过滤 `containers` 表上不存在的 `tenant_id` 列，每次调用必定抛 PostgREST 列不存在
 * 错误（`42703`）。修复：去掉这两个方法上从未真实生效过的 `tenantId` 参数——与
 * `IMissingLabelRepository` 的同名方法完全同一类根因（复制粘贴导致）、同一种修法。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset   # 依次应用 001→004 迁移脚本
 *
 * 默认跳过（避免无本地 Supabase 环境时拖垮 `npm run test`/CI）：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- fn_receive_unidentified_goods
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseRpcClient } from '../../../adapters/supabase/rpc/SupabaseRpcClient';
import { SupabaseUnidentifiedGoodsRepository } from '../../../adapters/supabase/repositories/SupabaseUnidentifiedGoodsRepository';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// `supabase start` 本地默认 service_role key（非生产密钥，仅用于本地一次性沙盒实例）。
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('SupabaseUnidentifiedGoodsRepository 未识别货物闭环正确性（Phase 5/6/7 P2 第 3 项）', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let repo: SupabaseUnidentifiedGoodsRepository;
  let tenantId: string;
  let userId: string;
  let locationId: string;

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    const wms = WmsSupabaseClient.getInstance({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    client = wms.getClient();
    repo = new SupabaseUnidentifiedGoodsRepository(wms, new SupabaseRpcClient(wms));

    const { data: tenant, error: tenantErr } = await client
      .from('tenants')
      .insert({ name: `ecc-p2-3-tenant-${Date.now()}` })
      .select()
      .single();
    if (tenantErr) throw tenantErr;
    tenantId = tenant.id;

    const { data: user, error: userErr } = await client
      .from('users')
      .insert({ tenant_id: tenantId, username: `ecc-p2-3-user-${Date.now()}`, password_hash: 'x' })
      .select()
      .single();
    if (userErr) throw userErr;
    userId = user.id;

    const { data: location, error: locErr } = await client
      .from('locations')
      .insert({ tenant_id: tenantId, code: `p2-3-loc-${Date.now()}`, is_active: true })
      .select()
      .single();
    if (locErr) throw locErr;
    locationId = location.id;

    // identifyUnidentifiedGoods 通过 fn_resolve_exception 关闭异常，要求 resolver 具备
    // inventory_exception/resolve 权限（RBAC）。permissions 是全局表，先查后建避免撞唯一约束。
    let { data: permission } = await client
      .from('permissions')
      .select('id')
      .eq('resource', 'inventory_exception')
      .eq('action', 'resolve')
      .maybeSingle();
    if (!permission) {
      const { data: created, error: permErr } = await client
        .from('permissions')
        .insert({ resource: 'inventory_exception', action: 'resolve' })
        .select()
        .single();
      if (permErr) throw permErr;
      permission = created;
    }

    const { data: role, error: roleErr } = await client
      .from('roles')
      .insert({ tenant_id: tenantId, name: `p2-3-resolver-role-${Date.now()}` })
      .select()
      .single();
    if (roleErr) throw roleErr;

    await client.from('role_permissions').insert({ role_id: role.id, permission_id: permission!.id });
    await client.from('user_roles').insert({ user_id: userId, role_id: role.id });
  });

  afterAll(async () => {
    if (tenantId) await client.from('tenants').delete().eq('id', tenantId);
  });

  const getException = async (exceptionId: string): Promise<{
    exception_type: string;
    status: string;
    resolution_action: string | null;
    details: { qty?: number; pending_inventory_id?: string };
  }> => {
    const { data, error } = await client.from('exceptions').select('*').eq('id', exceptionId).single();
    if (error) throw error;
    return data as unknown as { exception_type: string; status: string; resolution_action: string | null; details: { qty?: number; pending_inventory_id?: string } };
  };

  const getInventory = async (id: string): Promise<{ product_id: string | null; quantity: number }> => {
    const { data, error } = await client.from('inventory').select('*').eq('id', id).single();
    if (error) throw error;
    return data as unknown as { product_id: string | null; quantity: number };
  };

  test('receiveUnidentifiedGoods 应暂存库存（product_id 为 NULL）并登记 UNIDENTIFIED_GOODS 异常', async () => {
    const exceptionId = await repo.receiveUnidentifiedGoods({
      tenantId,
      locationId,
      qty: 10,
      note: 'P2-3 测试：未识别货物',
      actorUserId: userId,
    });

    expect(exceptionId).toBeTruthy();

    const exc = await getException(exceptionId);
    expect(exc.exception_type).toBe('UNIDENTIFIED_GOODS');
    expect(exc.status).toBe('PENDING_REVIEW');
    expect(exc.details.qty).toBe(10);

    const inv = await getInventory(exc.details.pending_inventory_id as string);
    expect(inv.product_id).toBeNull();
    expect(Number(inv.quantity)).toBe(10);
  });

  test('identifyUnidentifiedGoods 应回填 product_id 并通过 fn_resolve_exception 关闭异常', async () => {
    const { data: product, error: productErr } = await client
      .from('products')
      .insert({ tenant_id: tenantId, sku: `p2-3-sku-${Date.now()}`, name: 'P2-3 确认商品' })
      .select()
      .single();
    if (productErr) throw productErr;

    const exceptionId = await repo.receiveUnidentifiedGoods({ tenantId, locationId, qty: 5, actorUserId: userId });
    const success = await repo.identifyUnidentifiedGoods(exceptionId, product.id, userId);

    expect(success).toBe(true);

    const exc = await getException(exceptionId);
    expect(exc.status).toBe('RESOLVED');
    expect(exc.resolution_action).toBe('IDENTIFIED');

    const inv = await getInventory(exc.details.pending_inventory_id as string);
    expect(inv.product_id).toBe(product.id);
  });

  test('findUnidentifiedGoodsExceptions 应按租户+可选状态正确过滤', async () => {
    await repo.receiveUnidentifiedGoods({ tenantId, locationId, qty: 3, actorUserId: userId });

    const all = await repo.findUnidentifiedGoodsExceptions(tenantId);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((e) => e.exception_type === 'UNIDENTIFIED_GOODS')).toBe(true);

    const pending = await repo.findUnidentifiedGoodsExceptions(tenantId, 'PENDING_REVIEW');
    expect(pending.every((e) => e.status === 'PENDING_REVIEW')).toBe(true);
  });

  test('findContainerByException 回归防护：该领域从不创建容器，应恒返回 null 而不是抛错（回归缺陷 1）', async () => {
    const exceptionId = await repo.receiveUnidentifiedGoods({ tenantId, locationId, qty: 1, actorUserId: userId });

    const result = await repo.findContainerByException(exceptionId, tenantId);
    expect(result).toBeNull();
  });

  test('findContainerByLpn / findSystemGeneratedContainers 回归防护：containers 无 tenant_id 列，不应因过滤不存在的列而抛错（回归缺陷 2）', async () => {
    const lpnCode = `p2-3-lpn-${Date.now()}`;
    const created = await repo.createContainer({ lpn_code: lpnCode, lpn_source: 'SYSTEM_GENERATED', status: 'IDLE' });

    const found = await repo.findContainerByLpn(lpnCode);
    expect(found?.id).toBe(created.id);

    const systemGenerated = await repo.findSystemGeneratedContainers();
    expect(systemGenerated.some((c) => c.id === created.id)).toBe(true);

    const notFound = await repo.findContainerByLpn(`nonexistent-${Date.now()}`);
    expect(notFound).toBeNull();
  });
});
