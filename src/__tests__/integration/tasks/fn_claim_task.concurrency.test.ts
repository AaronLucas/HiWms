/**
 * ECC 治理 Phase 5/6/7 测试补齐（docs/03-database/REPOSITORY_ROADMAP.md P0 第 1 项）：
 * `SupabaseTaskClaimRepository` / `fn_claim_task` 竞争性任务租约正确性验证。
 *
 * 覆盖缺口：与 `fn_adjust_inventory_at_location`（AGENTS.md §8.4 试点）同类的"读改写竞态"
 * 风险类型——多台设备同时抢同一个工单时，必须保证有且仅有一个领用成功。此处的并发安全
 * 依赖点不是 `SELECT ... FOR UPDATE`，而是 `task_claims` 表上的部分唯一索引
 * `uq_task_claims_active (work_order_id) WHERE status = 'ACTIVE'`（见
 * supabase/migrations/002_offline_sync_exception_domain.sql）。本测试直接实例化仓储类
 * `SupabaseTaskClaimRepository`（而非绕过仓储直接调 RPC），验证的是"已实现未验证"的仓储
 * 代码路径本身，而不仅仅是底层数据库函数。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset   # 依次应用 001→004 迁移脚本
 *
 * 默认跳过（避免无本地 Supabase 环境时拖垮 `npm run test`/CI）：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- fn_claim_task
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseRpcClient } from '../../../adapters/supabase/rpc/SupabaseRpcClient';
import { SupabaseTaskClaimRepository } from '../../../adapters/supabase/repositories/SupabaseTaskClaimRepository';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// `supabase start` 本地默认 service_role key（非生产密钥，仅用于本地一次性沙盒实例）。
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('SupabaseTaskClaimRepository 竞争性任务领用正确性（Phase 5/6/7 P0）', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let repo: SupabaseTaskClaimRepository;
  let tenantId: string;
  const userIds: string[] = [];
  const deviceIds: string[] = [];

  const createWorkOrder = async (): Promise<string> => {
    const { data, error } = await client
      .from('work_orders')
      .insert({ tenant_id: tenantId, task_type: 'PICK', status: 'OPEN' })
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
    repo = new SupabaseTaskClaimRepository(wms, new SupabaseRpcClient(wms));

    const { data: tenant, error: tenantErr } = await client
      .from('tenants')
      .insert({ name: `ecc-p0-tenant-${Date.now()}` })
      .select()
      .single();
    if (tenantErr) throw tenantErr;
    tenantId = tenant.id;

    for (let i = 0; i < 6; i++) {
      const { data: user, error: userErr } = await client
        .from('users')
        .insert({ tenant_id: tenantId, username: `ecc-p0-user-${i}-${Date.now()}`, password_hash: 'x' })
        .select()
        .single();
      if (userErr) throw userErr;
      userIds.push(user.id);

      const { data: device, error: deviceErr } = await client
        .from('devices')
        .insert({ tenant_id: tenantId, device_code: `ecc-p0-device-${i}-${Date.now()}`, device_type: 'PDA' })
        .select()
        .single();
      if (deviceErr) throw deviceErr;
      deviceIds.push(device.id);
    }
  });

  afterAll(async () => {
    // tenants 上的外键均为 ON DELETE CASCADE，删除租户即可级联清理 user/device/work_order/task_claims。
    if (tenantId) await client.from('tenants').delete().eq('id', tenantId);
  });

  test('对同一工单并发发起 5 个领用请求时，有且仅有 1 个成功，其余因唯一约束被拒绝', async () => {
    // Arrange
    const workOrderId = await createWorkOrder();

    // Act：5 个不同设备/用户真正并发发起领用（Promise.all，非串行伪并发）
    const results = await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        repo.claimTask({
          workOrderId,
          userId: userIds[i],
          deviceId: deviceIds[i],
          leaseSeconds: 300,
        })
      )
    );

    // Assert
    const successes = results.filter((r) => r?.success === true);
    const failures = results.filter((r) => r?.success === false);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(4);
    for (const failure of failures) {
      expect(failure?.message).toBe('该任务已被其他设备领用，请稍后重试或联系主管');
    }

    const { data: activeRows, error } = await client
      .from('task_claims')
      .select('id')
      .eq('work_order_id', workOrderId)
      .eq('status', 'ACTIVE');
    expect(error).toBeNull();
    expect(activeRows).toHaveLength(1); // 全程只应有一行 ACTIVE 租约，不应出现并发重复领用
  });

  test('释放租约后，唯一约束应当放行下一次领用', async () => {
    // Arrange：先由 user[0]/device[0] 领用成功
    const workOrderId = await createWorkOrder();
    const claimed = await repo.claimTask({
      workOrderId,
      userId: userIds[0],
      deviceId: deviceIds[0],
      leaseSeconds: 300,
    });
    expect(claimed?.success).toBe(true);
    expect(claimed?.claimId).toBeTruthy();

    // Act：释放后由 user[1]/device[1] 再次领用
    const released = await repo.releaseTaskClaim(claimed!.claimId);
    const reclaimed = await repo.claimTask({
      workOrderId,
      userId: userIds[1],
      deviceId: deviceIds[1],
      leaseSeconds: 300,
    });

    // Assert
    expect(released).toBe(true);
    expect(reclaimed?.success).toBe(true);
    expect(reclaimed?.claimId).not.toBe(claimed!.claimId);
  });

  test('findActiveByWorkOrder / findActiveByUser 仅返回状态为 ACTIVE 的租约，释放后应查不到', async () => {
    // Arrange
    const workOrderId = await createWorkOrder();
    const claimed = await repo.claimTask({
      workOrderId,
      userId: userIds[2],
      deviceId: deviceIds[2],
      leaseSeconds: 300,
    });
    expect(claimed?.success).toBe(true);

    // Act + Assert：领用中——应能查到
    const activeByWorkOrder = await repo.findActiveByWorkOrder(workOrderId, tenantId);
    const activeByUser = await repo.findActiveByUser(userIds[2], tenantId);
    expect(activeByWorkOrder?.id).toBe(claimed!.claimId);
    expect(activeByUser.map((c) => c.id)).toContain(claimed!.claimId);

    // Act + Assert：释放后——不应再查到
    await repo.releaseTaskClaim(claimed!.claimId);
    const afterRelease = await repo.findActiveByWorkOrder(workOrderId, tenantId);
    const afterReleaseByUser = await repo.findActiveByUser(userIds[2], tenantId);
    expect(afterRelease).toBeNull();
    expect(afterReleaseByUser.map((c) => c.id)).not.toContain(claimed!.claimId);
  });

  test('expireTaskClaims 应将已到期的 ACTIVE 租约清扫为 EXPIRED，并将未完成工单标记为 EXCEPTION', async () => {
    // Arrange：以负租期直接产生一个"已过期"的领用记录（work_order 保持默认 OPEN 状态）
    const workOrderId = await createWorkOrder();
    const claimed = await repo.claimTask({
      workOrderId,
      userId: userIds[3],
      deviceId: deviceIds[3],
      leaseSeconds: -60,
    });
    expect(claimed?.success).toBe(true);

    // Act
    await repo.expireTaskClaims();

    // Assert：本条租约与其工单状态均已被清扫函数更新
    const { data: claimRow, error: claimErr } = await client
      .from('task_claims')
      .select('status')
      .eq('id', claimed!.claimId)
      .single();
    expect(claimErr).toBeNull();
    expect(claimRow!.status).toBe('EXPIRED');

    const { data: workOrderRow, error: woErr } = await client
      .from('work_orders')
      .select('status')
      .eq('id', workOrderId)
      .single();
    expect(woErr).toBeNull();
    expect(workOrderRow!.status).toBe('EXCEPTION');
  });
});
