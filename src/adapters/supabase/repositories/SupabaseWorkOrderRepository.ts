/**
 * Supabase 工单仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IWorkOrderRepository, WorkOrderRow, ActionLogRow } from '@core/ports/db/IWorkOrderRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

export class SupabaseWorkOrderRepository extends SupabaseBaseRepository<
  Tables<'work_orders'>,
  TablesInsert<'work_orders'>,
  TablesUpdate<'work_orders'>
> implements IWorkOrderRepository {
  protected tableName = 'work_orders';
  protected idColumn = 'id';

  async findByWave(waveId: string): Promise<WorkOrderRow[]> {
    return this.findAll({ filters: { wave_id: waveId }, orderBy: 'created_at', ascending: true });
  }

  async findByAssignee(userId: string, status?: string): Promise<WorkOrderRow[]> {
    const filters: Record<string, unknown> = { assigned_user_id: userId };
    if (status) filters.status = status;
    return this.findAll({ filters, orderBy: 'created_at', ascending: false });
  }

  async findByOrder(orderId: string): Promise<WorkOrderRow[]> {
    return this.findAll({ filters: { related_order_id: orderId }, orderBy: 'created_at', ascending: true });
  }

  async findByParent(parentWoId: string): Promise<WorkOrderRow[]> {
    return this.findAll({ filters: { parent_wo_id: parentWoId }, orderBy: 'created_at', ascending: true });
  }

  async findPendingDispatch(tenantId: string): Promise<WorkOrderRow[]> {
    return this.findAll({
      filters: { tenant_id: tenantId, status: 'pending' },
      orderBy: 'created_at',
      ascending: true,
    });
  }

  async updateStatus(workOrderId: string, status: string): Promise<WorkOrderRow> {
    return this.update(workOrderId, { status } as TablesUpdate<'work_orders'>);
  }

  async logAction(log: TablesInsert<'wo_action_logs'>): Promise<ActionLogRow> {
    const { data, error } = await this.getClient()
      .from('wo_action_logs')
      .insert(log)
      .select()
      .single();

    if (error) throw error;
    return data as ActionLogRow;
  }

  async updateActionLog(logId: number, updateData: TablesUpdate<'wo_action_logs'>): Promise<ActionLogRow> {
    const { data: result, error } = await this.getClient()
      .from('wo_action_logs')
      .update(updateData)
      .eq('log_id', logId)
      .select()
      .single();

    if (error) throw error;
    return result as ActionLogRow;
  }

  async getActionLogsByWorkOrder(woId: string): Promise<ActionLogRow[]> {
    const { data, error } = await this.getClient()
      .from('wo_action_logs')
      .select('*')
      .eq('wo_id', woId)
      .order('start_at', { ascending: true });

    if (error) throw error;
    return (data || []) as ActionLogRow[];
  }

  async getActionLogsByOperator(operatorId: string, dateFrom: Date, dateTo: Date): Promise<ActionLogRow[]> {
    const { data, error } = await this.getClient()
      .from('wo_action_logs')
      .select(`
        *,
        work_orders!inner(assigned_user_id)
      `)
      .eq('work_orders.assigned_user_id', operatorId)
      .gte('start_at', dateFrom.toISOString())
      .lte('start_at', dateTo.toISOString())
      .order('start_at', { ascending: true });

    if (error) throw error;
    return (data || []) as ActionLogRow[];
  }

  async getExceptionLogs(tenantId: string, dateFrom: Date, dateTo: Date): Promise<ActionLogRow[]> {
    const { data, error } = await this.getClient()
      .from('wo_action_logs')
      .select(`
        *,
        work_orders!inner(tenant_id)
      `)
      .eq('work_orders.tenant_id', tenantId)
      .eq('action_type', 'EXCEPTION')
      .gte('start_at', dateFrom.toISOString())
      .lte('start_at', dateTo.toISOString())
      .order('start_at', { ascending: true });

    if (error) throw error;
    return (data || []) as ActionLogRow[];
  }
}