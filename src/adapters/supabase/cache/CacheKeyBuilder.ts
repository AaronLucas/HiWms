/**
 * 缓存键构建器实现
 * 租户感知的键命名规范
 */
import { ICacheKeyBuilder } from '@core/ports/cache/ICacheKeyBuilder';

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
      return this.buildTenant(tenantId, 'entity', entityType, id);
    }
    return this.build('entity', entityType, id);
  }

  list(entityType: string, tenantId: string, params?: Record<string, unknown>): string {
    const base = this.buildTenant(tenantId, 'list', entityType);
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