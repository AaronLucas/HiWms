/**
 * Supabase 分拣任务仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { ISortingTaskRepository } from '@core/ports/db/ISortingTaskRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type SortingTaskRow = Tables<'sorting_tasks'>;
type SortingTaskInsert = TablesInsert<'sorting_tasks'>;
type SortingTaskUpdate = TablesUpdate<'sorting_tasks'>;

type SortingChuteRow = Tables<'sorting_chutes'>;
type SortingChuteInsert = TablesInsert<'sorting_chutes'>;
type SortingChuteUpdate = TablesUpdate<'sorting_chutes'>;

export class SupabaseSortingTaskRepository extends SupabaseBaseRepository<
  SortingTaskRow,
  SortingTaskInsert,
  SortingTaskUpdate,
  string
> implements ISortingTaskRepository {
  protected tableName = 'sorting_tasks';
  protected idColumn = 'id';

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; assignedUserId?: string; waveId?: string }
  ): Promise<SortingTaskRow[]> {
    const { limit = 100, offset = 0, status, assignedUserId, waveId } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (assignedUserId) query = query.eq('assigned_user_id', assignedUserId);
    if (waveId) query = query.eq('wave_id', waveId);

    const { data, error } = await query;
    if (error) throw error;
    return (data as SortingTaskRow[]) || [];
  }

  async findWithChute(taskId: string): Promise<{
    task: SortingTaskRow;
    chute: SortingChuteRow | null;
  } | null> {
    const { data: task, error: taskError } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('id', taskId)
      .single();

    if (taskError) {
      if (taskError.code === 'PGRST116') return null;
      throw taskError;
    }

    let chute: SortingChuteRow | null = null;
    if (task.chute_id) {
      const { data: chuteData, error: chuteError } = await this.getClient()
        .from('sorting_chutes')
        .select('*')
        .eq('id', task.chute_id)
        .single();

      if (chuteError) {
        if (chuteError.code !== 'PGRST116') throw chuteError;
      } else {
        chute = chuteData as SortingChuteRow;
      }
    }

    return { task: task as SortingTaskRow, chute };
  }

  async findPendingSorting(tenantId: string): Promise<SortingTaskRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as SortingTaskRow[]) || [];
  }

  async findByChute(chuteId: string): Promise<SortingTaskRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('chute_id', chuteId)
      .order('sort_sequence', { ascending: true });

    if (error) throw error;
    return (data as SortingTaskRow[]) || [];
  }

  async findPendingDispatch(tenantId: string): Promise<SortingTaskRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'sorted')
      .order('completed_at', { ascending: true });

    if (error) throw error;
    return (data as SortingTaskRow[]) || [];
  }

  async updateStatus(
    taskId: string,
    status: string,
    extra?: { startedAt?: string; completedAt?: string; exceptionReason?: string }
  ): Promise<SortingTaskRow> {
    const updateData: Partial<SortingTaskUpdate> = { status };
    if (extra?.startedAt) updateData.started_at = extra.startedAt;
    if (extra?.completedAt) updateData.completed_at = extra.completedAt;
    if (extra?.exceptionReason) updateData.exception_reason = extra.exceptionReason;
    return this.update(taskId, updateData as SortingTaskUpdate);
  }

  async assignChute(taskId: string, chuteId: string): Promise<SortingTaskRow> {
    return this.update(taskId, { chute_id: chuteId } as SortingTaskUpdate);
  }

  async recordSortingComplete(taskId: string, sortedQty: number): Promise<SortingTaskRow> {
    return this.update(taskId, {
      status: 'sorted',
      sorted_qty: sortedQty,
      completed_at: new Date().toISOString(),
    } as SortingTaskUpdate);
  }

  async recordException(taskId: string, reason: string): Promise<SortingTaskRow> {
    return this.update(taskId, {
      status: 'exception',
      exception_reason: reason,
    } as SortingTaskUpdate);
  }

  async getEfficiencyStats(tenantId: string, startDate: string, endDate: string): Promise<{
    completedTasks: number;
    totalQty: number;
    avgDurationMinutes: number;
    exceptionRate: number;
  }> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('status, started_at, completed_at, qty, sorted_qty')
      .eq('tenant_id', tenantId)
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    if (error) throw error;
    const tasks = data as { status: string; started_at: string | null; completed_at: string | null; qty: number; sorted_qty: number | null }[];

    const completed = tasks.filter(t => t.status === 'sorted' || t.status === 'completed');
    const withException = tasks.filter(t => t.status === 'exception').length;
    const completedWithTimes = completed.filter(t => t.started_at && t.completed_at);

    return {
      completedTasks: completed.length,
      totalQty: completed.reduce((sum, t) => sum + (t.sorted_qty || 0), 0),
      avgDurationMinutes: completedWithTimes.length > 0
        ? Math.round(completedWithTimes.reduce((sum, t) =>
            sum + (new Date(t.completed_at!).getTime() - new Date(t.started_at!).getTime()) / 60000, 0) / completedWithTimes.length)
        : 0,
      exceptionRate: tasks.length > 0 ? Math.round((withException / tasks.length) * 100) : 0,
    };
  }

  async getSorterPerformance(tenantId: string, startDate: string, endDate: string): Promise<Array<{
    sorterId: string;
    sorterName: string;
    taskCount: number;
    qty: number;
    avgDurationMinutes: number;
    exceptionCount: number;
  }>> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('assigned_user_id, status, started_at, completed_at, qty, sorted_qty')
      .eq('tenant_id', tenantId)
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    if (error) throw error;
    const tasks = data as { assigned_user_id: string | null; status: string; started_at: string | null; completed_at: string | null; qty: number; sorted_qty: number | null }[];

    const bySorter = new Map<string, {
      taskCount: number;
      qty: number;
      durations: number[];
      exceptionCount: number;
    }>();

    for (const task of tasks) {
      if (!task.assigned_user_id) continue;
      const existing = bySorter.get(task.assigned_user_id) || { taskCount: 0, qty: 0, durations: [], exceptionCount: 0 };
      if (task.status === 'sorted' || task.status === 'completed') {
        existing.taskCount++;
        existing.qty += task.sorted_qty || 0;
        if (task.started_at && task.completed_at) {
          existing.durations.push((new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()) / 60000);
        }
      } else if (task.status === 'exception') {
        existing.exceptionCount++;
      }
      bySorter.set(task.assigned_user_id, existing);
    }

    return Array.from(bySorter.entries()).map(([sorterId, { taskCount, qty, durations, exceptionCount }]) => ({
      sorterId,
      sorterName: '',
      taskCount,
      qty,
      avgDurationMinutes: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      exceptionCount,
    }));
  }

  async createChute(data: SortingChuteInsert): Promise<SortingChuteRow> {
    const { data: result, error } = await this.getClient()
      .from('sorting_chutes')
      .insert(data as any)
      .select()
      .single();

    if (error) throw error;
    return result as SortingChuteRow;
  }

  async updateChute(chuteId: string, data: SortingChuteUpdate): Promise<SortingChuteRow> {
    const { data: result, error } = await this.getClient()
      .from('sorting_chutes')
      .update(data as any)
      .eq('id', chuteId)
      .select()
      .single();

    if (error) throw error;
    return result as SortingChuteRow;
  }

  async findChuteById(chuteId: string): Promise<SortingChuteRow | null> {
    const { data, error } = await this.getClient()
      .from('sorting_chutes')
      .select('*')
      .eq('id', chuteId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as SortingChuteRow;
  }

  async findChutesByWave(waveId: string): Promise<SortingChuteRow[]> {
    const { data, error } = await this.getClient()
      .from('sorting_chutes')
      .select('*')
      .eq('wave_id', waveId)
      .order('sort_sequence', { ascending: true });

    if (error) throw error;
    return (data as SortingChuteRow[]) || [];
  }

  async findChutesByTarget(targetId: string, targetType: string): Promise<SortingChuteRow[]> {
    const { data, error } = await this.getClient()
      .from('sorting_chutes')
      .select('*')
      .eq('target_id', targetId)
      .eq('target_type', targetType);

    if (error) throw error;
    return (data as SortingChuteRow[]) || [];
  }

  async updateChuteStatus(chuteId: string, status: string, currentQty?: number): Promise<SortingChuteRow> {
    const updateData: Partial<SortingChuteUpdate> = { status };
    if (currentQty !== undefined) updateData.current_qty = currentQty;
    return this.updateChute(chuteId, updateData as SortingChuteUpdate);
  }

  async getChuteUtilization(tenantId: string, waveId?: string): Promise<Array<{
    chuteId: string;
    chuteCode: string;
    capacity: number;
    currentQty: number;
    utilizationPct: number;
    targetId: string | null;
    targetType: string;
  }>> {
    let query = this.getClient()
      .from('sorting_chutes')
      .select('id, chute_code, capacity, current_qty, target_id, target_type, wave_id')
      .eq('tenant_id', tenantId);

    if (waveId) query = query.eq('wave_id', waveId);

    const { data, error } = await query;
    if (error) throw error;

    return ((data as SortingChuteRow[]) || []).map(row => ({
      chuteId: row.id,
      chuteCode: row.chute_code,
      capacity: row.capacity || 0,
      currentQty: row.current_qty || 0,
      utilizationPct: row.capacity && row.capacity > 0 ? Math.round((row.current_qty || 0) / row.capacity * 100) : 0,
      targetId: row.target_id,
      targetType: row.target_type,
    }));
  }
}