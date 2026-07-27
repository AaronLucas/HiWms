/**
 * Tenant API 商品端点 HTTP 契约测试（Sprint 2.4 / 2.7）
 * 覆盖 GET /api/products（含 ?q= 搜索）、GET /api/products/:id 的 happy path + error path。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset
 *
 * 默认跳过：RUN_DB_CONCURRENCY_TESTS=true npm run test -- products.http
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { createSupabaseAdapters, type SupabaseAdapters } from '../../../adapters/supabase';
import { createTenantApiRouter } from '../../../apps/tenant-api/routes';
import type { TenantApiDependencies } from '../../../apps/tenant-api/di';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('tenant-api /api/products HTTP 契约', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let adapters: SupabaseAdapters;
  let app: Express;
  let tenantId: string;
  let otherTenantId: string;
  let productId: string;

  const injectContext = (tid: string) => (req: Request, _res: Response, next: NextFunction) => {
    req.context = {
      user: { id: randomUUID(), tenantId: tid, isSystemUser: false, roles: [], permissions: [] },
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
      .from('tenants').insert({ name: `ecc-tenant-api-prod-${Date.now()}` }).select().single();
    if (tenantErr) throw tenantErr;
    tenantId = tenant.id;

    const { data: otherTenant, error: otherErr } = await client
      .from('tenants').insert({ name: `ecc-tenant-api-prod-other-${Date.now()}` }).select().single();
    if (otherErr) throw otherErr;
    otherTenantId = otherTenant.id;

    const { data: product, error: productErr } = await client
      .from('products').insert({ tenant_id: tenantId, sku: 'TENANT-API-SEARCHABLE-WIDGET', name: 'Searchable Widget' }).select().single();
    if (productErr) throw productErr;
    productId = product.id;

    const deps = { supabaseAdapters: adapters } as unknown as TenantApiDependencies;
    app = express();
    app.use(express.json());
    app.use(injectContext(tenantId));
    app.use('/api', createTenantApiRouter(deps));
  });

  afterAll(async () => {
    if (tenantId) await client.from('tenants').delete().eq('id', tenantId);
    if (otherTenantId) await client.from('tenants').delete().eq('id', otherTenantId);
  });

  test('GET /api/products：应返回当前租户商品列表', async () => {
    const res = await request(app).get('/api/products');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.some((p: { id: string }) => p.id === productId)).toBe(true);
  });

  test('GET /api/products?q=：应按名称模糊搜索', async () => {
    const res = await request(app).get('/api/products').query({ q: 'Searchable' });

    expect(res.status).toBe(200);
    expect(res.body.data.some((p: { id: string }) => p.id === productId)).toBe(true);
  });

  test('GET /api/products：非法 limit（超出最大值）应返回 422', async () => {
    const res = await request(app).get('/api/products').query({ limit: '9999' });
    expect(res.status).toBe(422);
  });

  test('GET /api/products?q=：含 PostgREST 过滤语法保留字符（逗号/括号）的搜索词应返回 422（ECC review 发现的 or() 过滤注入面，收窄为安全字符集）', async () => {
    const res = await request(app).get('/api/products').query({ q: 'a),or(tenant_id.neq.x' });
    expect(res.status).toBe(422);
  });

  test('GET /api/products/:id：应返回单个商品', async () => {
    const res = await request(app).get(`/api/products/${productId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(productId);
  });

  test('GET /api/products/:id：不存在的商品应返回 404', async () => {
    const res = await request(app).get(`/api/products/${randomUUID()}`);
    expect(res.status).toBe(404);
  });

  test('GET /api/products/:id：跨租户访问应返回 404（应用层防御性隔离）', async () => {
    const { data: otherProduct, error } = await client
      .from('products').insert({ tenant_id: otherTenantId, sku: 'OTHER-TENANT-PRODUCT', name: 'Other Tenant Product' }).select().single();
    if (error) throw error;

    const res = await request(app).get(`/api/products/${otherProduct.id}`);
    expect(res.status).toBe(404);
  });
});
