/**
 * Supabase 租户仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { ITenantRepository } from '../../../core/ports/db/ITenantRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

export class SupabaseTenantRepository extends SupabaseBaseRepository<
  Tables<'tenants'>,
  TablesInsert<'tenants'>,
  TablesUpdate<'tenants'>
> implements ITenantRepository {
  protected tableName = 'tenants';
  protected idColumn = 'id';

  async findByName(name: string): Promise<Tables<'tenants'> | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('name', name)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as Tables<'tenants'>;
  }

  async findActive(): Promise<Tables<'tenants'>[]> {
    return this.findAll({ filters: { is_active: true }, orderBy: 'name', ascending: true });
  }

  async updateBillingStrategy(tenantId: string, strategy: Record<string, unknown>): Promise<Tables<'tenants'>> {
    return this.update(tenantId, { billing_strategy: strategy } as TablesUpdate<'tenants'>);
  }
}