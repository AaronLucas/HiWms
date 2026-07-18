/**
 * ECC 治理 Phase 5 测试补齐（docs/03-database/REPOSITORY_ROADMAP.md Phase 5 第 5 项）：
 * `SupabaseExceptionRepository` / `fn_resolve_exception` 正确性验证。
 *
 * 触发原因：给 SyncEventRepository 补测试时（P0 第 2 项），核对 DBA 团队新交付的
 * `005_concurrency_hardening_V1.sql`（给 `fn_resolve_exception` 加了 FOR UPDATE 并发保护）
 * 顺带查了一下它在 TS 层的调用方，发现 `IExceptionRepository.ts` 的 `ExceptionStatus`
 * 类型（`OPEN/INVESTIGATING/RESOLVED/CLOSED/ESCALATED`）跟 `exceptions.status` 真实的
 * `chk_exceptions_status` CHECK 约束（`PENDING_REVIEW/CONFLICT/RESOLVED/DISMISSED`，已用
 * `psql \d`/`pg_constraint` 核实）几乎完全对不上，是跟本文件之前修的 SyncEventStatus
 * 同一类问题（TS 端口接口与真实 schema 契约不一致）。顺着查代码，又额外发现两处独立缺陷：
 *
 * - `escalateException()` 写入 `'ESCALATED'`，不是合法 CHECK 值，必定抛约束违反错误。
 *   已修复：exceptions.status 的状态机里没有独立的 ESCALATED 值，"升级"就是转移到
 *   CONFLICT（见 unWMS_Offline_Sync_Exception_Domain_V1.md §4.2）。
 * - `resolveException()` 硬编码 `p_resolution_details: {resolution}`，永远不包含
 *   `fn_confirm_inventory_recount` 需要的 `confirmed_available_qty` key，导致 INVENTORY_SHORTAGE
 *   类异常"确认解决"后，异常状态变成 RESOLVED，但库存数字从未被真正修正——这正是 DBA
 *   自查清单第 8 条警告的"函数返回成功但业务表其实没联动"，只看 exceptions 表会误以为
 *   一切正常。已修复：`resolveException()` 开放 `resolutionDetails` 透传口子。
 * - `confirmInventoryRecount()` 之前直接调 `fn_confirm_inventory_recount`（绕开
 *   `fn_resolve_exception`，没有权限校验、没有状态转移到 RESOLVED、没有审计轨迹），且传的
 *   JSON key 是 `recount_qty`，跟该函数实际读取的 `confirmed_available_qty` 对不上，两个
 *   独立原因导致库存都不会被真正调整。已修复：改为委托给 `resolveException()`。
 *
 * 本文件按 `.readonly/unWMS_PR_Pre_Submission_Checklist_V1.md` 第 8 条的要求测三段：
 * ① 异常正确触发且分类正确；② 无权限用户尝试恢复被拒绝；③ 授权后恢复成功，且相关业务表
 * （这里是 inventory）的状态确实按预期变化，不是只看 exceptions.status 变成 RESOLVED。
 * 另外覆盖 fn_resolve_exception 新加的并发保护（并发确认同一条异常应有且仅有一次生效）。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset   # 依次应用 001→005 迁移脚本
 *
 * 默认跳过（避免无本地 Supabase 环境时拖垮 `npm run test`/CI）：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- fn_resolve_exception
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseRpcClient } from '../../../adapters/supabase/rpc/SupabaseRpcClient';
import { SupabaseExceptionRepository } from '../../../adapters/supabase/repositories/SupabaseExceptionRepository';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// `supabase start` 本地默认 service_role key（非生产密钥，仅用于本地一次性沙盒实例）。
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('SupabaseExceptionRepository 统一异常领域正确性（Phase 5 第 5 项）', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let repo: SupabaseExceptionRepository;
  let tenantId: string;
  let productId: string;
  let locationId: string;
  let containerId: string;
  let authorizedUserId: string;
  let unauthorizedUserId: string;

  const getInventoryQty = async (): Promise<number> => {
    const { data, error } = await client
      .from('inventory')
      .select('quantity')
      .eq('product_id', productId)
      .eq('location_id', locationId)
      .eq('container_id', containerId)
      .single();
    if (error) throw error;
    return Number(data!.quantity);
  };

  const raiseInventoryShortage = async (): Promise<string> => {
    const exception = await repo.raiseException({
      tenantId,
      typeCode: 'INVENTORY_SHORTAGE',
      severity: 'HIGH',
      title: '库存不足测试异常',
      relatedEntityType: 'inventory',
      // 不传 relatedEntityId：验证 raiseException 不会因为 UUID 参数传空字符串而报错
      context: { sku: 'EXC-TEST-SKU', order_line_id: null },
    });
    return exception.id;
  };

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    const wms = WmsSupabaseClient.getInstance({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    client = wms.getClient();
    repo = new SupabaseExceptionRepository(wms, new SupabaseRpcClient(wms));

    const { data: tenant, error: tenantErr } = await client
      .from('tenants')
      .insert({ name: `ecc-exc-tenant-${Date.now()}` })
      .select()
      .single();
    if (tenantErr) throw tenantErr;
    tenantId = tenant.id;

    const { data: product, error: productErr } = await client
      .from('products')
      .insert({ tenant_id: tenantId, sku: 'EXC-TEST-SKU', name: 'Exception Test Product' })
      .select()
      .single();
    if (productErr) throw productErr;
    productId = product.id;

    const { data: location, error: locationErr } = await client
      .from('locations')
      .insert({ tenant_id: tenantId, code: `exc-loc-${Date.now()}`, is_active: true })
      .select()
      .single();
    if (locationErr) throw locationErr;
    locationId = location.id;

    const { data: container, error: containerErr } = await client
      .from('containers')
      .insert({ lpn_code: `exc-lpn-${Date.now()}`, current_location_id: locationId })
      .select()
      .single();
    if (containerErr) throw containerErr;
    containerId = container.id;

    await client.from('inventory').insert({
      tenant_id: tenantId,
      product_id: productId,
      location_id: locationId,
      container_id: containerId,
      quantity: 50,
    });

    const { data: authUser, error: authUserErr } = await client
      .from('users')
      .insert({ tenant_id: tenantId, username: `exc-auth-user-${Date.now()}`, password_hash: 'x' })
      .select()
      .single();
    if (authUserErr) throw authUserErr;
    authorizedUserId = authUser.id;

    const { data: unauthUser, error: unauthUserErr } = await client
      .from('users')
      .insert({ tenant_id: tenantId, username: `exc-unauth-user-${Date.now()}`, password_hash: 'x' })
      .select()
      .single();
    if (unauthUserErr) throw unauthUserErr;
    unauthorizedUserId = unauthUser.id;

    // permissions 是全局表（不带 tenant_id），先查后建，避免和其他并行测试撞唯一约束
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
      .insert({ tenant_id: tenantId, name: `exc-resolver-role-${Date.now()}` })
      .select()
      .single();
    if (roleErr) throw roleErr;

    await client.from('role_permissions').insert({ role_id: role.id, permission_id: permission!.id });
    await client.from('user_roles').insert({ user_id: authorizedUserId, role_id: role.id });
    // unauthorizedUserId 故意不挂任何角色/权限
  });

  afterAll(async () => {
    // tenants 上的外键均为 ON DELETE CASCADE，删除租户即可级联清理 product/location/container/
    // inventory/users/roles/user_roles/role_permissions/exceptions/exception_events。
    // permissions 是全局表，不属于本租户资源，不清理（保留供后续测试复用）。
    if (tenantId) await client.from('tenants').delete().eq('id', tenantId);
  });

  test('① raiseException：正确触发 INVENTORY_SHORTAGE 异常，分类/严重度正确，relatedEntityId 缺省时不报 UUID 错误', async () => {
    // Act
    const exception = await repo.raiseException({
      tenantId,
      typeCode: 'INVENTORY_SHORTAGE',
      severity: 'HIGH',
      title: '独立触发测试',
      // 故意不传 relatedEntityId / relatedEntityType，验证不会因为把 '' 当 UUID 传给
      // p_source_id 而报 "invalid input syntax for type uuid" 错误
    });

    // Assert
    expect(exception.id).toBeTruthy();
    expect(exception.exception_type).toBe('INVENTORY_SHORTAGE');
    expect(exception.domain).toBe('INVENTORY');
    expect(exception.status).toBe('PENDING_REVIEW');
  });

  test('② 无权限用户尝试 resolveException 应被拒绝，不改变异常状态', async () => {
    // Arrange
    const exceptionId = await raiseInventoryShortage();

    // Act + Assert
    await expect(
      repo.resolveException({
        exceptionId,
        tenantId,
        resolvedBy: unauthorizedUserId,
        resolution: '未授权尝试',
        actionTaken: 'ATTEMPT',
      })
    ).rejects.toThrow();

    const { data: row } = await client.from('exceptions').select('status').eq('id', exceptionId).single();
    expect(row!.status).toBe('PENDING_REVIEW');
  });

  test('③ 授权后 resolveException 成功：状态变 RESOLVED，且库存按 confirmed_available_qty 真正修正（完整闭环，不只看 exceptions 表）', async () => {
    // Arrange：当前库存 50，模拟盘点确认真实可用数量是 35
    const exceptionId = await raiseInventoryShortage();
    expect(await getInventoryQty()).toBe(50);

    // Act
    const resolved = await repo.confirmInventoryRecount({
      exceptionId,
      tenantId,
      confirmedBy: authorizedUserId,
      recountQty: 35,
      notes: '盘点复核确认',
    });

    // Assert：exceptions 表状态正确
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolved_by).toBe(authorizedUserId);
    // resolution_notes 应该存人工可读的说明文本，不是内部动作码
    // 'INVENTORY_RECOUNT_CONFIRMED'（之前这里两个参数传反了）
    expect(resolved.resolution_notes).toBe('盘点复核确认');

    // Assert：业务表（inventory）真的联动变化了，不是只有 exceptions.status 变绿
    expect(await getInventoryQty()).toBe(35);

    // Assert：审计轨迹正确记录（RAISED + RESOLVED 两条）
    const events = await repo.getExceptionEvents(exceptionId, tenantId);
    expect(events.map((e) => e.event_type)).toEqual(expect.arrayContaining(['RAISED', 'RESOLVED']));
  });

  test('confirmInventoryRecount：对非 INVENTORY_SHORTAGE 类型的异常应显式拒绝，不能静默 no-op', async () => {
    // Arrange：MANUAL_REVIEW 类型没有 fn_confirm_inventory_recount 联动
    const nonInventoryException = await repo.raiseException({
      tenantId,
      typeCode: 'MANUAL_REVIEW',
      severity: 'LOW',
      title: '非库存类异常',
    });

    // Act + Assert
    await expect(
      repo.confirmInventoryRecount({
        exceptionId: nonInventoryException.id,
        tenantId,
        confirmedBy: authorizedUserId,
        recountQty: 10,
      })
    ).rejects.toThrow();

    // 应该维持 PENDING_REVIEW，不能被误判为"已确认"
    const { data: row } = await client.from('exceptions').select('status').eq('id', nonInventoryException.id).single();
    expect(row!.status).toBe('PENDING_REVIEW');
  });

  test('并发：两个授权用户同时 resolveException 同一条异常，应有且仅有一次生效', async () => {
    // Arrange
    const exceptionId = await raiseInventoryShortage();

    // Act：真正并发（Promise.all）
    const results = await Promise.allSettled([
      repo.resolveException({ exceptionId, tenantId, resolvedBy: authorizedUserId, resolution: 'A', actionTaken: 'A' }),
      repo.resolveException({ exceptionId, tenantId, resolvedBy: authorizedUserId, resolution: 'B', actionTaken: 'B' }),
    ]);

    // Assert：一个成功，一个失败（fn_resolve_exception 的 FOR UPDATE + 状态重新校验拦下）
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Assert：exception_events 精确只有 2 条（RAISED + 一条 RESOLVED），不是 3 条
    const events = await repo.getExceptionEvents(exceptionId, tenantId);
    expect(events).toHaveLength(2);
    expect(events.filter((e) => e.event_type === 'RESOLVED')).toHaveLength(1);
  });

  test('escalateException：应转移到 CONFLICT，且不允许升级已 RESOLVED 的异常', async () => {
    // Arrange
    const exceptionId = await raiseInventoryShortage();

    // Act + Assert：正常升级
    const escalated = await repo.escalateException(exceptionId, tenantId, authorizedUserId, '情况复杂需要主管介入');
    expect(escalated.status).toBe('CONFLICT');
    expect(escalated.assigned_to).toBe(authorizedUserId);

    // Act + Assert：已解决的异常不应该能再被升级
    await repo.resolveException({ exceptionId, tenantId, resolvedBy: authorizedUserId, resolution: 'ok', actionTaken: 'ok' });
    await expect(
      repo.escalateException(exceptionId, tenantId, authorizedUserId, '重复升级')
    ).rejects.toThrow();
  });

  test('countByStatus：正确统计各真实状态值的数量', async () => {
    // Arrange：全新租户级隔离范围，避免与其他用例的异常互相干扰计数
    const { data: statsTenant, error: tenantErr } = await client
      .from('tenants')
      .insert({ name: `ecc-exc-stats-tenant-${Date.now()}` })
      .select()
      .single();
    if (tenantErr) throw tenantErr;

    try {
      await repo.raiseException({ tenantId: statsTenant.id, typeCode: 'MANUAL_REVIEW', severity: 'LOW', title: 'A' });
      await repo.raiseException({ tenantId: statsTenant.id, typeCode: 'MANUAL_REVIEW', severity: 'LOW', title: 'B' });
      const toResolve = await repo.raiseException({ tenantId: statsTenant.id, typeCode: 'MANUAL_REVIEW', severity: 'LOW', title: 'C' });
      await client.from('exceptions').update({ status: 'RESOLVED' }).eq('id', toResolve.id);
      const toDismiss = await repo.raiseException({ tenantId: statsTenant.id, typeCode: 'MANUAL_REVIEW', severity: 'LOW', title: 'D' });
      await client.from('exceptions').update({ status: 'DISMISSED' }).eq('id', toDismiss.id);

      // Act
      const stats = await repo.countByStatus(statsTenant.id);

      // Assert
      expect(stats).toEqual({ PENDING_REVIEW: 2, CONFLICT: 0, RESOLVED: 1, DISMISSED: 1 });
    } finally {
      await client.from('tenants').delete().eq('id', statsTenant.id);
    }
  });
});
