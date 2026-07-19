/**
 * ECC 治理 Phase 5/6/7 测试补齐（docs/03-database/REPOSITORY_ROADMAP.md P1 第 3 项）：
 * `SupabaseMissingLabelRepository` / `fn_generate_internal_lpn` / `fn_confirm_label_applied`
 * 正确性验证。
 *
 * === 可达性核查（测试方法论第 6 步）===
 * `generateInternalLpn`/`confirmLabelApplied` 是**真实生产路径**：
 * `src/apps/device-api/routes.ts` 的 `POST /missing-label/generate`/`POST /missing-label/confirm`
 * 直接调用它们。`findContainerByLpn`/`findSystemGeneratedContainers`/`createContainer` 目前
 * 没有任何真实调用方（与 P0 第 3 项 PackingTaskItemRepository 同类，属于尚未接入路由的
 * 应用层代码），但仍按既定优先级补齐测试。
 *
 * === 发现并修复的真实缺陷（纯 TS 应用层代码，未触碰任何 .sql 文件）===
 *
 * `findContainerByLpn`/`findSystemGeneratedContainers` 原实现对 `containers` 表做
 * `.eq('tenant_id', tenantId)` 过滤，但 `containers` 表本身**没有 `tenant_id` 列**
 * （已用 `psql \d containers` 核实：该表只有 id/lpn_code/parent_container_id/
 * container_type/current_location_id/is_sealed/last_opened_at/status/created_at/
 * updated_at/lpn_source，无 tenant_id，也没有 RLS 策略——库存的租户隔离是通过
 * `inventory.tenant_id`/`inventory.container_id` 间接表达的，容器本身是跨租户共享
 * 的资源标识）。过滤一个不存在的列会被 PostgREST 拒绝为查询错误，两个方法此前**每次
 * 调用必定抛异常**，不是边界情况。同样的 bug 也存在于 `SupabaseUnidentifiedGoodsRepository`
 * 里（复制粘贴导致），留给 P2 对应项处理。
 * 修复：`IMissingLabelRepository`/`SupabaseMissingLabelRepository` 去掉这两个方法上
 * 从未真实生效过的 `tenantId` 参数，改为不做租户过滤（如实反映 `containers` 的真实
 * 设计）。
 *
 * === 一个记录在案、本次不处理的开放行为（不是本次修复范围内的 bug）===
 * `fn_generate_internal_lpn` 对同一个 `exception_id` 重复调用没有幂等保护：每次调用
 * 都无条件新建一个 `containers` 行并把 `exceptions.details.generated_lpn`/
 * `generated_container_id` 整体覆盖为最新一次的值——旧的那次生成的容器会变成孤儿
 * （不再被任何 `details` 引用，`fn_confirm_label_applied` 也只认最新一次生成的码）。
 * `.readonly/unWMS_Tracking_Policy_Missing_Label_V1.md` 设计文档描述的是"生成→打印→
 * 扫码确认"的一次性流程，未明确讨论重复调用场景，这是设计意图未覆盖的开放问题，不是
 * "实现和设计意图对不上"的确定性 bug（按测试方法论第 5 步的区分标准）。下方用一个测试
 * 如实记录当前行为，供后续如需补充幂等保护时参考，不在本次范围内推动 `.sql` 改动。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset   # 依次应用 001→004 迁移脚本
 *
 * 默认跳过（避免无本地 Supabase 环境时拖垮 `npm run test`/CI）：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- fn_generate_internal_lpn
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseRpcClient } from '../../../adapters/supabase/rpc/SupabaseRpcClient';
import { SupabaseMissingLabelRepository } from '../../../adapters/supabase/repositories/SupabaseMissingLabelRepository';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// `supabase start` 本地默认 service_role key（非生产密钥，仅用于本地一次性沙盒实例）。
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('SupabaseMissingLabelRepository 漏码闭环正确性（Phase 5/6/7 P1 第 3 项）', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let repo: SupabaseMissingLabelRepository;
  let tenantId: string;
  let userId: string;

  const createMissingLabelException = async (): Promise<string> => {
    const { data, error } = await client
      .from('exceptions')
      .insert({
        tenant_id: tenantId,
        exception_type: 'MISSING_LABEL',
        domain: 'INVENTORY',
        severity: 'MEDIUM',
        status: 'PENDING_REVIEW',
        title: 'P1-3 测试：入库现场缺码',
      })
      .select()
      .single();
    if (error) throw error;
    return data.id;
  };

  const getException = async (exceptionId: string): Promise<{
    status: string;
    resolution_action: string | null;
    details: { generated_lpn?: string; generated_container_id?: string };
  }> => {
    const { data, error } = await client.from('exceptions').select('*').eq('id', exceptionId).single();
    if (error) throw error;
    return data as unknown as { status: string; resolution_action: string | null; details: { generated_lpn?: string; generated_container_id?: string } };
  };

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    const wms = WmsSupabaseClient.getInstance({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    client = wms.getClient();
    repo = new SupabaseMissingLabelRepository(wms, new SupabaseRpcClient(wms));

    const { data: tenant, error: tenantErr } = await client
      .from('tenants')
      .insert({ name: `ecc-p1-3-tenant-${Date.now()}` })
      .select()
      .single();
    if (tenantErr) throw tenantErr;
    tenantId = tenant.id;

    const { data: user, error: userErr } = await client
      .from('users')
      .insert({ tenant_id: tenantId, username: `ecc-p1-3-user-${Date.now()}`, password_hash: 'x' })
      .select()
      .single();
    if (userErr) throw userErr;
    userId = user.id;

    // fn_confirm_label_applied 通过 fn_resolve_exception 关闭异常，要求 resolver 具备
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
      .insert({ tenant_id: tenantId, name: `p1-3-resolver-role-${Date.now()}` })
      .select()
      .single();
    if (roleErr) throw roleErr;

    await client.from('role_permissions').insert({ role_id: role.id, permission_id: permission!.id });
    await client.from('user_roles').insert({ user_id: userId, role_id: role.id });
  });

  afterAll(async () => {
    if (tenantId) await client.from('tenants').delete().eq('id', tenantId);
  });

  test('generateInternalLpn 生成符合格式的内部码，创建 SYSTEM_GENERATED 容器，并把生成事件记入 details/exception_events', async () => {
    // Arrange
    const exceptionId = await createMissingLabelException();

    // Act
    const lpn = await repo.generateInternalLpn(exceptionId, userId);

    // Assert：格式 INT-{YYYYMMDD}-{8位十六进制}
    expect(lpn).toMatch(/^INT-\d{8}-[0-9a-f]{8}$/);

    const container = await repo.findContainerByLpn(lpn);
    expect(container).not.toBeNull();
    expect(container?.lpn_source).toBe('SYSTEM_GENERATED');
    expect(container?.status).toBe('IDLE');

    const exc = await getException(exceptionId);
    expect(exc.details.generated_lpn).toBe(lpn);
    expect(exc.details.generated_container_id).toBe(container?.id);
    expect(exc.status).toBe('PENDING_REVIEW'); // 生成阶段异常尚未关闭

    const { data: events } = await client.from('exception_events').select('*').eq('exception_id', exceptionId);
    expect(events?.some((e: { event_type: string }) => e.event_type === 'COMMENT')).toBe(true);
  });

  test('findContainerByLpn / findSystemGeneratedContainers 回归防护：containers 无 tenant_id 列，不应因过滤不存在的列而抛错', async () => {
    // Arrange
    const exceptionId = await createMissingLabelException();
    const lpn = await repo.generateInternalLpn(exceptionId, userId);

    // Act + Assert：此前的实现会在这里抛 PostgREST 列不存在错误
    const found = await repo.findContainerByLpn(lpn);
    expect(found?.lpn_code).toBe(lpn);

    const systemGenerated = await repo.findSystemGeneratedContainers();
    expect(systemGenerated.some((c) => c.lpn_code === lpn)).toBe(true);

    const notFound = await repo.findContainerByLpn(`nonexistent-lpn-${Date.now()}`);
    expect(notFound).toBeNull();
  });

  test('confirmLabelApplied 扫码一致时应确认成功并通过 fn_resolve_exception 关闭异常', async () => {
    // Arrange
    const exceptionId = await createMissingLabelException();
    const lpn = await repo.generateInternalLpn(exceptionId, userId);

    // Act
    const success = await repo.confirmLabelApplied(exceptionId, userId, lpn);

    // Assert
    expect(success).toBe(true);
    const exc = await getException(exceptionId);
    expect(exc.status).toBe('RESOLVED');
    expect(exc.resolution_action).toBe('LABEL_APPLIED_CONFIRMED');

    const container = await repo.findContainerByLpn(lpn);
    expect(container?.is_sealed).toBe(true);
  });

  test('confirmLabelApplied 扫码与生成码不一致时应拒绝（防止贴错箱子）', async () => {
    // Arrange
    const exceptionId = await createMissingLabelException();
    await repo.generateInternalLpn(exceptionId, userId);

    // Act + Assert
    await expect(repo.confirmLabelApplied(exceptionId, userId, 'INT-WRONG-CODE')).rejects.toThrow();

    const exc = await getException(exceptionId);
    expect(exc.status).toBe('PENDING_REVIEW'); // 拒绝后异常不应被误关闭
  });

  test('confirmLabelApplied 在尚未 generateInternalLpn 时调用应拒绝', async () => {
    // Arrange
    const exceptionId = await createMissingLabelException();

    // Act + Assert
    await expect(repo.confirmLabelApplied(exceptionId, userId, 'INT-ANY-CODE')).rejects.toThrow();
  });

  test('createContainer 应正确创建容器记录', async () => {
    const lpnCode = `ecc-p1-3-manual-${Date.now()}`;
    const created = await repo.createContainer({ lpn_code: lpnCode, lpn_source: 'EXTERNAL', status: 'IDLE' });
    expect(created.lpn_code).toBe(lpnCode);

    const found = await repo.findContainerByLpn(lpnCode);
    expect(found?.id).toBe(created.id);
  });

  test('记录在案：对同一 exception_id 重复调用 generateInternalLpn 当前不做幂等保护（开放问题，非本次范围内 bug，见文件头部说明）', async () => {
    // Arrange
    const exceptionId = await createMissingLabelException();

    // Act：连续两次生成
    const firstLpn = await repo.generateInternalLpn(exceptionId, userId);
    const secondLpn = await repo.generateInternalLpn(exceptionId, userId);

    // Assert：如实记录当前行为——两次各自创建了独立的容器，details 只保留最新一次
    expect(firstLpn).not.toBe(secondLpn);
    const firstContainer = await repo.findContainerByLpn(firstLpn);
    const secondContainer = await repo.findContainerByLpn(secondLpn);
    expect(firstContainer).not.toBeNull(); // 第一次生成的容器仍然存在，但已成为孤儿
    expect(secondContainer).not.toBeNull();

    const exc = await getException(exceptionId);
    expect(exc.details.generated_lpn).toBe(secondLpn); // details 只指向最新一次

    // 用第一次生成的码去确认会失败——扫到的码与（已被覆盖的）最新期望码不一致
    await expect(repo.confirmLabelApplied(exceptionId, userId, firstLpn)).rejects.toThrow();
    // 只有用最新一次生成的码才能确认成功
    const success = await repo.confirmLabelApplied(exceptionId, userId, secondLpn);
    expect(success).toBe(true);
  });
});
