// src/services/PackingService.ts
// Phase A: 打包/封箱服务 - 装箱算法、面单打印、耗材扣减

import { SupabaseClient } from '../supabase/SupabaseClient';

export class PackingService {
  private supabase: SupabaseClient;

  constructor(tenantId: string) {
    this.supabase = new SupabaseClient({
      defaultTenantId: tenantId,
      url: process.env.SUPABASE_URL!,
      anonKey: process.env.SUPABASE_ANON_KEY!,
    });
  }

  // =====================================================================
  // 包装规格管理
  // =====================================================================

  async createPackageSpec(data: any): Promise<any> {
    const result = await this.supabase
      .from('package_specs')
      .insert(data)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async getPackageSpecs(): Promise<any[]> {
    const result = await this.supabase
      .from('package_specs')
      .select('*')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });
    if (result.error) throw result.error;
    return result.data || [];
  }

  async getDefaultSpec(): Promise<any | null> {
    const result = await this.supabase
      .from('package_specs')
      .select('*')
      .eq('is_default', true)
      .single();
    if (result.error) return null;
    return result.data;
  }

  // =====================================================================
  // 面单模板管理
  // =====================================================================

  async createLabelTemplate(data: any): Promise<any> {
    const result = await this.supabase
      .from('label_templates')
      .insert(data)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async getLabelTemplates(type?: string): Promise<any[]> {
    let query = this.supabase.from('label_templates').select('*').eq('is_active', true);
    if (type) query = query.eq('label_type', type);
    const result = await query.order('created_at', { ascending: false });
    if (result.error) throw result.error;
    return result.data || [];
  }

  // =====================================================================
  // 打包任务管理
  // =====================================================================

  async createPackingTask(data: any): Promise<any> {
    // 如果未指定规格，使用默认规格
    let specId = data.spec_id;
    if (!specId) {
      const defaultSpec = await this.getDefaultSpec();
      if (defaultSpec) specId = defaultSpec.spec_id;
    }

    // 如果未指定模板，使用默认发货面单模板
    let templateId = data.template_id;
    if (!templateId) {
      const templates = await this.getLabelTemplates('SHIPPING');
      if (templates.length > 0) templateId = templates[0].template_id;
    }

    const taskNo = `PK-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    const result = await this.supabase
      .from('packing_tasks')
      .insert({ ...data, task_no: taskNo, spec_id: specId, template_id: templateId, packed_items: [] })
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async getPackingTasks(
    orderId?: string,
    waveId?: string,
    status?: string
  ): Promise<any[]> {
    let query = this.supabase.from('packing_tasks').select('*');
    if (orderId) query = query.eq('order_id', orderId);
    if (waveId) query = query.eq('wave_id', waveId);
    if (status) query = query.eq('status', status);
    const result = await query.order('created_at', { ascending: false });
    if (result.error) throw result.error;
    return result.data || [];
  }

  async getPackingTask(taskId: string): Promise<any | null> {
    const result = await this.supabase
      .from('packing_tasks')
      .select('*')
      .eq('task_id', taskId)
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async startPacking(taskId: string, userId: string): Promise<any> {
    const result = await this.supabase
      .from('packing_tasks')
      .update({ status: 'PACKING', assigned_to: userId, updated_at: new Date().toISOString() })
      .eq('task_id', taskId)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async addPackedItems(taskId: string, items: any[]): Promise<any> {
    const task = await this.getPackingTask(taskId);
    if (!task) throw new Error('Packing task not found');

    const updatedItems = [...task.packed_items, ...items];
    const result = await this.supabase
      .from('packing_tasks')
      .update({ packed_items: updatedItems, updated_at: new Date().toISOString() })
      .eq('task_id', taskId)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async weighTask(taskId: string, weight: number, volume?: number): Promise<any> {
    const result = await this.supabase
      .from('packing_tasks')
      .update({ status: 'WEIGHED', actual_weight: weight, actual_volume: volume, updated_at: new Date().toISOString() })
      .eq('task_id', taskId)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  async printLabel(taskId: string): Promise<{ labelData: string; trackingNo: string }> {
    const task = await this.getPackingTask(taskId);
    if (!task) throw new Error('Packing task not found');

    // 生成运单号
    const trackingNo = `TN${Date.now()}${Math.random().toString(36).substr(2, 8).toUpperCase()}`;

    // 获取模板
    let templateContent: any = {};
    if (task.template_id) {
      const templateResult = await this.supabase
        .from('label_templates')
        .select('template_content, print_format')
        .eq('template_id', task.template_id)
        .single();
      if (templateResult.data) templateContent = templateResult.data;
    }

    // 生成标签数据 (ZPL/PDF/HTML)
    const labelData = this.generateLabel(templateContent, {
      trackingNo,
      orderId: task.order_id,
      items: task.packed_items,
      weight: task.actual_weight,
      volume: task.actual_volume,
    });

    // 更新任务
    await this.supabase
      .from('packing_tasks')
      .update({
        tracking_no: trackingNo,
        label_printed_at: new Date().toISOString(),
        status: 'LABELED',
        updated_at: new Date().toISOString(),
      })
      .eq('task_id', taskId);

    return { labelData, trackingNo };
  }

  async sealTask(taskId: string): Promise<any> {
    const result = await this.supabase
      .from('packing_tasks')
      .update({ status: 'SEALED', sealed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('task_id', taskId)
      .select()
      .single();
    if (result.error) throw result.error;

    // 记录耗材使用
    await this.recordConsumableUsage(taskId);

    return result.data;
  }

  async completeTask(taskId: string): Promise<any> {
    const result = await this.supabase
      .from('packing_tasks')
      .update({ status: 'COMPLETED', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('task_id', taskId)
      .select()
      .single();
    if (result.error) throw result.error;
    return result.data;
  }

  // =====================================================================
  // 装箱算法 (简单实现)
  // =====================================================================

  async suggestPacking(items: any[]): Promise<{
    spec_id: string;
    items_per_box: { sku_id: string; qty: number }[];
    estimatedBoxes: number;
  }> {
    const specs = await this.getPackageSpecs();
    if (specs.length === 0) throw new Error('No package specs available');

    // 简单策略：使用默认规格，计算所需箱数
    const defaultSpec = specs.find(s => s.is_default) || specs[0];
    const totalItems = items.reduce((sum, i) => sum + i.qty, 0);
    const estimatedBoxes = Math.ceil(totalItems / defaultSpec.max_items);

    return {
      spec_id: defaultSpec.spec_id,
      items_per_box: items.map(i => ({ sku_id: i.sku_id, qty: i.qty })),
      estimatedBoxes,
    };
  }

  // =====================================================================
  // 耗材记录
  // =====================================================================

  private async recordConsumableUsage(taskId: string): Promise<void> {
    const taskResult = await this.supabase
      .from('packing_tasks')
      .select('spec_id')
      .eq('task_id', taskId)
      .single();
    if (taskResult.error || !taskResult.data?.spec_id) return;

    // 查找该规格关联的耗材 (简化：假设每箱消耗1个箱子、1卷胶带)
    const specResult = await this.supabase
      .from('package_specs')
      .select('material')
      .eq('spec_id', taskResult.data.spec_id)
      .single();
    if (specResult.error) return;

    // 这里应有耗材 SKU 映射表，简化处理
    const consumables = [
      { sku_code: 'BOX-STD', qty: 1 },
      { sku_code: 'TAPE-STD', qty: 0.1 }, // 卷
    ];

    for (const c of consumables) {
      const skuResult = await this.supabase
        .from('products')
        .select('sku_id')
        .eq('sku_code', c.sku_code)
        .single();
      if (skuResult.data) {
        await this.supabase.from('consumable_usages').insert({
          tenant_id: '', // 从 context 获取
          packing_task_id: '', // 从 context 获取
          sku_id: skuResult.data.sku_id,
          qty_used: c.qty,
        });
      }
    }
  }

  // =====================================================================
  // 标签生成 (简化实现)
  // =====================================================================

  private generateLabel(template: any, data: any): string {
    if (!template?.template_content) {
      // 默认 ZPL 简单标签
      return `
^XA
^FO50,50^A0N,50,50^FD${data.trackingNo}^FS
^FO50,120^A0N,30,30^FDOrder: ${data.orderId || 'N/A'}^FS
^FO50,160^A0N,30,30^FDWeight: ${data.weight || 0} kg^FS
^FO50,200^BY3
^BCN,100,Y,N,N
^FD${data.trackingNo}^FS
^XZ
      `.trim();
    }

    // 根据模板渲染 (简化：返回 JSON 供前端渲染)
    return JSON.stringify({ template: template.template_content, data });
  }
}