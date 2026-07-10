/**
 * Supabase 订单仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IOrderRepository } from '../../../core/ports/db/IOrderRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

export class SupabaseOrderRepository extends SupabaseBaseRepository<
  Tables<'orders'>,
  TablesInsert<'orders'>,
  TablesUpdate<'orders'>
> implements IOrderRepository {
  protected tableName = 'orders';
  protected idColumn = 'id';

  async findByExternalId(externalOrderId: string): Promise<Tables<'orders'> | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('external_order_id', externalOrderId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as Tables<'orders'>;
  }

  async findByStatus(status: string, tenantId: string): Promise<Tables<'orders'>[]> {
    return this.findAll({ filters: { status, tenant_id: tenantId }, orderBy: 'created_at', ascending: false });
  }

  async findByTenant(
    tenantId: string,
    options: { limit?: number; offset?: number; status?: string } = {}
  ): Promise<Tables<'orders'>[]> {
    const { limit = 50, offset = 0, status } = options;
    const filters: Record<string, unknown> = { tenant_id: tenantId };
    if (status) filters.status = status;

    return this.findAll({ limit, offset, filters, orderBy: 'created_at', ascending: false });
  }

  async findWithLines(orderId: string): Promise<{
    order: Tables<'orders'>;
    lines: Tables<'order_lines'>[];
  } | null> {
    const [order, lines] = await Promise.all([
      this.findById(orderId),
      this.getClient()
        .from('order_lines')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true }),
    ]);

    if (!order) return null;
    return { order, lines: (lines.data as Tables<'order_lines'>[]) || [] };
  }

  async updateStatus(orderId: string, status: string): Promise<Tables<'orders'>> {
    return this.update(orderId, { status, updated_at: new Date().toISOString() } as TablesUpdate<'orders'>);
  }

  async findPendingAllocation(tenantId: string): Promise<Tables<'orders'>[]> {
    return this.findByStatus('pending_allocation', tenantId);
  }
}