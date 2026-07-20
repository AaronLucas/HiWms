/// <reference types="@cloudflare/workers-types" />
/**
 * Cloudflare Workers 适配器实现
 * 提供 KV 缓存、Worker 环境下的权限检查、租户解析
 */
import { ICacheProvider, ICacheKeyBuilder } from '@core/ports/cache';
import { IPermissionChecker, ITenantResolver } from '@core/ports/auth';
import { CacheKeyBuilder } from '@adapters/supabase/cache/CacheKeyBuilder';
import type { KVNamespace } from '@cloudflare/workers-types';

/** Cloudflare KV 缓存提供者 */
export class KvCacheProvider implements ICacheProvider {
  constructor(private kv: KVNamespace) {}

  async get<T>(key: string): Promise<T | null> {
    const value = await this.kv.get(key, { type: 'json' });
    return value as T | null;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const options: KVNamespacePutOptions = {};
    if (ttlSeconds) {
      options.expirationTtl = ttlSeconds;
    }
    await this.kv.put(key, JSON.stringify(value), options);
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    // KV 不支持前缀删除，需要列出后逐个删除
    // 注意：生产环境建议使用批量操作或 Durable Objects
    const list = await this.kv.list({ prefix });
    await Promise.all(list.keys.map(k => this.kv.delete(k.name)));
  }

  async has(key: string): Promise<boolean> {
    const value = await this.kv.get(key);
    return value !== null;
  }

  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlSeconds?: number): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  async increment(key: string, delta = 1): Promise<number> {
    const current = (await this.get<number>(key)) ?? 0;
    const next = current + delta;
    await this.set(key, next);
    return next;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    // KV 不支持修改过期时间，需重新写入
    const value = await this.get(key);
    if (value !== null) {
      await this.set(key, value, ttlSeconds);
    }
  }
}

/** Cloudflare Worker 权限检查器 */
export class WorkerPermissionChecker implements IPermissionChecker {
  constructor(
    private rpcClient: {
      permissionCheck: {
        check(params: { p_user_id: string; p_resource: string; p_action: string; p_scope?: string }): Promise<{ has_permission: boolean }>;
      };
    }
  ) {}

  async check(params: {
    userId: string;
    resource: string;
    action: string;
    scope?: string;
  }): Promise<boolean> {
    try {
      const result = await this.rpcClient.permissionCheck.check({
        p_user_id: params.userId,
        p_resource: params.resource,
        p_action: params.action,
        p_scope: params.scope ?? 'tenant',
      });
      return result.has_permission;
    } catch {
      return false;
    }
  }

  async checkBatch(params: Array<{
    userId: string;
    resource: string;
    action: string;
    scope?: string;
  }>): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    await Promise.all(
      params.map(async p => {
        const key = `${p.userId}:${p.resource}:${p.action}:${p.scope ?? 'tenant'}`;
        results.set(key, await this.check(p));
      })
    );
    return results;
  }

  async getUserPermissions(userId: string): Promise<Array<{
    resource: string;
    action: string;
    scope: string;
  }>> {
    // Worker 环境下不直接查询数据库，返回空或从缓存获取
    return [];
  }
}

/** Cloudflare Worker 租户解析器 */
export class WorkerTenantResolver implements ITenantResolver {
  constructor(
    private rpcClient: {
      currentTenant: { getCurrentTenantId(): Promise<string> };
    }
  ) {}

  async resolveFromUser(userId: string): Promise<string | null> {
    try {
      // Worker 环境下通过 RPC 获取
      return await this.rpcClient.currentTenant.getCurrentTenantId();
    } catch {
      return null;
    }
  }

  async resolveFromRequest(request: {
    headers?: Record<string, string>;
    query?: Record<string, string>;
    user?: { id: string; tenantId?: string };
  }): Promise<string | null> {
    // 1. 从已认证用户获取
    if (request.user?.tenantId) {
      return request.user.tenantId;
    }

    // 2. 从 Header 获取（服务间调用）
    if (request.headers?.['x-tenant-id']) {
      return request.headers['x-tenant-id'];
    }

    // 3. 从 Query 获取
    if (request.query?.tenant_id) {
      return request.query.tenant_id;
    }

    // 4. 从用户 ID 解析
    if (request.user?.id) {
      return this.resolveFromUser(request.user.id);
    }

    return null;
  }

  async validateTenant(tenantId: string): Promise<boolean> {
    // 简单验证，实际可调用 RPC
    return !!tenantId && tenantId.length > 0;
  }

  async isPlatformAdmin(_userId: string): Promise<boolean> {
    // Worker 环境下无直接查询 users 表的能力，平台管理操作不应在此环境暴露，
    // 保守起见恒返回 false（需要平台超管权限的写操作只走 admin-api / Supabase 环境）
    return false;
  }
}

/** Cloudflare 缓存键构建器（复用核心实现） */
export { CacheKeyBuilder };

/** Cloudflare 适配器工厂 */
export interface CloudflareEnv {
  KV_CACHE: KVNamespace;
  RPC_CLIENT: any; // 实际类型为 RPC 客户端接口
}

export function createCloudflareAdapters(env: CloudflareEnv) {
  return {
    cache: {
      provider: new KvCacheProvider(env.KV_CACHE),
      keyBuilder: new CacheKeyBuilder(),
    },
    auth: {
      permissionChecker: new WorkerPermissionChecker(env.RPC_CLIENT),
      tenantResolver: new WorkerTenantResolver(env.RPC_CLIENT),
    },
  };
}