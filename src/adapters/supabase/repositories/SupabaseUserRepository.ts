/**
 * Supabase 用户仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IUserRepository } from '@core/ports/db/IUserRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type UserRow = Tables<'users'>;
type UserInsert = TablesInsert<'users'>;
type UserUpdate = TablesUpdate<'users'>;

export class SupabaseUserRepository extends SupabaseBaseRepository<
  UserRow,
  UserInsert,
  UserUpdate,
  string
> implements IUserRepository {
  protected tableName = 'users';
  protected idColumn = 'id';

  async findByUsername(username: string): Promise<UserRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('username', username)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as UserRow;
  }

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; role?: string; isActive?: boolean }
  ): Promise<UserRow[]> {
    const { limit = 100, offset = 0, role, isActive } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (role) query = query.eq('role', role);
    if (isActive !== undefined) query = query.eq('is_active', isActive);

    const { data, error } = await query;
    if (error) throw error;
    return (data as UserRow[]) || [];
  }

  async updateStatus(userId: string, isActive: boolean): Promise<UserRow> {
    return this.update(userId, { is_active: isActive } as UserUpdate);
  }

  async updateRole(userId: string, role: string): Promise<UserRow> {
    return this.update(userId, { role } as UserUpdate);
  }

  async resetPassword(userId: string, newPasswordHash: string): Promise<void> {
    await this.update(userId, { password_hash: newPasswordHash } as UserUpdate);
  }

  async usernameExists(username: string): Promise<boolean> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('id')
      .eq('username', username)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return false;
      throw error;
    }
    return !!data;
  }

  async getStats(tenantId: string): Promise<{
    total: number;
    active: number;
    byRole: Record<string, number>;
  }> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('role, is_active')
      .eq('tenant_id', tenantId);

    if (error) throw error;
    const users = data as { role: string; is_active: boolean }[];

    const byRole: Record<string, number> = {};
    let total = 0, active = 0;

    for (const u of users) {
      total++;
      if (u.is_active) active++;
      byRole[u.role] = (byRole[u.role] || 0) + 1;
    }

    return { total, active, byRole };
  }
}