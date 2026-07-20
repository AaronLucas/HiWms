/**
 * ECC 治理测试补齐：docs/03-database/REPOSITORY_ROADMAP.md §「剩余缺口清单」HIGH 第 4 项。
 *
 * 覆盖缺口：此前所有测试都直接实例化仓储类，从未真正发起过一次 HTTP 请求——仓储层
 * 全绿不代表路由层的序列化/字段映射/校验中间件也是对的（P1 第 2 项就发现过
 * GET /sync/policy 曾把 camelCase 结果对象原样透传，按文档实现的客户端读不到任何字段，
 * 这类问题只有在 HTTP 层才能被测出来）。用 supertest 对 `createDeviceApiRouter` 构造出的
 * 真实 Express Router 发起请求，不 mock 仓储/数据库——路由挂载在真实本地 Postgres 沙盒上，
 * 只是绕开了 `DeviceAuthMiddleware` 的 JWT 解析（那是另一层，不在本文件"路由层"范围内），
 * 改用一个测试专用中间件直接注入 `req.context`。
 *
 * 覆盖范围有意收窄为缺口报告里点名的三个具体场景，不追求覆盖全部 14 个端点：
 *   1. GET /sync/policy 字段映射（P1 第 2 项修复的 HTTP 层回归防护）
 *   2. POST /sync/events 成功/失败两种结果的响应形状（CRITICAL 第 1 项 exceptionId 修复
 *      是否真的传导到了 HTTP 响应）
 *   3. GET /sync/pull 有新事件时应正常返回，不 500
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start
 *   supabase db reset   # 依次应用 001→005 迁移脚本
 *
 * 默认跳过（避免无本地 Supabase 环境时拖垮 `npm run test`/CI）：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- routes.http
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { createSupabaseAdapters, type SupabaseAdapters } from '../../../adapters/supabase';
import { createDeviceApiRouter } from '../../../apps/device-api/routes';
import type { DeviceApiDependencies } from '../../../apps/device-api/di';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// `supabase start` 本地默认 service_role key（非生产密钥，仅用于本地一次性沙盒实例）。
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('device-api routes HTTP 契约正确性（剩余缺口清单 HIGH 第 4 项）', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let adapters: SupabaseAdapters;
  let app: Express;
  let appWithoutContext: Express;
  let tenantId: string;
  let deviceId: string;
  let productId: string;
  let userId: string;

  /**
   * 挂载路由时注入的测试上下文，代替真实 DeviceAuthMiddleware 解析 JWT 得到的结果。
   *
   * 关联备注（供 HIGH 第 3 项——docs/01-architecture/BUG_REPORT_AUTH_TENANT_ISOLATION_2026-07-20.md
   * ——结论出来后回归复查）：这里绕开的是 DeviceAuthMiddleware（device-api 自签 JWT/API Key，
   * 与 Supabase Auth `authenticated` 角色无关），本文件测的是路由层的序列化/校验/响应形状
   * 契约。如果 HIGH 第 3 项的结论最终改变了 device-api 建立租户上下文的方式（例如从
   * "service_role + 应用层过滤" 改为依赖 Postgres RLS + `authenticated` 角色），这里的
   * context 注入方式与本文件全部用例都需要跟着复查是否仍然反映真实的生产鉴权路径。
   */
  const injectContext = (req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { context: Record<string, string> }).context = {
      tenantId,
      deviceId,
      userId,
    };
    next();
  };

  const createLocation = async (): Promise<string> => {
    const { data, error } = await client
      .from('locations')
      .insert({ tenant_id: tenantId, code: `p2-http-loc-${Date.now()}-${Math.random()}`, is_active: true })
      .select()
      .single();
    if (error) throw error;
    return data.id;
  };

  const createContainer = async (locationId: string): Promise<string> => {
    const { data, error } = await client
      .from('containers')
      .insert({ lpn_code: `p2-http-lpn-${Date.now()}-${Math.random()}`, current_location_id: locationId })
      .select()
      .single();
    if (error) throw error;
    return data.id;
  };

  const seedInventory = async (locationId: string, containerId: string, quantity: number): Promise<void> => {
    const { error } = await client
      .from('inventory')
      .insert({ tenant_id: tenantId, product_id: productId, location_id: locationId, container_id: containerId, quantity });
    if (error) throw error;
  };

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    adapters = createSupabaseAdapters({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    client = adapters.client.getClient();

    const { data: tenant, error: tenantErr } = await client
      .from('tenants')
      .insert({ name: `ecc-p2-http-tenant-${Date.now()}` })
      .select()
      .single();
    if (tenantErr) throw tenantErr;
    tenantId = tenant.id;

    const { data: device, error: deviceErr } = await client
      .from('devices')
      .insert({ tenant_id: tenantId, device_code: `ecc-p2-http-device-${Date.now()}`, device_type: 'PDA' })
      .select()
      .single();
    if (deviceErr) throw deviceErr;
    deviceId = device.id;

    const { data: product, error: productErr } = await client
      .from('products')
      .insert({ tenant_id: tenantId, sku: 'P2-HTTP-SKU', name: 'P2 HTTP Test Product' })
      .select()
      .single();
    if (productErr) throw productErr;
    productId = product.id;

    // sync_events.operator_user_id 有外键约束指向 users 表，注入一个真实存在的行，
    // 不能像其他仓储层测试那样随手塞一个 randomUUID()（那些测试没有经过这条会写
    // operator_user_id 的路由代码路径，不会触发这个约束）。
    const { data: user, error: userErr } = await client
      .from('users')
      .insert({ tenant_id: tenantId, username: `ecc-p2-http-user-${Date.now()}`, password_hash: 'x' })
      .select()
      .single();
    if (userErr) throw userErr;
    userId = user.id;

    // 只挂载 routes.ts 本身，不经过 DeviceAuthMiddleware——本文件测的是路由层的
    // 序列化/校验/响应形状契约，不是 JWT 解析（那部分已有独立的
    // src/__tests__/device-api/DeviceAuthMiddleware.test.ts 覆盖）。
    const deps = { supabaseAdapters: adapters } as unknown as DeviceApiDependencies;
    app = express();
    app.use(express.json());
    app.use(injectContext);
    app.use(createDeviceApiRouter(deps));

    appWithoutContext = express();
    appWithoutContext.use(express.json());
    appWithoutContext.use(createDeviceApiRouter(deps));
  });

  afterAll(async () => {
    // tenants 上的外键均为 ON DELETE CASCADE，删除租户即可级联清理 device/product/location/container/inventory/sync_events。
    if (tenantId) await client.from('tenants').delete().eq('id', tenantId);
  });

  test('GET /sync/policy（P1 第 2 项字段映射修复的 HTTP 回归防护）：未配置策略时应返回 snake_case 安全默认值', async () => {
    const res = await request(app).get('/sync/policy');

    expect(res.status).toBe(200);
    // 断言键名本身，而不仅仅是值——如果路由层又开始原样透传 camelCase 对象，
    // 这两个 snake_case key 会不存在，直接暴露"按文档实现的客户端读不到任何字段"的问题。
    expect(res.body).toEqual({ offline_mode: 'ALLOW', max_offline_duration_seconds: 28800 });
    expect(res.body.offlineMode).toBeUndefined();
    expect(res.body.maxOfflineDurationSeconds).toBeUndefined();
  });

  test('POST /sync/events：库存充足的 PICK 事件应成功应用，HTTP 响应体应反映真实结果', async () => {
    const locationId = await createLocation();
    const containerId = await createContainer(locationId);
    await seedInventory(locationId, containerId, 50);

    const eventId = randomUUID();
    const res = await request(app)
      .post('/sync/events')
      .send({
        events: [{
          id: eventId,
          device_id: deviceId,
          device_seq: 1,
          action_type: 'PICK',
          payload: { sku: 'P2-HTTP-SKU', qty: 5, location_id: locationId, container_id: containerId },
          captured_at: new Date().toISOString(),
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);
    expect(res.body.duplicates).toBe(0);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({ event_id: eventId, success: true });

    const { data: row } = await client.from('sync_events').select('status').eq('id', eventId).single();
    expect(row!.status).toBe('APPLIED');
  });

  test('POST /sync/events（CRITICAL 第 1 项 exceptionId 修复的 HTTP 回归防护）：库存不足的事件应在响应体里带上真实 exceptionId，而不是丢在仓储层里', async () => {
    const locationId = await createLocation();
    const containerId = await createContainer(locationId);
    await seedInventory(locationId, containerId, 2);

    const eventId = randomUUID();
    const res = await request(app)
      .post('/sync/events')
      .send({
        events: [{
          id: eventId,
          device_id: deviceId,
          device_seq: 2,
          action_type: 'PICK',
          payload: { sku: 'P2-HTTP-SKU', qty: 999, location_id: locationId, container_id: containerId },
          captured_at: new Date().toISOString(),
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].event_id).toBe(eventId);
    expect(res.body.results[0].success).toBe(false);
    expect(res.body.results[0].exceptionId).toBeTruthy();

    const { data: exceptionRow } = await client
      .from('exceptions')
      .select('id')
      .eq('source_table', 'sync_events')
      .eq('source_id', eventId)
      .single();
    expect(res.body.results[0].exceptionId).toBe(exceptionRow!.id);
  });

  test('GET /sync/pull：拉取已应用事件时应正常返回且不 500，next_cursor 应等于最新 device_seq', async () => {
    const locationId = await createLocation();
    const containerId = await createContainer(locationId);
    await seedInventory(locationId, containerId, 50);

    const eventId = randomUUID();
    const seq = 100;
    const submitRes = await request(app)
      .post('/sync/events')
      .send({
        events: [{
          id: eventId,
          device_id: deviceId,
          device_seq: seq,
          action_type: 'PICK',
          payload: { sku: 'P2-HTTP-SKU', qty: 3, location_id: locationId, container_id: containerId },
          captured_at: new Date().toISOString(),
        }],
      });
    expect(submitRes.body.results[0].success).toBe(true);

    const pullRes = await request(app).get('/sync/pull').query({ since_seq: seq - 1 });

    expect(pullRes.status).toBe(200);
    expect(pullRes.body.next_cursor).toBe(seq);
    expect(pullRes.body.events.map((e: { id: string }) => e.id)).toContain(eventId);
  });

  test('缺少 context（未经过设备认证中间件注入 tenant_id）时应返回 400，而不是把未定义的租户 ID 传给数据库', async () => {
    const res = await request(appWithoutContext).get('/sync/policy');

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});
