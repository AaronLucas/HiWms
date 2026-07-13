/**
 * Supabase 装车任务仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { ILoadingTaskRepository } from '@core/ports/db/ILoadingTaskRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type LoadingTaskRow = Tables<'loading_tasks'>;
type LoadingTaskInsert = TablesInsert<'loading_tasks'>;
type LoadingTaskUpdate = TablesUpdate<'loading_tasks'>;

export class SupabaseLoadingTaskRepository extends SupabaseBaseRepository<
  LoadingTaskRow,
  LoadingTaskInsert,
  LoadingTaskUpdate,
  string
> implements ILoadingTaskRepository {
  protected tableName = 'loading_tasks';
  protected idColumn = 'id';

  async findByWave(waveId: string): Promise<LoadingTaskRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('wave_id', waveId)
      .order('load_sequence', { ascending: true });

    if (error) throw error;
    return (data as LoadingTaskRow[]) || [];
  }

  async findByAssignee(userId: string, status?: string): Promise<LoadingTaskRow[]> {
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('loader_id', userId)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    return (data as LoadingTaskRow[]) || [];
  }

  async findByOrder(orderId: string): Promise<LoadingTaskRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .contains('order_ids', [orderId])
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as LoadingTaskRow[]) || [];
  }

  async findPendingDispatch(tenantId: string): Promise<LoadingTaskRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as LoadingTaskRow[]) || [];
  }

  async updateStatus(loadingTaskId: string, status: string, extra?: { startedAt?: string; completedAt?: string; actualWeight?: number; actualVolume?: number; sealNumber?: string; exceptionReason?: string }): Promise<LoadingTaskRow> {
    const updateData: Partial<LoadingTaskUpdate> = { status };
    if (extra?.startedAt) updateData.started_at = extra.startedAt;
    if (extra?.completedAt) updateData.completed_at = extra.completedAt;
    if (extra?.actualWeight !== undefined) updateData.actual_weight = extra.actualWeight;
    if (extra?.actualVolume !== undefined) updateData.actual_volume = extra.actualVolume;
    if (extra?.sealNumber) updateData.seal_number = extra.sealNumber;
    if (extra?.exceptionReason) updateData.exception_reason = extra.exceptionReason;
    return this.update(loadingTaskId, updateData as LoadingTaskUpdate);
  }
}