// src/services/LoadingService.ts
// Phase A: 装车/发运服务 - 车辆规划、载重校验、交接单

import { SupabaseClient } from '../supabase/SupabaseClient';

export class LoadingService {
  private supabase: SupabaseClient;

  constructor(tenantId: string) {
    this.supabase = new SupabaseClient({
      defaultTenantId: tenantId,
      url: process.env.SUPABASE_URL!,
      anonKey: process.env.SUPABASE_ANON_KEY!,
    });
  }

  // =====================================================================
  // 车辆管理
  // =====================================================================

  async createVehicle(data: any): Promise<any> {
    const result = await this.supabase
      .from('vehicles')
      .insert(data)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async getVehicles(status?: string): Promise<any[]> {
    let query = this.supabase.from('vehicles').select('*');
    if (status) query = query.eq('status', status);
    const result = await query.order('created_at', { ascending: false });
    if (result.error) throw result.error;
    return result.data || [];
  }

  async getVehicle(vehicleId: string): Promise<any | null> {
    const result = await this.supabase
      .from('vehicles')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async updateVehicle(vehicleId: string, data: any): Promise<any> {
    const result = await this.supabase
      .from('vehicles')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('vehicle_id', vehicleId)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async getAvailableVehicles(maxWeight?: number, maxVolume?: number): Promise<any[]> {
    let query = this.supabase
      .from('vehicles')
      .select('*')
      .eq('status', 'AVAILABLE');
    if (maxWeight) query = query.gte('max_weight', maxWeight);
    if (maxVolume) query = query.gte('max_volume', maxVolume);
    const result = await query.order('max_weight', { ascending: false });
    if (result.error) throw result.error;
    return result.data || [];
  }

  // =====================================================================
  // 装车任务管理
  // =====================================================================

  async createLoadingTask(data: any): Promise<any> {
    const result = await this.supabase
      .from('loading_tasks')
      .insert(data)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async getLoadingTasks(
    vehicleId?: string,
    waveId?: string,
    status?: string
  ): Promise<any[]> {
    let query = this.supabase.from('loading_tasks').select('*');
    if (vehicleId) query = query.eq('vehicle_id', vehicleId);
    if (waveId) query = query.eq('wave_id', waveId);
    if (status) query = query.eq('status', status);
    const result = await query.order('load_sequence', { ascending: true });
    if (result.error) throw result.error;
    return result.data || [];
  }

  async getLoadingTask(taskId: string): Promise<any | null> {
    const result = await this.supabase
      .from('loading_tasks')
      .select('*')
      .eq('task_id', taskId)
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async planLoading(data: {
    wave_id: string;
    vehicle_id: string;
    loader_id?: string;
  }): Promise<any> {
    // 获取波次下的分拣/打包任务，计算总重量体积
    // 这里简化：仅创建任务，实际应计算载重
    return this.createLoadingTask({
      tenant_id: '', // 从 context 获取
      wave_id: data.wave_id,
      vehicle_id: data.vehicle_id,
      loader_id: data.loader_id,
      status: 'PLANNING',
      load_sequence: 1,
    });
  }

  async startLoading(taskId: string, loaderId: string): Promise<any> {
    const result = await this.supabase
      .from('loading_tasks')
      .update({ status: 'LOADING', loader_id: loaderId, started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('task_id', taskId)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async completeLoading(taskId: string, actualWeight?: number, actualVolume?: number): Promise<any> {
    const result = await this.supabase
      .from('loading_tasks')
      .update({
        status: 'LOADED',
        actual_weight: actualWeight,
        actual_volume: actualVolume,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('task_id', taskId)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async sealLoading(taskId: string, sealNo: string): Promise<any> {
    const result = await this.supabase
      .from('loading_tasks')
      .update({ status: 'SEALED', sealed_at: new Date().toISOString(), seal_no: sealNo, updated_at: new Date().toISOString() })
      .eq('task_id', taskId)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async departVehicle(taskId: string): Promise<any> {
    const result = await this.supabase
      .from('loading_tasks')
      .update({ status: 'DEPARTED', departed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('task_id', taskId)
      .select()
      .single();
    if (result.error) throw result.error;

    // 更新车辆状态
    const task = result.data;
    if (task.vehicle_id) {
      await this.supabase
        .from('vehicles')
        .update({ status: 'IN_TRANSIT', updated_at: new Date().toISOString() })
        .eq('vehicle_id', task.vehicle_id);
    }

    return result.data;
  }

  async arriveVehicle(taskId: string): Promise<any> {
    const result = await this.supabase
      .from('loading_tasks')
      .update({ status: 'ARRIVED', arrived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('task_id', taskId)
      .select()
      .single();
    if (result.error) throw result.error;

    // 更新车辆状态
    const task = result.data;
    if (task.vehicle_id) {
      await this.supabase
        .from('vehicles')
        .update({ status: 'AVAILABLE', updated_at: new Date().toISOString() })
        .eq('vehicle_id', task.vehicle_id);
    }

    return result.data;
  }

  // =====================================================================
  // 交接单/发运单据
  // =====================================================================

  async generateShippingDoc(data: any): Promise<any> {
    const docNo = `DOC-${data.doc_type}-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    // 根据类型生成文档内容
    let docContent: any = {};
    if (data.loading_task_id) {
      const task = await this.getLoadingTask(data.loading_task_id);
      if (task) {
        docContent = {
          task_id: data.loading_task_id,
          vehicle: task.vehicle_id,
          seal_no: task.seal_no,
          weight: task.actual_weight,
          volume: task.actual_volume,
        };
      }
    }

    const result = await this.supabase
      .from('shipping_documents')
      .insert({ ...data, doc_no: docNo, doc_content: docContent })
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async getShippingDocs(taskId?: string): Promise<any[]> {
    let query = this.supabase.from('shipping_documents').select('*');
    if (taskId) query = query.eq('loading_task_id', taskId);
    const result = await query.order('generated_at', { ascending: false });
    if (result.error) throw result.error;
    return result.data || [];
  }

  async printDocument(docId: string): Promise<{ content: string }> {
    const result = await this.supabase
      .from('shipping_documents')
      .update({ printed_at: new Date().toISOString() })
      .eq('doc_id', docId)
      .select()
      .single();
    if (result.error) throw result.error;

    // 简单返回 JSON，实际应渲染 PDF/ZPL
    return { content: JSON.stringify(result.data.doc_content, null, 2) };
  }

  async signDocument(docId: string, signerId: string): Promise<any> {
    const result = await this.supabase
      .from('shipping_documents')
      .update({ signed_at: new Date().toISOString(), signer_id: signerId })
      .eq('doc_id', docId)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  // =====================================================================
  // 载重校验
  // =====================================================================

  async validateLoad(vehicleId: string, plannedWeight: number, plannedVolume: number): Promise<{
    valid: boolean;
    warnings: string[];
  }> {
    const vehicle = await this.getVehicle(vehicleId);
    if (!vehicle) throw new Error('Vehicle not found');

    const warnings: string[] = [];
    let valid = true;

    if (vehicle.max_weight && plannedWeight > vehicle.max_weight) {
      valid = false;
      warnings.push(`Planned weight ${plannedWeight}kg exceeds vehicle max ${vehicle.max_weight}kg`);
    } else if (vehicle.max_weight && plannedWeight > vehicle.max_weight * 0.9) {
      warnings.push(`Planned weight ${plannedWeight}kg is close to vehicle max ${vehicle.max_weight}kg`);
    }

    if (vehicle.max_volume && plannedVolume > vehicle.max_volume) {
      valid = false;
      warnings.push(`Planned volume ${plannedVolume}m³ exceeds vehicle max ${vehicle.max_volume}m³`);
    }

    return { valid, warnings };
  }

  // =====================================================================
  // 装载顺序优化 (简单实现)
  // =====================================================================

  async optimizeLoadSequence(
    items: { container_id: string; weight: number; volume: number; priority?: number }[],
    vehicleId: string
  ): Promise<{ container_id: string; sequence: number }[]> {
    // 简单策略：重的在前、底层；轻的在后、顶层
    const sorted = [...items].sort((a, b) => (b.weight - a.weight) || (b.priority || 0) - (a.priority || 0));
    return sorted.map((item, index) => ({
      container_id: item.container_id,
      sequence: index + 1,
    }));
  }
}