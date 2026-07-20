/**
 * Supabase 缓存提供者实现
 * 使用 Redis 兼容接口，实际通过 Supabase Edge Functions 或外部 Redis
 * 这里提供内存实现作为备选，生产环境应替换为 Redis
 */
import { ICacheProvider, ICacheKeyBuilder } from '@core/ports/cache';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class SupabaseCacheProvider implements ICacheProvider {
  private cache = new Map<string, CacheEntry<unknown>>();
  private defaultTtl = 300; // 5分钟默认 TTL

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? this.defaultTtl;
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl * 1000,
    });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
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
    const entry = this.cache.get(key);
    if (entry) {
      entry.expiresAt = Date.now() + ttlSeconds * 1000;
    }
  }

  /** 清理过期条目 */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

/** Redis 缓存提供者（生产环境使用） */
export class RedisCacheProvider implements ICacheProvider {
  constructor(private redis: any) {} // ioredis 或 redis 客户端

  async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    return value ? JSON.parse(value) : null;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await this.redis.setex(key, ttlSeconds, serialized);
    } else {
      await this.redis.set(key, serialized);
    }
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    const keys = await this.redis.keys(`${prefix}*`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  async has(key: string): Promise<boolean> {
    return (await this.redis.exists(key)) === 1;
  }

  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlSeconds?: number): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  async increment(key: string, delta = 1): Promise<number> {
    return this.redis.incrby(key, delta);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(key, ttlSeconds);
  }
}

export class CacheKeyBuilder implements ICacheKeyBuilder {
  private prefix = 'hiwms';

  build(...parts: string[]): string {
    return [this.prefix, ...parts].join(':');
  }

  buildTenant(tenantId: string, ...parts: string[]): string {
    return this.build('tenant', tenantId, ...parts);
  }

  buildUser(userId: string, ...parts: string[]): string {
    return this.build('user', userId, ...parts);
  }

  entity(entityType: string, id: string, tenantId?: string): string {
    if (tenantId) {
      return this.build('tenant', tenantId, 'entity', entityType, id);
    }
    return this.build('entity', entityType, id);
  }

  list(entityType: string, tenantId: string, params?: Record<string, unknown>): string {
    const base = this.build('tenant', tenantId, 'list', entityType);
    if (!params || Object.keys(params).length === 0) {
      return base;
    }
    // 参数排序确保一致性
    const paramStr = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    return `${base}:${paramStr}`;
  }

  session(sessionId: string): string {
    return this.build('session', sessionId);
  }

  rateLimit(identifier: string, window: string): string {
    return this.build('ratelimit', window, identifier);
  }

  /** 构建工作流状态键 */
  workflow(workflowId: string, tenantId: string): string {
    return this.buildTenant(tenantId, 'workflow', workflowId);
  }

  /** 构建波次进度键 */
  waveProgress(waveId: string, tenantId: string): string {
    return this.buildTenant(tenantId, 'wave', 'progress', waveId);
  }

  /** 构建库存快照键 */
  inventorySnapshot(tenantId: string, locationId?: string): string {
    return this.buildTenant(tenantId, 'inventory', 'snapshot', locationId ?? 'all');
  }
}