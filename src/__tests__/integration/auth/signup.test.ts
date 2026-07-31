/**
 * SupabaseAuthProvider.signUp() 集成测试
 *
 * 回归覆盖：signUp() 内部轮询 public.users.tenant_id 时必须用 adminClient
 * （service_role）查询，而不是匿名单例 this.client——匿名角色下
 * fn_current_tenant_id() 恒为 NULL，RLS 会让查询结果永远为空，导致
 * app_metadata.tenant_id 从未被写入，signUp() 返回的 tenantId 恒为 null。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset
 *
 * 默认跳过：RUN_DB_CONCURRENCY_TESTS=true npm run test -- signup.test
 */
import { describe, test, expect } from 'vitest';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { createSupabaseAdapters, type SupabaseAdapters } from '../../../adapters/supabase';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('SupabaseAuthProvider.signUp()', () => {
  test('注册成功后，返回的 tenantId 非空，且已正确写入 app_metadata.tenant_id', async () => {
    WmsSupabaseClient.reset();
    const adapters: SupabaseAdapters = createSupabaseAdapters({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });

    const email = `ecc-signup-test-${Date.now()}@ecc-test.invalid`;
    const result = await adapters.auth.provider.signUp(email, 'Ecc-Test-Password-2026!', {
      company_name: `ecc-signup-tenant-${Date.now()}`,
    });

    expect(result).not.toBeNull();
    expect(result!.tenantId).toBeTypeOf('string');
    expect(result!.tenantId).not.toBeNull();

    const admin = adapters.client.getAdminClient();
    const { data: authUser } = await admin.auth.admin.getUserById(result!.userId);
    expect(authUser.user?.app_metadata?.tenant_id).toBe(result!.tenantId);

    await admin.from('tenants').delete().eq('id', result!.tenantId!);
  });
});
