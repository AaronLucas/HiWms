/**
 * Phase 8 集成测试：SupabaseStorageManagementPolicyRepository 正确性验证
 *
 * 覆盖 IStorageManagementPolicyRepository 全部方法：
 * getEffectivePolicy / checkStorageUsage / runMaintenance / create / update / findAll / findByTenant。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start && supabase db reset
 *
 * 默认跳过：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- SupabaseStorageManagementPolicy
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseRpcClient } from '../../../adapters/supabase/rpc/SupabaseRpcClient';
import { SupabaseStorageManagementPolicyRepository } from '../../../adapters/supabase/repositories/SupabaseStorageManagementPolicyRepository';
import type { StorageManagementPolicyInsert } from '../../../core/ports/db/IStorageManagementPolicyRepository';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('SupabaseStorageManagementPolicyRepository 存储策略正确性（Phase 8）', () => {
  let wms: WmsSupabaseClient;
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let repo: SupabaseStorageManagementPolicyRepository;
  let tenantId: string;
  const createdPolicyIds: string[] = [];

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    wms = WmsSupabaseClient.getInstance({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    client = wms.getClient();
    const rpcClient = new SupabaseRpcClient(wms);
    repo = new SupabaseStorageManagementPolicyRepository(wms, rpcClient);

    const { data: tenant } = await client
      .from('tenants')
      .insert({ name: `phase8-policy-tenant-${Date.now()}` })
      .select()
      .single();
    if (!tenant) throw new Error('创建测试租户失败');
    tenantId = tenant.id;
  });

  afterAll(async () => {
    for (const id of createdPolicyIds) {
      await wms.getAdminClient().from('storage_management_policies').delete().eq('id', id);
    }
    await client.from('tenants').delete().eq('id', tenantId);
  });

  test('create：创建存储策略（写路径）', async () => {
    const policy: StorageManagementPolicyInsert = {
      tenant_id: tenantId,
      budget_tier: 'STANDARD',
      hot_retention_days: 30,
      warn_threshold_pct: 70,
      critical_threshold_pct: 90,
      archive_enabled: true,
    };

    const created = await repo.create(policy);
    createdPolicyIds.push(created.id);

    expect(created.id).toBeTruthy();
    expect(created.tenant_id).toBe(tenantId);
    expect(created.budget_tier).toBe('STANDARD');
    expect(created.warn_threshold_pct).toBe(70);
  });

  test('findAll：查找所有存储策略', async () => {
    const all = await repo.findAll();
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  test('findByTenant：按租户查找策略 / 不存在返回 null', async () => {
    const found = await repo.findByTenant(tenantId);
    expect(found).not.toBeNull();
    expect(found!.tenant_id).toBe(tenantId);

    const notFound = await repo.findByTenant('00000000-0000-0000-0000-000000000000');
    expect(notFound).toBeNull();
  });

  test('update：更新存储策略', async () => {
    const existingId = createdPolicyIds[0];
    const updated = await repo.update(existingId, {
      warn_threshold_pct: 75,
      hot_retention_days: 14,
    });

    expect(updated.warn_threshold_pct).toBe(75);
    expect(updated.hot_retention_days).toBe(14);
    expect(updated.critical_threshold_pct).toBe(90);
  });

  test('getEffectivePolicy：获取生效策略（RPC fn_get_storage_policy）', async () => {
    const policy = await repo.getEffectivePolicy(tenantId);
    if (policy) {
      expect(policy).toHaveProperty('warn_threshold_pct');
    }
  });

  test('checkStorageUsage：检查数据库存储用量（RPC fn_check_storage_usage）', async () => {
    const status = await repo.checkStorageUsage();
    expect(status).toHaveProperty('currentSizeBytes');
    expect(status).toHaveProperty('usedPct');
    expect(status).toHaveProperty('status');
    expect(typeof status.currentSizeBytes).toBe('number');
    expect(typeof status.usedPct).toBe('number');
    expect(typeof status.status).toBe('string');
  });

  test('runMaintenance：运行存储维护（RPC fn_run_storage_maintenance）', async () => {
    const result = await repo.runMaintenance();
    expect(typeof result).toBe('string');
  });
});
