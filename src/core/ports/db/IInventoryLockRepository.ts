/**
 * 库存锁仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type InventoryLockRow = Tables<'inventory_locks'>;
export type InventoryLockInsert = TablesInsert<'inventory_locks'>;
export type InventoryLockUpdate = TablesUpdate<'inventory_locks'>;

export interface IInventoryLockRepository extends IRepository<InventoryLockRow, InventoryLockInsert, InventoryLockUpdate> {
  /**
   * 按库存记录查找锁
   */
  findByInventory(inventoryId: string): Promise<InventoryLockRow[]>;

  /**
   * 按租户查找活跃锁
   */
  findActiveByTenant(tenantId: string): Promise<InventoryLockRow[]>;

  /**
   * 创建库存锁
   */
  createLock(data: InventoryLockInsert): Promise<InventoryLockRow>;

  /**
   * 释放库存锁
   */
  releaseLock(lockId: string): Promise<void>;

  /**
   * 获取锁统计
   */
  getLockStats(tenantId: string): Promise<{
    totalLocks: number;
    activeLocks: number;
    expiredLocks: number;
    byType: Record<string, number>;
  }>;
}