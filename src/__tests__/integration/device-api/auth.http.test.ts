/**
 * Device API 认证端点 HTTP 集成测试（Sprint 3 任务 #28）
 * 覆盖 POST /device/auth/login、/device/auth/refresh、/device/provision、
 * /admin/devices/:id/pairing-qr 的真实端到端请求（经过完整的 createDeviceApiApp
 * 中间件链，不像 routes.http.test.ts 那样绕开 DeviceAuthMiddleware）。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start && supabase db reset
 *
 * 默认跳过：RUN_DB_CONCURRENCY_TESTS=true npm run test -- auth.http
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { createSupabaseAdapters, type SupabaseAdapters } from '../../../adapters/supabase';
import { createDeviceApiApp } from '../../../apps/device-api/main';
import type { DeviceApiConfig } from '../../../apps/device-api/config';
import { generateApiKey } from '../../../apps/device-api/auth/device-credentials';
import { createTestUser } from '../helpers/createTestUser';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('device-api 认证端点 HTTP 集成（Sprint 3 #28）', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let adapters: SupabaseAdapters;
  let app: Express;
  let tenantId: string;
  let deviceId: string;
  let apiKeyPlaintext: string;
  let operatorUsername: string;
  const operatorPassword = 'ecc-test-operator-pw-2026';

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    process.env.SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_ANON_KEY = SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SUPABASE_SERVICE_ROLE_KEY;
    process.env.DEVICE_JWT_SECRET ??= 'test-device-jwt-secret-not-for-production-use-only';

    adapters = createSupabaseAdapters({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    client = adapters.client.getAdminClient();

    const { data: tenant, error: tenantErr } = await client
      .from('tenants').insert({ name: `ecc-device-auth-${Date.now()}` }).select().single();
    if (tenantErr) throw tenantErr;
    tenantId = tenant.id;

    deviceId = crypto.randomUUID();
    const { apiKey, secretHash } = await generateApiKey(deviceId, { apiKeyPrefix: 'hiwms_dk' });
    apiKeyPlaintext = apiKey;

    const { error: deviceErr } = await client
      .from('devices').insert({
        id: deviceId,
        tenant_id: tenantId,
        device_code: `ecc-device-auth-${Date.now()}`,
        device_type: 'PDA',
        secret_hash: secretHash,
        is_active: true,
      });
    if (deviceErr) throw deviceErr;

    const config = { supabase: { url: SUPABASE_URL, anonKey: SUPABASE_SERVICE_ROLE_KEY, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY }, server: { port: 0, host: '0.0.0.0' }, device: { jwtSecret: process.env.DEVICE_JWT_SECRET!, jwtIssuer: 'hiwms', jwtAudience: 'hiwms-devices' } } as DeviceApiConfig;
    app = await createDeviceApiApp(config);

    // Sprint 4：操作员签到用的真实测试用户，经真实 auth.users 触发器链路创建
    // （migration 026 后 password_hash 已删除，operator-checkin 改走 Supabase
    // Auth signIn），授予 sync_policy:READ 供本文件"登录→签到→调用业务端点"
    // 的完整链路测试。
    operatorUsername = `ecc-operator-checkin-${Date.now()}`;
    const user = await createTestUser(client, {
      tenantId,
      username: operatorUsername,
      password: operatorPassword,
      isActive: true,
    });

    const { data: role, error: roleErr } = await client
      .from('roles')
      .insert({ tenant_id: tenantId, name: `ecc-operator-role-${Date.now()}` })
      .select()
      .single();
    if (roleErr) throw roleErr;

    const { data: permission, error: permErr } = await client
      .from('permissions')
      .upsert({ resource: 'sync_policy', action: 'READ' }, { onConflict: 'resource,action' })
      .select()
      .single();
    if (permErr) throw permErr;

    const { error: rolePermErr } = await client
      .from('role_permissions')
      .insert({ role_id: role.id, permission_id: permission.id });
    if (rolePermErr) throw rolePermErr;

    const { error: userRoleErr } = await client
      .from('user_roles')
      .insert({ user_id: user.id, role_id: role.id, scope: 'tenant' });
    if (userRoleErr) throw userRoleErr;
  });

  afterAll(async () => {
    if (tenantId) await client.from('tenants').delete().eq('id', tenantId);
  });

  test('POST /api/device/device/auth/login：只带 body 里的 api_key、不带任何认证 header，应该能成功登录（登录本身就是获取凭证的入口，不应该被设备认证中间件挡在门外）', async () => {
    const res = await request(app)
      .post('/api/device/device/auth/login')
      .send({ device_id: deviceId, api_key: apiKeyPlaintext });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.access_token).toBeTypeOf('string');
    expect(res.body.data.refresh_token).toBeTypeOf('string');
  });

  test('POST /api/device/device/auth/login：错误的 api_key 应返回 401', async () => {
    const res = await request(app)
      .post('/api/device/device/auth/login')
      .send({ device_id: deviceId, api_key: 'hiwms_dk_wrong_secret' });

    expect(res.status).toBe(401);
  });

  test('POST /api/device/device/auth/refresh：登录后用 refresh_token 换取新 token 对', async () => {
    const loginRes = await request(app)
      .post('/api/device/device/auth/login')
      .send({ device_id: deviceId, api_key: apiKeyPlaintext });

    const res = await request(app)
      .post('/api/device/device/auth/refresh')
      .send({ refresh_token: loginRes.body.data.refresh_token });

    expect(res.status).toBe(200);
    expect(res.body.data.access_token).toBeTypeOf('string');
  });

  test('POST /api/device/device/auth/refresh：非法 refresh_token 应返回 401', async () => {
    const res = await request(app)
      .post('/api/device/device/auth/refresh')
      .send({ refresh_token: 'not-a-real-token' });

    expect(res.status).toBe(401);
  });

  test('GET /api/device/sync/policy：仅登录（未签到）的 access_token 应返回 401 OPERATOR_CHECKIN_REQUIRED（Sprint 4：登录签发的 token 不带 user_id，RBAC 校验需要操作员身份）', async () => {
    const loginRes = await request(app)
      .post('/api/device/device/auth/login')
      .send({ device_id: deviceId, api_key: apiKeyPlaintext });

    const res = await request(app)
      .get('/api/device/sync/policy')
      .set('Authorization', `Bearer ${loginRes.body.data.access_token}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('OPERATOR_CHECKIN_REQUIRED');
  });

  test('POST /api/device/auth/operator-checkin：正确的 username/password 应返回带 user_id 的新 access_token', async () => {
    const loginRes = await request(app)
      .post('/api/device/device/auth/login')
      .send({ device_id: deviceId, api_key: apiKeyPlaintext });

    const res = await request(app)
      .post('/api/device/auth/operator-checkin')
      .set('Authorization', `Bearer ${loginRes.body.data.access_token}`)
      .send({ username: operatorUsername, password: operatorPassword });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.access_token).toBeTypeOf('string');
    expect(res.body.data.user_id).toBeTypeOf('string');
  });

  test('POST /api/device/auth/operator-checkin：密码错误应返回 401', async () => {
    const loginRes = await request(app)
      .post('/api/device/device/auth/login')
      .send({ device_id: deviceId, api_key: apiKeyPlaintext });

    const res = await request(app)
      .post('/api/device/auth/operator-checkin')
      .set('Authorization', `Bearer ${loginRes.body.data.access_token}`)
      .send({ username: operatorUsername, password: 'wrong-password' });

    expect(res.status).toBe(401);
  });

  test('POST /api/device/auth/operator-checkin：不存在的 username 应返回 401（与密码错误统一响应，防枚举）', async () => {
    const loginRes = await request(app)
      .post('/api/device/device/auth/login')
      .send({ device_id: deviceId, api_key: apiKeyPlaintext });

    const res = await request(app)
      .post('/api/device/auth/operator-checkin')
      .set('Authorization', `Bearer ${loginRes.body.data.access_token}`)
      .send({ username: 'no-such-operator', password: operatorPassword });

    expect(res.status).toBe(401);
  });

  test('GET /api/device/sync/policy：签到后的 access_token（携带 user_id + sync_policy:READ 权限）应能通过 RBAC 校验（验证 verifyDeviceToken 的 tenant_id 提取修复 + Sprint 4 RBAC 全链路）', async () => {
    const loginRes = await request(app)
      .post('/api/device/device/auth/login')
      .send({ device_id: deviceId, api_key: apiKeyPlaintext });

    const checkinRes = await request(app)
      .post('/api/device/auth/operator-checkin')
      .set('Authorization', `Bearer ${loginRes.body.data.access_token}`)
      .send({ username: operatorUsername, password: operatorPassword });

    const res = await request(app)
      .get('/api/device/sync/policy')
      .set('Authorization', `Bearer ${checkinRes.body.data.access_token}`);

    expect(res.status).toBe(200);
  });

  test('GET /api/device/sync/policy：伪造的 access_token（篡改 payload）应返回 401（签名校验仍然有效）', async () => {
    const loginRes = await request(app)
      .post('/api/device/device/auth/login')
      .send({ device_id: deviceId, api_key: apiKeyPlaintext });

    const [headerB64, , signatureB64] = loginRes.body.data.access_token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ device_id: deviceId, tenant_id: 'forged-tenant', type: 'device', exp: Math.floor(Date.now() / 1000) + 900 })).toString('base64url');
    const forgedToken = `${headerB64}.${forgedPayload}.${signatureB64}`;

    const res = await request(app)
      .get('/api/device/sync/policy')
      .set('Authorization', `Bearer ${forgedToken}`);

    expect(res.status).toBe(401);
  });
});
