/**
 * 集成测试专用：通过真实 auth.users 触发器链路创建测试用户。
 *
 * migration 026 起 users.id 有指向 auth.users(id) 的外键（新行强制校验），且
 * password_hash 列已删除——裸 `insert into users(...)` 不再可行，必须先有
 * auth.users 记录，走 handle_new_user 触发器联动出 public.users 行。
 *
 * handle_new_user 固定会新建一个租户，如果调用方传入了希望复用的已有
 * tenantId（测试里通常已经在别处建好了租户/设备/角色），这里在触发器完成后
 * 把 public.users.tenant_id 及 app_metadata.tenant_id 都改写指向目标租户，
 * 并清理触发器顺手建出来的多余租户，避免测试数据里堆积孤儿租户。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';

type UserRow = Database['public']['Tables']['users']['Row'];

export async function createTestUser(
  adminClient: SupabaseClient<Database>,
  opts: { tenantId?: string; username?: string; role?: string; isActive?: boolean; password?: string } = {}
): Promise<UserRow> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `ecc-test-${suffix}@ecc-test.invalid`;

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password: opts.password ?? 'Ecc-Test-Password-2026!',
    email_confirm: true,
    user_metadata: {
      company_name: `ecc-test-tenant-${suffix}`,
      username: opts.username ?? email,
    },
  });
  if (createErr || !created.user) {
    throw createErr ?? new Error('adminClient.auth.admin.createUser 未返回 user');
  }
  const userId = created.user.id;
  const autoCreatedTenantId = created.user.app_metadata?.tenant_id as string | undefined;

  const patch: Partial<UserRow> = {};
  if (opts.role) patch.role = opts.role;
  if (opts.isActive !== undefined) patch.is_active = opts.isActive;

  if (opts.tenantId && opts.tenantId !== autoCreatedTenantId) {
    patch.tenant_id = opts.tenantId;
    await adminClient.auth.admin.updateUserById(userId, {
      app_metadata: { tenant_id: opts.tenantId },
    });
    if (autoCreatedTenantId) {
      await adminClient.from('tenants').delete().eq('id', autoCreatedTenantId);
    }
  }

  if (Object.keys(patch).length > 0) {
    const { error: patchErr } = await adminClient.from('users').update(patch).eq('id', userId);
    if (patchErr) throw patchErr;
  }

  const { data: row, error: fetchErr } = await adminClient
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  if (fetchErr || !row) {
    throw fetchErr ?? new Error(`createTestUser: 创建后查不到 users 行 id=${userId}`);
  }
  return row;
}
