/**
 * Supabase 打包任务仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IPackingTaskRepository } from '@core/ports/db/IPackingTaskRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

type PackingTaskRow = Tables<'packing_tasks'>;
type PackingTaskInsert = TablesInsert<'packing_tasks'>;
type PackingTaskUpdate = TablesUpdate<'packing_tasks'>;

type ConsumableUsageRow = Tables<'consumable_usages'>;
type ConsumableUsageInsert = TablesInsert<'consumable_usages'>;
type ConsumableUsageUpdate = TablesUpdate<'consumable_usages'>;

export class SupabasePackingTaskRepository extends SupabaseBaseRepository<
  PackingTaskRow,
  PackingTaskInsert,
  PackingTaskUpdate,
  string
> implements IPackingTaskRepository {
  protected tableName = 'packing_tasks';
  protected idColumn = 'id';

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; packerId?: string; waveId?: string }
  ): Promise<PackingTaskRow[]> {
    const { limit = 100, offset = 0, status, packerId, waveId } = options || {};
    let query = this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (packerId) query = query.eq('packer_id', packerId);
    if (waveId) query = query.eq('wave_id', waveId);

    const { data, error } = await query;
    if (error) throw error;
    return (data as PackingTaskRow[]) || [];
  }

  async findWithConsumables(taskId: string): Promise<{
    task: PackingTaskRow;
    consumables: ConsumableUsageRow[];
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

    const { data: consumables, error: consumablesError } = await this.getClient()
      .from('consumable_usages')
      .select('*')
      .eq('packing_task_id', taskId)
      .order('created_at', { ascending: true });

    if (consumablesError) throw consumablesError;

    return {
      task: task as PackingTaskRow,
      consumables: (consumables as ConsumableUsageRow[]) || [],
    };
  }

  async findPendingPacking(tenantId: string): Promise<PackingTaskRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as PackingTaskRow[]) || [];
  }

  async findPendingLabelPrint(tenantId: string): Promise<PackingTaskRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'packed')
      .lt('labels_printed', this.getClient().from(this.tableName).select('total_boxes'))
      .order('packed_at', { ascending: true });

    if (error) throw error;
    return (data as PackingTaskRow[]) || [];
  }

  async findPendingSeal(tenantId: string): Promise<PackingTaskRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'labeled')
      .order('labels_printed_at', { ascending: true });

    if (error) throw error;
    return (data as PackingTaskRow[]) || [];
  }

  async updateStatus(
    taskId: string,
    status: string,
    extra?: { startedAt?: string; completedAt?: string; exceptionReason?: string }
  ): Promise<PackingTaskRow> {
    const updateData: Partial<PackingTaskUpdate> = { status };
    if (extra?.startedAt) updateData.started_at = extra.startedAt;
    if (extra?.completedAt) updateData.completed_at = extra.completedAt;
    if (extra?.exceptionReason) updateData.exception_reason = extra.exceptionReason;
    return this.update(taskId, updateData as PackingTaskUpdate);
  }

  async recordPackingComplete(
    taskId: string,
    data: { boxesPacked: number; totalWeight: number; totalVolume: number; trackingNumbers: string[] }
  ): Promise<PackingTaskRow> {
    return this.update(taskId, {
      status: 'packed',
      boxes_packed: data.boxesPacked,
      total_weight: data.totalWeight,
      total_volume: data.totalVolume,
      tracking_numbers: data.trackingNumbers,
      packed_at: new Date().toISOString(),
    } as PackingTaskUpdate);
  }

  async recordLabelPrint(taskId: string, count: number): Promise<PackingTaskRow> {
    const { data: current } = await this.getClient()
      .from(this.tableName)
      .select('labels_printed')
      .eq('id', taskId)
      .single();

    return this.update(taskId, {
      labels_printed: (current?.labels_printed || 0) + count,
      labels_printed_at: new Date().toISOString(),
    } as PackingTaskUpdate);
  }

  async recordConsumableUsage(usage: ConsumableUsageInsert): Promise<ConsumableUsageRow> {
    const { data, error } = await this.getClient()
      .from('consumable_usages')
      .insert(usage as any)
      .select()
      .single();

    if (error) throw error;
    return data as ConsumableUsageRow;
  }

  async getEfficiencyStats(tenantId: string, startDate: string, endDate: string): Promise<{
    completedTasks: number;
    totalBoxes: number;
    totalLabels: number;
    avgDurationMinutes: number;
    totalWeightKg: number;
  }> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('status, started_at, completed_at, boxes_packed, labels_printed, total_weight')
      .eq('tenant_id', tenantId)
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    if (error) throw error;
    const tasks = data as { status: string; started_at: string | null; completed_at: string | null; boxes_packed: number | null; labels_printed: number | null; total_weight: number | null }[];

    const completed = tasks.filter(t => t.status === 'completed');
    const completedWithTimes = completed.filter(t => t.started_at && t.completed_at);

    return {
      completedTasks: completed.length,
      totalBoxes: completed.reduce((sum, t) => sum + (t.boxes_packed || 0), 0),
      totalLabels: completed.reduce((sum, t) => sum + (t.labels_printed || 0), 0),
      avgDurationMinutes: completedWithTimes.length > 0
        ? Math.round(completedWithTimes.reduce((sum, t) =>
            sum + (new Date(t.completed_at!).getTime() - new Date(t.started_at!).getTime()) / 60000, 0) / completedWithTimes.length)
        : 0,
      totalWeightKg: completed.reduce((sum, t) => sum + (t.total_weight || 0), 0),
    };
  }

  async getPackerPerformance(tenantId: string, startDate: string, endDate: string): Promise<Array<{
    packerId: string;
    packerName: string;
    taskCount: number;
    boxCount: number;
    labelCount: number;
    avgDurationMinutes: number;
  }>> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('packer_id, status, started_at, completed_at, boxes_packed, labels_printed')
      .eq('tenant_id', tenantId)
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    if (error) throw error;
    const tasks = data as { packer_id: string | null; status: string; started_at: string | null; completed_at: string | null; boxes_packed: number | null; labels_printed: number | null }[];

    const byPacker = new Map<string, {
      taskCount: number;
      boxCount: number;
      labelCount: number;
      durations: number[];
    }>();

    for (const task of tasks) {
      if (!task.packer_id) continue;
      const existing = byPacker.get(task.packer_id) || { taskCount: 0, boxCount: 0, labelCount: 0, durations: [] };
      if (task.status === 'completed') {
        existing.taskCount++;
        existing.boxCount += task.boxes_packed || 0;
        existing.labelCount += task.labels_printed || 0;
        if (task.started_at && task.completed_at) {
          existing.durations.push((new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()) / 60000);
        }
      }
      byPacker.set(task.packer_id, existing);
    }

    return Array.from(byPacker.entries()).map(([packerId, { taskCount, boxCount, labelCount, durations }]) => ({
      packerId,
      packerName: '', // 可通过 users 表关联获取
      taskCount,
      boxCount,
      labelCount,
      avgDurationMinutes: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    }));
  }
}