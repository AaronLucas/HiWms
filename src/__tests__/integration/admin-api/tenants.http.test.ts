/**
 * Admin API 租户管理端点 HTTP 契约测试
 * 覆盖 POST /api/admin/tenants：新建租户后必须自动初始化默认 ADMIN 角色 + RBAC 权限
 * （fn_provision_tenant_defaults，迁移 024），否则该租户挂不上任何角色/权限。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset
 *
 * 默认跳过：RUN_DB_CONCURRENCY_TESTS=true npm run test -- admin-api/tenants.http
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import request from 'supertest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Express } from 'express';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { createSupabaseAdapters, type SupabaseAdapters } from '../../../adapters/supabase';
import { createAdminApiApp } from '../../../apps/admin-api/main';
import { createTestUser } from '../helpers/createTestUser';
import type { Database } from '../../../types/database';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('admin-api POST /api/admin/tenants HTTP 契约', () => {
  let adapters: SupabaseAdapters;
  let app: Express;
  let platformAdminToken: string;
  let createdTenantId: string;

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    adapters = createSupabaseAdapters({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    const adminClient = adapters.client.getAdminClient();

    const platformAdmin = await createTestUser(adminClient, { isSystemUser: true });

    // 注意：登录必须用独立的匿名 client，不能复用 adminClient——supabase-js 的
    // auth.signInWithPassword() 会把调用它的那个 client 实例的内部会话状态从
    // service_role 篡改成登录用户的 authenticated 身份，导致 adminClient 后续
    // 查询也被 RLS 拦截（本文件早期版本踩过这个坑，排查记录见 PR 描述）。
    const anonSignInClient: SupabaseClient<Database> = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data: signIn, error } = await anonSignInClient.auth.signInWithPassword({
      email: platformAdmin.email!,
      password: 'Ecc-Test-Password-2026!',
    });
    if (error || !signIn.session) throw error ?? new Error('平台超管测试账号登录失败');
    platformAdminToken = signIn.session.access_token;

    app = await createAdminApiApp({
      supabase: { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY },
    });
  });

  afterAll(async () => {
    if (createdTenantId) {
      await adapters.client.getAdminClient().from('tenants').delete().eq('id', createdTenantId);
    }
  });

  test('新建租户后应自动挂载默认 ADMIN 角色 + RBAC 权限', async () => {
    const res = await request(app)
      .post('/api/admin/tenants')
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({ name: `ecc-admin-api-tenant-${Date.now()}`, is_active: true });

    expect(res.status).toBe(201);
    createdTenantId = res.body.id;
    expect(createdTenantId).toBeTypeOf('string');

    const adminClient = adapters.client.getAdminClient();
    const { data: role, error: roleErr } = await adminClient
      .from('roles')
      .select('id')
      .eq('tenant_id', createdTenantId)
      .eq('name', 'ADMIN')
      .single();
    expect(roleErr).toBeNull();
    expect(role).not.toBeNull();

    const { data: rolePerms, error: rolePermsErr } = await adminClient
      .from('role_permissions')
      .select('permission_id')
      .eq('role_id', role!.id);
    expect(rolePermsErr).toBeNull();
    expect(rolePerms!.length).toBeGreaterThan(0);
  });
});
