import { SupabaseClient } from '../supabase/SupabaseClient';

/**
 * 工单服务
 * 完整生命周期：创建 → 派遣 → 执行 → 完成/异常
 * 支持工单嵌套：parent_wo_id (如补货工单下的拣货子工单)
 */
export type WorkOrderType = 'PICK' | 'PUTAWAY' | 'COUNT' | 'REPLENISH' | 'VAS' | 'RETURN';
export type WorkOrderStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'EXCEPTION' | 'CANCELLED';

export interface WorkOrderInput {
  tenantId: string;
  type: WorkOrderType;
  orderId?: string;
  waveId?: string;
  parentWoId?: string;           // 父工单（嵌套）
  assignedUserId?: string;
  deviceId?: string;
  expectedDurationSeconds?: number;
  pdaSummary?: string;           // PDA 显示摘要
  metadata?: Record<string, any>;
}

export interface WorkOrderUpdateInput {
  status?: WorkOrderStatus;
  assignedUserId?: string;
  deviceId?: string;
  acceptedAt?: Date;
  completedAt?: Date;
  exceptionReason?: string;
  metadata?: Record<string, any>;
}

export interface WorkOrder {
  id: string;
  tenant_id: string;
  type: WorkOrderType;
  status: WorkOrderStatus;
  order_id?: string;
  wave_id?: string;
  parent_wo_id?: string;
  assigned_user_id?: string;
  device_id?: string;
  expected_duration_seconds?: number;
  pda_summary?: string;
  accepted_at?: Date;
  completed_at?: Date;
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, any>;
}

