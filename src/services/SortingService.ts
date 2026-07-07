// src/services/SortingService.ts
// Phase A: 分拣服务 - 滑道分配、分拣任务生成、PDA 确认

import { SupabaseClient } from '../supabase/SupabaseClient';
import {
  SortingChute,
  SortingWave,
  SortingTask,
} from '../models/fulfillment';

export class SortingService {
  private supabase: SupabaseClient;

  constructor(tenantId: string) {
    this.supabase = new SupabaseClient({
      defaultTenantId: tenantId,
      url: process.env.SUPABASE_URL!,
      anonKey: process.env.SUPABASE_ANON_KEY!,
    });
  }

  // =====================================================================
  // 滑道管理
  // =====================================================================

  async createChute(data: any): Promise<any> {
    const result = await this.supabase
      .from('sorting_chutes')
      .insert(data)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async getChutes(zoneType?: string): Promise<any[]> {
    let query = this.supabase.from('sorting_chutes').select('*');
    if (zoneType) query = query.eq('zone_type', zoneType);
    const result = await query.order('priority', { ascending: true });
    if (result.error) throw result.error;
    return result.data || [];
  }

  async getChute(chuteId: string): Promise<any | null> {
    const result = await this.supabase
      .from('sorting_chutes')
      .select('*')
      .eq('chute_id', chuteId)
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async updateChute(chuteId: string, data: Partial<any>): Promise<any> {
    const result = await this.supabase
      .from('sorting_chutes')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('chute_id', chuteId)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async assignContainerToChute(containerId: string, chuteId: string, priority = 10): Promise<void> {
    const result = await this.supabase
      .from('container_sorting_targets')
      .upsert({ container_id: containerId, chute_id: chuteId, priority });
    if (result.error) throw result.error;
  }

  async getContainerTargets(containerId: string) {
    const result = await this.supabase
      .from('container_sorting_targets')
      .select('chute_id, priority')
      .eq('container_id', containerId)
      .order('priority', { ascending: true });
    if (result.error) throw result.error;
    return result.data || [];
  }

  // =====================================================================
  // 分拣波次管理
  // =====================================================================

  async createWave(data: any): Promise<any> {
    const result = await this.supabase
      .from('sorting_waves')
      .insert(data)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async getWaves(waveType?: string, status?: string): Promise<any[]> {
    let query = this.supabase.from('sorting_waves').select('*');
    if (waveType) query = query.eq('wave_type', waveType);
    if (status) query = query.eq('status', status);
    const result = await query.order('created_at', { ascending: false });
    if (result.error) throw result.error;
    return result.data || [];
  }

  async getWave(waveId: string): Promise<any | null> {
    const result = await this.supabase
      .from('sorting_waves')
      .select('*')
      .eq('wave_id', waveId)
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async startWave(waveId: string): Promise<any> {
    const result = await this.supabase
      .from('sorting_waves')
      .update({ status: 'IN_PROGRESS', started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('wave_id', waveId)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async completeWave(waveId: string): Promise<any> {
    const result = await this.supabase
      .from('sorting_waves')
      .update({ status: 'COMPLETED', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('wave_id', waveId)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  // =====================================================================
  // 分拣任务管理
  // =====================================================================

  async createTasks(tasks: any[]): Promise<any[]> {
    const result = await this.supabase
      .from('sorting_tasks')
      .insert(tasks)
      .select();
    if (result.error) throw result.error;
    return result.data || [];
  }

  async getWaveTasks(waveId: string): Promise<any[]> {
    const result = await this.supabase
      .from('sorting_tasks')
      .select('*')
      .eq('wave_id', waveId)
      .order('created_at', { ascending: true });
    if (result.error) throw result.error;
    return result.data || [];
  }

  async getTask(taskId: string): Promise<any | null> {
    const result = await this.supabase
      .from('sorting_tasks')
      .select('*')
      .eq('task_id', taskId)
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async assignTask(taskId: string, userId: string, chuteId?: string): Promise<any> {
    const update: any = { status: 'ASSIGNED', assigned_to: userId };
    if (chuteId) update.target_chute_id = chuteId;
    const result = await this.supabase
      .from('sorting_tasks')
      .update(update)
      .eq('task_id', taskId)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async startTask(taskId: string, userId: string): Promise<any> {
    const result = await this.supabase
      .from('sorting_tasks')
      .update({ status: 'IN_PROGRESS', started_at: new Date().toISOString() })
      .eq('task_id', taskId)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async completeTask(taskId: string, userId: string): Promise<any> {
    const result = await this.supabase
      .from('sorting_tasks')
      .update({ status: 'COMPLETED', completed_at: new Date().toISOString() })
      .eq('task_id', taskId)
      .select()
      .single();
    if (result.error) throw result.error;

    // 更新波次进度
    const task = result.data;
    await this.updateWaveProgress(task.wave_id);

    return result.data;
  }

  async exceptionTask(taskId: string, reason: string): Promise<any> {
    const result = await this.supabase
      .from('sorting_tasks')
      .update({ status: 'EXCEPTION', exception_reason: reason, updated_at: new Date().toISOString() })
      .eq('task_id', taskId)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  // =====================================================================
  // 内部辅助
  // =====================================================================

  private async updateWaveProgress(waveId: string): Promise<void> {
    const tasksResult = await this.supabase
      .from('sorting_tasks')
      .select('status')
      .eq('wave_id', waveId);
    if (tasksResult.error) throw tasksResult.error;

    const tasks = tasksResult.data || [];
    const total = tasks.length;
    const completed = tasks.filter((t: any) => t.status === 'COMPLETED').length;

    const waveResult = await this.supabase
      .from('sorting_waves')
      .update({ total_tasks: total, completed_tasks: completed, updated_at: new Date().toISOString() })
      .eq('wave_id', waveId);
    if (waveResult.error) throw waveResult.error;

    // 如果全部完成，自动标记波次完成
    if (total > 0 && completed === total) {
      await this.supabase
        .from('sorting_waves')
        .update({ status: 'COMPLETED', completed_at: new Date().toISOString() })
        .eq('wave_id', waveId);
    }
  }
}