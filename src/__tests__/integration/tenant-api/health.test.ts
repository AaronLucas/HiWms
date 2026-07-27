/**
 * Tenant API 骨架冒烟测试：验证 createTenantApiApp 能正常组装并响应 /health。
 * 不触发任何 Supabase 网络调用（/health 不查库），因此无需本地 Supabase 即可运行。
 */
import { describe, expect, test } from 'vitest';
import request from 'supertest';
import { createTenantApiApp } from '../../../apps/tenant-api/main';
import { loadTenantApiConfig } from '../../../apps/tenant-api/config';

process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ??= 'test-anon-key';

describe('tenant-api /health', () => {
  test('responds 200 with service metadata', async () => {
    const config = loadTenantApiConfig();
    const app = await createTenantApiApp(config);

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'tenant-api' });
  });
});