export class WorkOrderService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * 创建工单
   */
  async create(input: WorkOrderInput): Promise<WorkOrder> {
    const { data, error } = await this.supabase
      .from('work_orders')
      .insert({
        tenant_id: input.tenantId,
        type: input.type,
        status: 'OPEN',
        order_id: input.orderId,
        wave_id: input.waveId,
        parent_wo_id: input.parentWoId,
        assigned_user_id: input.assignedUserId,
        device_id: input.deviceId,
        expected_duration_seconds: input.expectedDurationSeconds,
        pda_summary: input.pdaSummary,
        metadata: input.metadata,
      })
      .select()
      .single();

    if (error) throw new Error(`创建工单失败: ${error.message}`);
    return this.mapRow(data);
  }

  /**
   * 批量创建工单（波次拣货批量派单）
   */
  async createBatch(inputs: WorkOrderInput[]): Promise<WorkOrder[]> {
    const records = inputs.map(i => ({
      tenant_id: i.tenantId,
      type: i.type,
      status: 'OPEN' as WorkOrderStatus,
      order_id: i.orderId,
      wave_id: i.waveId,
      parent_wo_id: i.parentWoId,
      assigned_user_id: i.assignedUserId,
      device_id: i.deviceId,
      expected_duration_seconds: i.expectedDurationSeconds,
      pda_summary: i.pdaSummary,
      metadata: i.metadata,
    }));

    const { data, error } = await this.supabase
      .from('work_orders')
      .insert(records)
      .select();

    if (error) throw new Error(`批量创建工单失败: ${error.message}`);
    return (data || []).map(this.mapRow);
  }

  /**
   * 更新工单状态
   */
  async update(woId: string, input: WorkOrderUpdateInput): Promise<WorkOrder> {
    const updateData: any = { updated_at: new Date().toISOString() };

    if (input.status) updateData.status = input.status;
    if (input.assignedUserId) updateData.assigned_user_id = input.assignedUserId;
    if (input.deviceId) updateData.device_id = input.deviceId;
    if (input.acceptedAt) updateData.accepted_at = input.acceptedAt.toISOString();
    if (input.completedAt) updateData.completed_at = input.completedAt.toISOString();
    if (input.exceptionReason) updateData.exception_reason = input.exceptionReason;
    if (input.metadata) updateData.metadata = input.metadata;

    // 状态流转触发时间戳
    if (input.status === 'ASSIGNED' && !updateData.accepted_at) {
      updateData.accepted_at = new Date().toISOString();
    }
    if (input.status === 'COMPLETED' && !updateData.completed_at) {
      updateData.completed_at = new Date().toISOString();
    }

    const { data, error } = await this.supabase
      .from('work_orders')
      .update(updateData)
      .eq('id', woId)
      .select()
      .single();

    if (error) throw new Error(`更新工单失败: ${error.message}`);
    return this.mapRow(data);
  }

  /**
   * 接单（操作员接受工单）
   */
  async accept(woId: string, userId: string, deviceId?: string): Promise<WorkOrder> {
    return this.update(woId, {
      status: 'ASSIGNED',
      assignedUserId: userId,
      deviceId,
      acceptedAt: new Date(),
    });
  }

  /**
   * 开始执行
   */
  async start(woId: string): Promise<WorkOrder> {
    return this.update(woId, { status: 'IN_PROGRESS' });
  }

  /**
   * 完成工单
   */
  async complete(woId: string, userId: string): Promise<WorkOrder> {
    return this.update(woId, {
      status: 'COMPLETED',
      completedAt: new Date(),
    });
  }

  /**
   * 标记异常
   */
  async exception(woId: string, reason: string): Promise<WorkOrder> {
    return this.update(woId, {
      status: 'EXCEPTION',
      exceptionReason: reason,
    });
  }

  /**
   * 获取工单详情
   */
  async getById(woId: string): Promise<WorkOrder | null> {
    const { data, error } = await this.supabase
      .from('work_orders')
      .select('*')
      .eq('id', woId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`获取工单失败: ${error.message}`);
    }
    return this.mapRow(data);
  }

  /**
   * 查询工单列表（支持多条件过滤）
   */
  async list(filters: {
    tenantId?: string;
    status?: WorkOrderStatus | WorkOrderStatus[];
    type?: WorkOrderType | WorkOrderType[];
    assignedUserId?: string;
    waveId?: string;
    orderId?: string;
    parentWoId?: string;
    dateFrom?: Date;
    dateTo?: Date;
    page?: number;
    pageSize?: number;
  }): Promise<{ data: WorkOrder[]; total: number }> {
    let query = this.supabase.from('work_orders').select('*', { count: 'exact' });

    if (filters.tenantId) query = query.eq('tenant_id', filters.tenantId);
    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      query = query.in('status', statuses);
    }
    if (filters.type) {
      const types = Array.isArray(filters.type) ? filters.type : [filters.type];
      query = query.in('type', types);
    }
    if (filters.assignedUserId) query = query.eq('assigned_user_id', filters.assignedUserId);
    if (filters.waveId) query = query.eq('wave_id', filters.waveId);
    if (filters.orderId) query = query.eq('order_id', filters.orderId);
    if (filters.parentWoId) query = query.eq('parent_wo_id', filters.parentWoId);
    if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom.toISOString());
    if (filters.dateTo) query = query.lte('created_at', filters.dateTo.toISOString());

    query = query.order('created_at', { ascending: false });

    const page = filters.page || 1;
    const pageSize = filters.pageSize || 20;
    query = query.range((page - 1) * pageSize, page * pageSize - 1);

    const { data, error, count } = await query;

    if (error) throw new Error(`查询工单失败: ${error.message}`);

    return {
      data: (data || []).map(this.mapRow),
      total: count || 0,
    };
  }

  /**
   * 获取子工单
   */
  async getChildren(parentWoId: string): Promise<WorkOrder[]> {
    const { data, error } = await this.supabase
      .from('work_orders')
      .select('*')
      .eq('parent_wo_id', parentWoId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(`获取子工单失败: ${error.message}`);
    return (data || []).map(this.mapRow);
  }

  /**
   * 获取工单统计（用于驾驶舱）
   */
  async getStats(tenantId: string, dateFrom: Date, dateTo: Date): Promise<{
    total: number;
    byStatus: Record<WorkOrderStatus, number>;
    byType: Record<WorkOrderType, number>;
    avgDurationSeconds: number;
    exceptionRate: number;
    pph: number; // 每小时拣货件数
  }> {
    const { data, error } = await this.supabase
      .from('work_orders')
      .select(`
        id, status, type, accepted_at, completed_at,
        wo_action_logs(qty_acted, start_at, end_at)
      `)
      .eq('tenant_id', tenantId)
      .gte('created_at', dateFrom.toISOString())
      .lte('created_at', dateTo.toISOString());

    if (error) throw new Error(`获取工单统计失败: ${error.message}`);

    const stats = {
      total: 0,
      byStatus: {} as Record<WorkOrderStatus, number>,
      byType: {} as Record<WorkOrderType, number>,
      avgDurationSeconds: 0,
      exceptionRate: 0,
      pph: 0,
    };

    let totalDuration = 0;
    let completedCount = 0;
    let totalQty = 0;
    let totalHours = 0;

    for (const wo of data || []) {
      stats.total++;
      stats.byStatus[wo.status as WorkOrderStatus] = (stats.byStatus[wo.status as WorkOrderStatus] || 0) + 1;
      stats.byType[wo.type as WorkOrderType] = (stats.byType[wo.type as WorkOrderType] || 0) + 1;

      if (wo.accepted_at && wo.completed_at) {
        const duration = (new Date(wo.completed_at).getTime() - new Date(wo.accepted_at).getTime()) / 1000;
        totalDuration += duration;
        completedCount++;
      }

      // 累加动作日志量
      for (const log of wo.wo_action_logs || []) {
        if (log.qty_acted) totalQty += log.qty_acted;
        if (log.start_at && log.end_at) {
          totalHours += (new Date(log.end_at).getTime() - new Date(log.start_at).getTime()) / 3600000;
        }
      }
    }

    stats.avgDurationSeconds = completedCount > 0 ? totalDuration / completedCount : 0;
    stats.exceptionRate = stats.total > 0 ? (stats.byStatus['EXCEPTION'] || 0) / stats.total : 0;
    stats.pph = totalHours > 0 ? totalQty / totalHours : 0;

    return stats;
  }

  private mapRow(row: any): WorkOrder {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      type: row.type,
      status: row.status,
      order_id: row.order_id,
      wave_id: row.wave_id,
      parent_wo_id: row.parent_wo_id,
      assigned_user_id: row.assigned_user_id,
      device_id: row.device_id,
      expected_duration_seconds: row.expected_duration_seconds,
      pda_summary: row.pda_summary,
      accepted_at: row.accepted_at ? new Date(row.accepted_at) : undefined,
      completed_at: row.completed_at ? new Date(row.completed_at) : undefined,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      metadata: row.metadata,
    };
  }
}

export default WorkOrderService;