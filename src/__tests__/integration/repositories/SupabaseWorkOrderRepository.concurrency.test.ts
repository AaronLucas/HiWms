/**
 * Phase 8 集成测试：SupabaseWorkOrderRepository 正确性验证
 *
 * 覆盖 IWorkOrderRepository 全部方法：
 *   CRUD（create/findById/update/delete）+
 *   findByOrder / findByWave / findByParent / findByAssignee / findPendingDispatch /
 *   updateStatus / logAction / updateActionLog / getActionLogsByWorkOrder /
 *   getActionLogsByOperator / getExceptionLogs
 *
 * 直接实例化仓储类，验证"已实现未验证"的仓储代码路径本身。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start && supabase db reset
 *
 * 默认跳过：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- SupabaseWorkOrderRepository
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'crypto';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseWorkOrderRepository } from '../../../adapters/supabase/repositories/SupabaseWorkOrderRepository';
import { createTestUser } from '../helpers/createTestUser';
import type { WorkOrderInsert } from '../../../core/ports/db/IWorkOrderRepository';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('SupabaseWorkOrderRepository 工单 CRUD 正确性（Phase 8）', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let repo: SupabaseWorkOrderRepository;
  let tenantId: string;
  let orderId: string;
  let waveId: string;
  let userId: string;
  const createdWorkOrderIds: string[] = [];
  const createdActionLogIds: number[] = [];

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    const wms = WmsSupabaseClient.getInstance({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    client = wms.getClient();
    repo = new SupabaseWorkOrderRepository(wms);

    const { data: tenant, error: tenantError } = await client
      .from('tenants')
      .insert({ name: `phase8-wo-tenant-${Date.now()}` })
      .select()
      .single();
    if (tenantError || !tenant) throw tenantError ?? new Error('创建测试租户失败');
    tenantId = tenant.id;

    const { data: order, error: orderError } = await client
      .from('orders')
      .insert({
        tenant_id: tenantId,
        external_order_id: `PHASE8-ORDER-${randomUUID().slice(0, 8)}`,
        order_type: 'OUTBOUND',
      })
      .select()
      .single();
    if (orderError || !order) throw orderError ?? new Error('创建测试订单失败');
    orderId = order.id;

    const { data: wave, error: waveError } = await client
      .from('waves')
      .insert({
        tenant_id: tenantId,
        wave_no: `PHASE8-WAVE-${randomUUID().slice(0, 8)}`,
        status: 'PLANNING',
      })
      .select()
      .single();
    if (waveError || !wave) throw waveError ?? new Error('创建测试波次失败');
    waveId = wave.id;

    const user = await createTestUser(client, { tenantId, username: `phase8-wo-user-${randomUUID().slice(0, 8)}` });
    userId = user.id;
  });

  afterAll(async () => {
    for (const logId of createdActionLogIds) {
      await client.from('wo_action_logs').delete().eq('log_id', logId);
    }
    // 反向删除：确保子工单（parent_wo_id 引用）先于父工单删除
    for (const id of [...createdWorkOrderIds].reverse()) {
      await client.from('work_orders').delete().eq('id', id);
    }
    await client.from('waves').delete().eq('id', waveId);
    await client.from('orders').delete().eq('id', orderId);
    await client.from('users').delete().eq('id', userId);
    await client.from('tenants').delete().eq('id', tenantId);
  });

  test('create：创建新工单并返回完整行', async () => {
    const wo: WorkOrderInsert = {
      tenant_id: tenantId,
      task_type: 'PICK',
      status: 'OPEN',
    };

    const created = await repo.create(wo);
    createdWorkOrderIds.push(created.id);

    expect(created.id).toBeTruthy();
    expect(created.tenant_id).toBe(tenantId);
    expect(created.task_type).toBe('PICK');
    expect(created.status).toBe('OPEN');
  });

  test('findById：按 ID 查找工单', async () => {
    const created = await repo.create({
      tenant_id: tenantId,
      task_type: 'PACK',
      status: 'OPEN',
    });
    createdWorkOrderIds.push(created.id);

    const found = await repo.findById(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.task_type).toBe('PACK');
  });

  test('findByOrder：按关联订单查找工单', async () => {
    const created = await repo.create({
      tenant_id: tenantId,
      related_order_id: orderId,
      task_type: 'PICK',
    });
    createdWorkOrderIds.push(created.id);

    const found = await repo.findByOrder(orderId);
    expect(found.length).toBeGreaterThanOrEqual(1);
    for (const wo of found) {
      expect(wo.related_order_id).toBe(orderId);
    }
    expect(found.some((wo) => wo.id === created.id)).toBe(true);
  });

  test('findByWave：按波次查找工单', async () => {
    const created = await repo.create({
      tenant_id: tenantId,
      wave_id: waveId,
      task_type: 'PICK',
    });
    createdWorkOrderIds.push(created.id);

    const found = await repo.findByWave(waveId);
    expect(found.length).toBeGreaterThanOrEqual(1);
    for (const wo of found) {
      expect(wo.wave_id).toBe(waveId);
    }
    expect(found.some((wo) => wo.id === created.id)).toBe(true);
  });

  test('findByParent：按父工单查找子工单', async () => {
    const parent = await repo.create({
      tenant_id: tenantId,
      task_type: 'PICK',
      status: 'OPEN',
    });
    createdWorkOrderIds.push(parent.id);

    const child = await repo.create({
      tenant_id: tenantId,
      parent_wo_id: parent.id,
      task_type: 'PICK',
      status: 'OPEN',
    });
    createdWorkOrderIds.push(child.id);

    const found = await repo.findByParent(parent.id);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe(child.id);
  });

  test('findByAssignee：按分配用户（可选状态过滤）查找工单', async () => {
    const created = await repo.create({
      tenant_id: tenantId,
      assigned_user_id: userId,
      task_type: 'PICK',
      status: 'ASSIGNED',
    });
    createdWorkOrderIds.push(created.id);

    const all = await repo.findByAssignee(userId);
    expect(all.some((wo) => wo.id === created.id)).toBe(true);

    const filtered = await repo.findByAssignee(userId, 'ASSIGNED');
    expect(filtered.some((wo) => wo.id === created.id)).toBe(true);
    for (const wo of filtered) {
      expect(wo.status).toBe('ASSIGNED');
    }

    const nonMatching = await repo.findByAssignee(userId, 'COMPLETED');
    expect(nonMatching.some((wo) => wo.id === created.id)).toBe(false);
  });

  // 修复记录：SupabaseWorkOrderRepository.findPendingDispatch() 原硬编码
  // .eq('status', 'pending')，但 work_orders 表的 chk_work_orders_status
  // check constraint 只允许 OPEN/ASSIGNED/IN_PROGRESS/COMPLETED/EXCEPTION/CANCELLED
  // （无 'pending'/'PENDING'），该方法对任何租户永远返回空数组。已修复为
  // status='OPEN'（语义上"待派发"= 刚创建、尚未分配用户）。
  // 见 src/adapters/supabase/repositories/SupabaseWorkOrderRepository.ts:34-40。
  test('findPendingDispatch：查找待派发工单', async () => {
    const created = await repo.create({
      tenant_id: tenantId,
      task_type: 'PICK',
      status: 'OPEN',
    });
    createdWorkOrderIds.push(created.id);

    const pending = await repo.findPendingDispatch(tenantId);
    expect(pending.some((wo) => wo.id === created.id)).toBe(true);
    for (const wo of pending) {
      expect(wo.tenant_id).toBe(tenantId);
      expect(wo.status).toBe('OPEN');
    }
  });

  test('updateStatus：更新工单状态', async () => {
    const created = await repo.create({
      tenant_id: tenantId,
      task_type: 'PICK',
      status: 'OPEN',
    });
    createdWorkOrderIds.push(created.id);

    const updated = await repo.updateStatus(created.id, 'ASSIGNED');
    expect(updated.id).toBe(created.id);
    expect(updated.status).toBe('ASSIGNED');
  });

  test('update：更新工单其他字段', async () => {
    const created = await repo.create({
      tenant_id: tenantId,
      task_type: 'PICK',
      status: 'OPEN',
    });
    createdWorkOrderIds.push(created.id);

    const updated = await repo.update(created.id, {
      pda_summary: 'phase8-summary',
      expected_duration_seconds: 120,
    });

    expect(updated.pda_summary).toBe('phase8-summary');
    expect(updated.expected_duration_seconds).toBe(120);
  });

  test('delete：删除工单', async () => {
    const created = await repo.create({
      tenant_id: tenantId,
      task_type: 'PICK',
      status: 'OPEN',
    });

    await repo.delete(created.id);

    const found = await repo.findById(created.id);
    expect(found).toBeNull();
  });

  test('logAction / updateActionLog / getActionLogsByWorkOrder：动作日志读写', async () => {
    const wo = await repo.create({
      tenant_id: tenantId,
      task_type: 'PICK',
      status: 'OPEN',
    });
    createdWorkOrderIds.push(wo.id);

    const log1 = await repo.logAction({
      wo_id: wo.id,
      action_type: 'PICK',
      qty_acted: 5,
      start_at: new Date(Date.now() - 60_000).toISOString(),
    });
    createdActionLogIds.push(log1.log_id);
    expect(log1.log_id).toBeTruthy();
    expect(log1.wo_id).toBe(wo.id);
    expect(log1.action_type).toBe('PICK');
    expect(log1.qty_acted).toBe(5);

    const log2 = await repo.logAction({
      wo_id: wo.id,
      action_type: 'PACK',
      qty_acted: 3,
      start_at: new Date().toISOString(),
    });
    createdActionLogIds.push(log2.log_id);

    const updated = await repo.updateActionLog(log1.log_id, {
      end_at: new Date().toISOString(),
      captured_data: { note: 'phase8-test' },
    });
    expect(updated.log_id).toBe(log1.log_id);
    expect(updated.end_at).not.toBeNull();
    expect(updated.captured_data).toEqual({ note: 'phase8-test' });

    const logs = await repo.getActionLogsByWorkOrder(wo.id);
    expect(logs).toHaveLength(2);
    const logIds = logs.map((l) => l.log_id).sort();
    expect(logIds).toEqual([log1.log_id, log2.log_id].sort());
  });

  test('getActionLogsByOperator：按操作员和时间范围获取动作日志', async () => {
    const wo = await repo.create({
      tenant_id: tenantId,
      assigned_user_id: userId,
      task_type: 'PICK',
      status: 'OPEN',
    });
    createdWorkOrderIds.push(wo.id);

    const startAt = new Date();
    const log = await repo.logAction({
      wo_id: wo.id,
      action_type: 'PICK',
      qty_acted: 1,
      start_at: startAt.toISOString(),
    });
    createdActionLogIds.push(log.log_id);

    const dateFrom = new Date(startAt.getTime() - 60_000);
    const dateTo = new Date(startAt.getTime() + 60_000);

    const logs = await repo.getActionLogsByOperator(userId, dateFrom, dateTo);
    expect(logs.some((l) => l.log_id === log.log_id)).toBe(true);

    const outOfRange = await repo.getActionLogsByOperator(
      userId,
      new Date(startAt.getTime() - 3_600_000),
      new Date(startAt.getTime() - 1_800_000)
    );
    expect(outOfRange.some((l) => l.log_id === log.log_id)).toBe(false);
  });

  test('getExceptionLogs：获取异常动作日志', async () => {
    const wo = await repo.create({
      tenant_id: tenantId,
      task_type: 'PICK',
      status: 'OPEN',
    });
    createdWorkOrderIds.push(wo.id);

    const startAt = new Date();
    const exceptionLog = await repo.logAction({
      wo_id: wo.id,
      action_type: 'EXCEPTION',
      start_at: startAt.toISOString(),
      captured_data: { reason: 'phase8-test-exception' },
    });
    createdActionLogIds.push(exceptionLog.log_id);

    const normalLog = await repo.logAction({
      wo_id: wo.id,
      action_type: 'PICK',
      start_at: startAt.toISOString(),
    });
    createdActionLogIds.push(normalLog.log_id);

    const dateFrom = new Date(startAt.getTime() - 60_000);
    const dateTo = new Date(startAt.getTime() + 60_000);

    const exceptionLogs = await repo.getExceptionLogs(tenantId, dateFrom, dateTo);
    expect(exceptionLogs.some((l) => l.log_id === exceptionLog.log_id)).toBe(true);
    expect(exceptionLogs.some((l) => l.log_id === normalLog.log_id)).toBe(false);
    for (const l of exceptionLogs) {
      expect(l.action_type).toBe('EXCEPTION');
    }
  });

  test('并发更新：不同工单的状态并发更新互不干扰', async () => {
    const workOrders = await Promise.all(
      Array.from({ length: 3 }, () =>
        repo.create({
          tenant_id: tenantId,
          task_type: 'PICK',
          status: 'OPEN',
        })
      )
    );
    workOrders.forEach((wo) => createdWorkOrderIds.push(wo.id));

    const targetStatuses = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED'];
    const results = await Promise.all(
      workOrders.map((wo, i) => repo.updateStatus(wo.id, targetStatuses[i]!))
    );

    results.forEach((r, i) => {
      expect(r.id).toBe(workOrders[i]!.id);
      expect(r.status).toBe(targetStatuses[i]);
    });

    for (let i = 0; i < workOrders.length; i++) {
      const found = await repo.findById(workOrders[i]!.id);
      expect(found!.status).toBe(targetStatuses[i]);
    }
  });
});
