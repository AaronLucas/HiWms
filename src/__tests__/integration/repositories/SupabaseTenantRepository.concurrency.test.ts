/**
 * Phase 8 集成测试：SupabaseTenantRepository 正确性验证
 *
 * 覆盖 ITenantRepository 全部方法：CRUD（继承自 SupabaseBaseRepository）
 * + findByName / findActive / updateBillingStrategy。
 * 直接实例化仓储类，验证"已实现未验证"的仓储代码路径本身。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start && supabase db reset
 *
 * 默认跳过：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- SupabaseTenantRepository
 *
 * 认证流程（ADR-015）：
 *   测试通过 createTestUser → signInWithPassword 获得 JWT token，
 *   然后通过 repo 的各方法传入 authToken 参数使用认证客户端，
 *   确保 RLS 策略（id = fn_current_tenant_id()）能正确校验租户上下文。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseTenantRepository } from '../../../adapters/supabase/repositories/SupabaseTenantRepository';
import type { TenantInsert } from '../../../core/ports/db/ITenantRepository';
import type { Database } from '../../../types/database';
import { getAuthenticatedClient } from '../helpers/getAuthenticatedClient';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('SupabaseTenantRepository 租户 CRUD 正确性（Phase 8）', () => {
  let adminClient: SupabaseClient<Database>;
  let wms: WmsSupabaseClient;
  let repo: SupabaseTenantRepository;
  let testAuthToken: string;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    try {
      WmsSupabaseClient.reset();

      console.log('beforeAll: 初始化 adminClient...');
      // 初始化 adminClient（用于创建测试用户）
      adminClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
        db: { schema: 'public' },
      });

      console.log('beforeAll: 初始化 WmsSupabaseClient...');
      // 初始化 WmsSupabaseClient（正确的 anonKey）
      wms = WmsSupabaseClient.getInstance({
        url: SUPABASE_URL,
        anonKey: SUPABASE_ANON_KEY,
        serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
      });

      console.log('beforeAll: 获取认证 token...');
      // 创建测试用户并获取认证 token
      const authResult = await getAuthenticatedClient(adminClient, SUPABASE_URL, SUPABASE_ANON_KEY);
      testAuthToken = authResult.accessToken;

      console.log('beforeAll: 初始化仓储...');
      // 仓储实例（所有操作都会传入 authToken）
      repo = new SupabaseTenantRepository(wms);

      console.log('beforeAll: 完成');
    } catch (e) {
      console.error('beforeAll 失败:', e);
      throw e;
    }
  });

  afterAll(async () => {
    // 使用 service_role 权限清理（绕过 RLS）
    for (const id of createdTenantIds) {
      const { error } = await wms
        .getAdminClient()
        .from('tenants')
        .delete()
        .eq('id', id);
      if (error) console.error(`删除租户 ${id} 失败:`, error);
    }
  });

  test('create：创建新租户并返回完整行', async () => {
    const name = `TEST_TENANT_${randomUUID().slice(0, 8)}`;
    const tenant: TenantInsert = { name };

    const created = await (repo as any).create(tenant, testAuthToken);
    createdTenantIds.push(created.id);

    expect(created.id).toBeTruthy();
    expect(created.name).toBe(name);
    expect(created.is_active).toBe(true);
  });

  test('findById：按 ID 查找租户', async () => {
    const name = `TEST_TENANT_${randomUUID().slice(0, 8)}`;
    const created = await (repo as any).create({ name }, testAuthToken);
    createdTenantIds.push(created.id);

    const found = await repo.findById(created.id, testAuthToken);
    expect(found).not.toBeNull();
    expect(found!.name).toBe(name);

    const notFound = await repo.findById(randomUUID(), testAuthToken);
    expect(notFound).toBeNull();
  });

  test('findByName：按名称查找租户', async () => {
    const name = `TEST_TENANT_${randomUUID().slice(0, 8)}`;
    const created = await (repo as any).create({ name }, testAuthToken);
    createdTenantIds.push(created.id);

    const found = await repo.findByName(name, testAuthToken);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);

    const notFound = await repo.findByName('NONEXISTENT_TENANT_NAME', testAuthToken);
    expect(notFound).toBeNull();
  });

  test('findActive：只返回启用中的租户', async () => {
    const inactiveName = `TEST_INACTIVE_${randomUUID().slice(0, 8)}`;
    const inactive = await (repo as any).create({ name: inactiveName, is_active: false }, testAuthToken);
    createdTenantIds.push(inactive.id);

    const activeName = `TEST_ACTIVE_${randomUUID().slice(0, 8)}`;
    const active = await (repo as any).create({ name: activeName, is_active: true }, testAuthToken);
    createdTenantIds.push(active.id);

    const activeTenants = await repo.findActive(testAuthToken);
    for (const t of activeTenants) {
      expect(t.is_active).toBe(true);
    }
    expect(activeTenants.find((t) => t.id === active.id)).toBeTruthy();
    expect(activeTenants.find((t) => t.id === inactive.id)).toBeUndefined();
  });

  test('update：更新租户字段', async () => {
    const name = `TEST_TENANT_${randomUUID().slice(0, 8)}`;
    const created = await (repo as any).create({ name }, testAuthToken);
    createdTenantIds.push(created.id);

    const newName = `TEST_TENANT_UPDATED_${randomUUID().slice(0, 8)}`;
    const updated = await (repo as any).update(created.id, { name: newName, is_active: false }, testAuthToken);

    expect(updated.name).toBe(newName);
    expect(updated.is_active).toBe(false);
    expect(updated.id).toBe(created.id);
  });

  test('updateBillingStrategy：更新计费策略', async () => {
    const name = `TEST_TENANT_${randomUUID().slice(0, 8)}`;
    const created = await (repo as any).create({ name }, testAuthToken);
    createdTenantIds.push(created.id);

    const strategy = { plan: 'enterprise', monthlyFee: 999, currency: 'USD' };
    const updated = await repo.updateBillingStrategy(created.id, strategy, testAuthToken);

    expect(updated.billing_strategy).toEqual(strategy);
    expect(updated.id).toBe(created.id);

    const found = await repo.findById(created.id, testAuthToken);
    expect(found!.billing_strategy).toEqual(strategy);
  });

  test('delete：删除租户', async () => {
    const name = `TEST_DELETE_${randomUUID().slice(0, 8)}`;
    const created = await (repo as any).create({ name }, testAuthToken);

    await (repo as any).delete(created.id, testAuthToken);

    const found = await repo.findById(created.id, testAuthToken);
    expect(found).toBeNull();
  });

  test('并发创建：不同名称并发创建不冲突', async () => {
    const names = Array.from({ length: 3 }, () => `TEST_CONC_${randomUUID().slice(0, 8)}`);

    const results = await Promise.all(
      names.map((name) => (repo as any).create({ name }, testAuthToken))
    );

    results.forEach((r) => createdTenantIds.push(r.id));

    expect(results).toHaveLength(3);
    const returnedNames = results.map((r) => r.name).sort();
    expect(returnedNames).toEqual(names.sort());
  });
});
