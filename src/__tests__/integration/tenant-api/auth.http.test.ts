/**
 * Tenant API 认证端点 HTTP 契约测试（ROADMAP 6.2 + 5.4）
 * 覆盖 POST /auth/login（方案 B 代理登录）、PATCH /api/users/me/password（自助改密码）。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset
 *
 * 默认跳过：RUN_DB_CONCURRENCY_TESTS=true npm run test -- tenant-api/auth.http
 */
import { beforeAll, describe, expect, test } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { createSupabaseAdapters, type SupabaseAdapters } from '../../../adapters/supabase';
import { createTenantApiApp } from '../../../apps/tenant-api/main';
import { loadTenantApiConfig } from '../../../apps/tenant-api/config';
import { createTestUser } from '../helpers/createTestUser';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

process.env.SUPABASE_URL ??= SUPABASE_URL;
process.env.SUPABASE_ANON_KEY ??=
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= SUPABASE_SERVICE_ROLE_KEY;

const TEST_PASSWORD = 'Ecc-Test-Password-2026!';

describe.skipIf(!RUN)('tenant-api /auth/login + /api/users/me/password HTTP 契约', () => {
  let adapters: SupabaseAdapters;
  let app: Express;
  let testEmail: string;

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    adapters = createSupabaseAdapters({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });

    const user = await createTestUser(adapters.client.getAdminClient(), { password: TEST_PASSWORD });
    testEmail = user.email!;

    app = await createTenantApiApp(loadTenantApiConfig());
  });

  test('密码错误应返回 401', async () => {
    const res = await request(app).post('/auth/login').send({ email: testEmail, password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  test('登录成功后应能自助改密码，且新旧密码立刻互换生效', async () => {
    const loginRes = await request(app).post('/auth/login').send({ email: testEmail, password: TEST_PASSWORD });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
    const accessToken = loginRes.body.data.accessToken as string;
    expect(accessToken).toBeTypeOf('string');

    const newPassword = 'Ecc-Test-Password-Changed-2026!';
    const changeRes = await request(app)
      .patch('/api/users/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ newPassword });
    expect(changeRes.status).toBe(200);
    expect(changeRes.body.success).toBe(true);

    const oldPasswordLogin = await request(app).post('/auth/login').send({ email: testEmail, password: TEST_PASSWORD });
    expect(oldPasswordLogin.status).toBe(401);

    const newPasswordLogin = await request(app).post('/auth/login').send({ email: testEmail, password: newPassword });
    expect(newPasswordLogin.status).toBe(200);
  });
});
