/**
 * Supabase 工单仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IWorkOrderRepository } from '@core/ports/db/IWorkOrderRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

export class SupabaseWorkOrderRepository extends SupabaseBaseRepository<
  Tables<'work_orders'>,
  TablesInsert<'work_orders'>,
  TablesUpdate<'work_orders'>
> implements IWorkOrderRepository {
  protected tableName = 'work_orders';
  protected idColumn = 'id';

  async findByWave(waveId: string): Promise<Tables<'work_orders'>[]> {
    return this.findAll({ filters: { wave_id: waveId }, orderBy: 'created_at', ascending: true });
  }

  async findByAssignee(userId: string, status?: string): Promise<Tables<'work_orders'>[]> {
    const filters: Record<string, unknown> = { assigned_user_id: userId };
    if (status) filters.status = status;
    return this.findAll({ filters, orderBy: 'created_at', ascending: false });
  }

  async findByOrder(orderId: string): Promise<Tables<'work_orders'>[]> {
    return this.findAll({ filters: { related_order_id: orderId }, orderBy: 'created_at', ascending: true });
  }

  async findByParent(parentWoId: string): Promise<Tables<'work_orders'>[]> {
    return this.findAll({ filters: { parent_wo_id: parentWoId }, orderBy: 'created_at', ascending: true });
  }

  async findPendingDispatch(tenantId: string): Promise<Tables<'work_orders'>[]> {
    return this.findAll({
      filters: { tenant_id: tenantId, status: 'pending' },
      orderBy: 'created_at',
      ascending: true,
    });
  }

  async updateStatus(workOrderId: string, status: string): Promise<Tables<'work_orders'>> {
    return this.update(workOrderId, { status } as TablesUpdate<'work_orders'>);
  }

  async logAction(log: TablesInsert<'wo_action_logs'>): Promise<Tables<'wo_action_logs'>> {
    const { data, error } = await this.getClient()
      .from('wo_action_logs')
      .insert(log)
      .select()
      .single();

    if (error) throw error;
    return data as Tables<'wo_action_logs'>;
  }
}