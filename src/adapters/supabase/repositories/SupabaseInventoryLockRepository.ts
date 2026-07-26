/**
 * Supabase 库存锁仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IInventoryLockRepository } from '@core/ports/db/IInventoryLockRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type InventoryLockRow = Tables<'inventory_locks'>;
type InventoryLockInsert = TablesInsert<'inventory_locks'>;
type InventoryLockUpdate = TablesUpdate<'inventory_locks'>;

export class SupabaseInventoryLockRepository extends SupabaseBaseRepository<
  InventoryLockRow,
  InventoryLockInsert,
  InventoryLockUpdate,
  string
> implements IInventoryLockRepository {
  protected tableName = 'inventory_locks';
  protected idColumn = 'id';

  async findByInventory(inventoryId: string): Promise<InventoryLockRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('inventory_id', inventoryId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as InventoryLockRow[]) || [];
  }

  async findActiveByTenant(tenantId: string): Promise<InventoryLockRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as InventoryLockRow[]) || [];
  }

  async createLock(data: InventoryLockInsert): Promise<InventoryLockRow> {
    return this.create(data);
  }

  async releaseLock(lockId: string): Promise<void> {
    await this.update(lockId, { is_active: false, released_at: new Date().toISOString() } as InventoryLockUpdate);
  }

  async getLockStats(tenantId: string): Promise<{
    totalLocks: number;
    activeLocks: number;
    expiredLocks: number;
    byType: Record<string, number>;
  }> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('lock_type, is_active, expires_at')
      .eq('tenant_id', tenantId);

    if (error) throw error;
    const locks = data as { lock_type: string; is_active: boolean; expires_at: string | null }[];

    const byType: Record<string, number> = {};
    let totalLocks = 0, activeLocks = 0, expiredLocks = 0;

    for (const lock of locks) {
      totalLocks++;
      if (lock.is_active && (!lock.expires_at || new Date(lock.expires_at) > new Date())) {
        activeLocks++;
      } else if (lock.expires_at && new Date(lock.expires_at) <= new Date()) {
        expiredLocks++;
      }
      byType[lock.lock_type] = (byType[lock.lock_type] || 0) + 1;
    }

    return { totalLocks, activeLocks, expiredLocks, byType };
  }
}