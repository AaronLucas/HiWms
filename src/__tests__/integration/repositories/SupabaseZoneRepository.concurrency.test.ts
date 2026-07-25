/**
 * Phase 8 集成测试：SupabaseZoneRepository 正确性验证
 *
 * 覆盖 IZoneRepository 全部方法：CRUD + findByCode / findByTenant / findActive。
 * 直接实例化仓储类，验证"已实现未验证"的仓储代码路径本身。
 *
 * 运行前置条件（本地一次性 Docker Postgres，不连接生产库）：
 *   supabase start && supabase db reset
 *
 * 默认跳过：
 *   RUN_DB_CONCURRENCY_TESTS=true npm run test -- SupabaseZoneRepository
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'crypto';
import { WmsSupabaseClient } from '../../../adapters/supabase/SupabaseClient';
import { SupabaseZoneRepository } from '../../../adapters/supabase/repositories/SupabaseZoneRepository';
import type { ZoneInsert } from '../../../core/ports/db/IZoneRepository';

const RUN = process.env.RUN_DB_CONCURRENCY_TESTS === 'true';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe.skipIf(!RUN)('SupabaseZoneRepository 库区 CRUD 正确性（Phase 8）', () => {
  let client: ReturnType<WmsSupabaseClient['getClient']>;
  let repo: SupabaseZoneRepository;
  let tenantId: string;
  const createdZoneIds: string[] = [];

  beforeAll(async () => {
    WmsSupabaseClient.reset();
    const wms = WmsSupabaseClient.getInstance({
      url: SUPABASE_URL,
      anonKey: SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    client = wms.getClient();
    repo = new SupabaseZoneRepository(wms);

    const { data: tenant } = await client
      .from('tenants')
      .insert({ name: `phase8-zone-tenant-${Date.now()}` })
      .select()
      .single();
    if (!tenant) throw new Error('创建测试租户失败');
    tenantId = tenant.id;
  });

  afterAll(async () => {
    for (const id of createdZoneIds) {
      await client.from('zones').delete().eq('id', id);
    }
    await client.from('tenants').delete().eq('id', tenantId);
  });

  test('create：创建新库区并返回完整行', async () => {
    const code = `TEST_ZONE_${randomUUID().slice(0, 8)}`;
    const zone: ZoneInsert = {
      tenant_id: tenantId,
      code,
      zone_type: 'PICK',
      is_active: true,
    };

    const created = await repo.create(zone);
    createdZoneIds.push(created.id);

    expect(created.id).toBeTruthy();
    expect(created.code).toBe(code);
    expect(created.zone_type).toBe('PICK');
    expect(created.tenant_id).toBe(tenantId);
  });

  test('findById：按 ID 查找库区', async () => {
    const code = `TEST_ZONE_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      code,
      zone_type: 'BULK',
      is_active: true,
    });
    createdZoneIds.push(created.id);

    const found = await repo.findById(created.id);
    expect(found).not.toBeNull();
    expect(found!.code).toBe(code);
  });

  test('findByCode：按租户 + 编码查找库区', async () => {
    const code = `TEST_ZONE_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      code,
      zone_type: 'COLD',
      is_active: true,
    });
    createdZoneIds.push(created.id);

    const found = await repo.findByCode(tenantId, code);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);

    const notFound = await repo.findByCode(tenantId, 'NONEXISTENT_CODE');
    expect(notFound).toBeNull();
  });

  test('findByTenant：按租户查找所有库区', async () => {
    const all = await repo.findByTenant(tenantId);
    for (const z of all) {
      expect(z.tenant_id).toBe(tenantId);
    }
  });

  test('findActive：只返回启用中的库区', async () => {
    const inactiveCode = `TEST_INACTIVE_${randomUUID().slice(0, 8)}`;
    const inactive = await repo.create({
      tenant_id: tenantId,
      code: inactiveCode,
      zone_type: 'STAGING',
      is_active: false,
    });
    createdZoneIds.push(inactive.id);

    const active = await repo.findActive(tenantId);
    for (const z of active) {
      expect(z.is_active).toBe(true);
    }
    const inactiveInActive = active.find((z) => z.id === inactive.id);
    expect(inactiveInActive).toBeUndefined();
  });

  test('update：更新库区字段', async () => {
    const code = `TEST_ZONE_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      code,
      zone_type: 'PICK',
      is_active: true,
    });
    createdZoneIds.push(created.id);

    const updated = await repo.update(created.id, {
      zone_type: 'BULK',
      is_active: false,
    });

    expect(updated.zone_type).toBe('BULK');
    expect(updated.is_active).toBe(false);
    expect(updated.code).toBe(code);
  });

  test('delete：删除库区', async () => {
    const code = `TEST_DELETE_${randomUUID().slice(0, 8)}`;
    const created = await repo.create({
      tenant_id: tenantId,
      code,
      zone_type: 'CROSS_DOCK',
      is_active: true,
    });

    await repo.delete(created.id);

    const found = await repo.findById(created.id);
    expect(found).toBeNull();
  });

  test('并发创建：不同编码并发创建不冲突', async () => {
    const codes = Array.from({ length: 3 }, () => `TEST_CONC_${randomUUID().slice(0, 8)}`);

    const results = await Promise.all(
      codes.map((code) =>
        repo.create({
          tenant_id: tenantId,
          code,
          zone_type: 'PICK',
          is_active: true,
        })
      )
    );

    results.forEach((r) => createdZoneIds.push(r.id));

    expect(results).toHaveLength(3);
    const returnedCodes = results.map((r) => r.code).sort();
    expect(returnedCodes).toEqual(codes.sort());
  });
});
