/**
 * Tenant API 波次端点 HTTP 契约测试（Sprint 2.5 / 2.7）
 * 覆盖 GET /api/waves、POST /api/waves/generate 的 happy path + error path。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset
 *
 * 默认跳过：RUN_DB_CONCURRENCY_TESTS=true npm run test -- waves.http
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { createSupabaseAdapters, type SupabaseAdapters } from '../../../adapters/supabase';
import { createTenantApiRouter } from '../../../apps/tenant-api/routes';
import { ExpressMiddlewareFactory } from '../../../adapters/express/ExpressMiddlewareFactory';
import { createTestUser } from '../helpers/createTestUser';
import type { TenantApiDependencies } from '../../../apps/tenant-api/di';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('tenant-api /api/waves HTTP 契约', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let adapters: SupabaseAdapters;
  let app: Express;
  let tenantId: string;
  let productId: string;
  let orderId: string;
  let userId: string;

  const injectContext = (tid: string) => (req: Request, _res: Response, next: NextFunction) => {
    req.context = {
      // ADR-016：requirePermission() 不再对 isSystemUser 硬编码放行，这里改为携带
      // beforeAll 中挂好真实 waves READ/CREATE 权限的测试账号。
      user: { id: userId, tenantId: tid, isSystemUser: false, roles: [], permissions: [] },
      tenantId: tid,
      correlationId: `test-${Date.now()}`,
    };
    next();
  };

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    adapters = createSupabaseAdapters({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    client = adapters.client.getAdminClient();

    const { data: tenant, error: tenantErr } = await client
      .from('tenants').insert({ name: `ecc-tenant-api-waves-${Date.now()}` }).select().single();
    if (tenantErr) throw tenantErr;
    tenantId = tenant.id;

    const { data: product, error: productErr } = await client
      .from('products').insert({ tenant_id: tenantId, sku: 'TENANT-API-WAVES-SKU', name: 'Tenant API Waves Test Product' }).select().single();
    if (productErr) throw productErr;
    productId = product.id;

    const { data: order, error: orderErr } = await client
      .from('orders').insert({ tenant_id: tenantId, external_order_id: `WAVE-ORDER-${Date.now()}`, order_type: 'outbound', status: 'PENDING' }).select().single();
    if (orderErr) throw orderErr;
    orderId = order.id;

    const user = await createTestUser(client, { tenantId, username: `ecc-tenant-api-waves-user-${Date.now()}` });
    userId = user.id;

    const { data: role, error: roleErr } = await client
      .from('roles')
      .insert({ tenant_id: tenantId, name: `ecc-tenant-api-waves-role-${Date.now()}` })
      .select()
      .single();
    if (roleErr) throw roleErr;

    const { data: permissions, error: permErr } = await client
      .from('permissions')
      .upsert([
        { resource: 'waves', action: 'READ' },
        { resource: 'waves', action: 'CREATE' },
      ], { onConflict: 'resource,action' })
      .select();
    if (permErr) throw permErr;

    const { error: rolePermErr } = await client
      .from('role_permissions')
      .insert(permissions!.map(p => ({ role_id: role.id, permission_id: p.id })));
    if (rolePermErr) throw rolePermErr;

    const { error: userRoleErr } = await client
      .from('user_roles')
      .insert({ user_id: userId, role_id: role.id, scope: 'tenant' });
    if (userRoleErr) throw userRoleErr;

    const middlewareFactory = new ExpressMiddlewareFactory(
      adapters.auth.provider,
      adapters.auth.permissionChecker,
      adapters.auth.tenantResolver,
      adapters.cache.provider,
      adapters.cache.keyBuilder
    );
    const deps = { supabaseAdapters: adapters, middlewareFactory } as unknown as TenantApiDependencies;
    app = express();
    app.use(express.json());
    app.use(injectContext(tenantId));
    app.use('/api', createTenantApiRouter(deps));
  });

  afterAll(async () => {
    if (tenantId) await client.from('tenants').delete().eq('id', tenantId);
  });

  test('POST /api/waves/generate：合法请求应生成波次并返回 201', async () => {
    const res = await request(app)
      .post('/api/waves/generate')
      .send({ strategyType: 'batch', orderIds: [orderId] });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.waveId).toBeTypeOf('string');
    expect(res.body.data.orderCount).toBe(1);

    const { data: row } = await client.from('waves').select('status, tenant_id').eq('id', res.body.data.waveId).single();
    expect(row!.status).toBe('PLANNING');
    expect(row!.tenant_id).toBe(tenantId);
  });

  test('POST /api/waves/generate：缺少 orderIds 应返回 422', async () => {
    const res = await request(app)
      .post('/api/waves/generate')
      .send({ strategyType: 'batch', orderIds: [] });

    expect(res.status).toBe(422);
  });

  test('POST /api/waves/generate：非法 strategyType 应返回 422', async () => {
    const res = await request(app)
      .post('/api/waves/generate')
      .send({ strategyType: 'not-a-real-strategy', orderIds: [orderId] });

    expect(res.status).toBe(422);
  });

  test('GET /api/waves：应返回当前租户波次列表', async () => {
    const res = await request(app).get('/api/waves');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.every((w: { tenant_id: string }) => w.tenant_id === tenantId)).toBe(true);
  });

  test('GET /api/waves：非法 status 枚举值应返回 422', async () => {
    const res = await request(app).get('/api/waves').query({ status: 'NOT_A_REAL_STATUS' });
    expect(res.status).toBe(422);
  });

  test('GET /api/waves：小写 strategyType 应返回 422（ECC review 发现：waves.strategy_type 存的是大写值，过滤条件大小写必须一致）', async () => {
    const res = await request(app).get('/api/waves').query({ strategyType: 'batch' });
    expect(res.status).toBe(422);
  });

  test('GET /api/waves?strategyType=BATCH：应按策略类型过滤（与生成波次时写入的大写值一致）', async () => {
    const res = await request(app).get('/api/waves').query({ strategyType: 'BATCH' });

    expect(res.status).toBe(200);
    expect(res.body.data.every((w: { strategy_type: string }) => w.strategy_type === 'BATCH')).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});
