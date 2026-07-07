import { SupabaseClient } from '../supabase/SupabaseClient';

/**
 * 工单动作日志服务
 * 记录原子操作：SCAN_LPN, PICK_SKU, PACK_CONFIRM, PUTAWAY, COUNT, SCAN_SERIAL
 * 用于：人效分析(PPH)、异常追溯、老板驾驶舱数据源
 */
export type ActionType =
  | 'SCAN_LPN'
  | 'SCAN_SERIAL'
  | 'PICK_SKU'
  | 'PUTAWAY'
  | 'PACK_CONFIRM'
  | 'COUNT'
  | 'REPLENISH_PICK'
  | 'REPLENISH_PUT'
  | 'VAS_RELABEL'
  | 'VAS_KITTING'
  | 'EXCEPTION';

export interface ActionLogInput {
  woId: string;
  skuId?: string;
  actionType: ActionType;
  fromLocId?: string;
  toLocId?: string;
  qtyActed?: number;
  serialNumbers?: string[];
  capturedData?: Record<string, any>; // 异常原因、照片、备注等
}

export interface ActionLog {
  id: number;
  wo_id: string;
  sku_id?: string;
  action_type: ActionType;
  from_loc_id?: string;
  to_loc_id?: string;
  qty_acted?: number;
  start_at: Date;
  end_at: Date;
  captured_data?: Record<string, any>;
  created_at: Date;
}

export class ActionLogService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * 记录动作开始
   * 返回 log_id，后续用于记录结束
   */
  async start(input: ActionLogInput): Promise<number> {
    const { data, error } = await this.supabase
      .from('wo_action_logs')
      .insert({
        wo_id: input.woId,
        sku_id: input.skuId,
        action_type: input.actionType,
        from_loc_id: input.fromLocId,
        to_loc_id: input.toLocId,
        qty_acted: input.qtyActed,
        start_at: new Date().toISOString(),
        captured_data: input.capturedData,
      })
      .select('log_id')
      .single();

    if (error) throw new Error(`记录动作开始失败: ${error.message}`);
    return data.log_id;
  }

  /**
   * 记录动作结束（更新同一条记录）
   */
  async end(logId: number, updates: {
    qtyActed?: number;
    serialNumbers?: string[];
    capturedData?: Record<string, any>;
  } = {}): Promise<ActionLog> {
    const updateData: any = {
      end_at: new Date().toISOString(),
    };

    if (updates.qtyActed !== undefined) updateData.qty_acted = updates.qtyActed;
    if (updates.serialNumbers) updateData.captured_data = { ...updateData.captured_data, serial_numbers: updates.serialNumbers };
    if (updates.capturedData) updateData.captured_data = { ...updateData.captured_data, ...updates.capturedData };

    const { data, error } = await this.supabase
      .from('wo_action_logs')
      .update(updateData)
      .eq('log_id', logId)
      .select()
      .single();

    if (error) throw new Error(`记录动作结束失败: ${error.message}`);
    return this.mapRow(data);
  }

  /**
   * 完整记录一个动作（开始+结束一次性完成，适用于快速操作）
   */
  async record(input: ActionLogInput & { durationMs?: number }): Promise<ActionLog> {
    const startAt = new Date();
    const endAt = input.durationMs ? new Date(startAt.getTime() + input.durationMs) : new Date();

    const { data, error } = await this.supabase
      .from('wo_action_logs')
      .insert({
        wo_id: input.woId,
        sku_id: input.skuId,
        action_type: input.actionType,
        from_loc_id: input.fromLocId,
        to_loc_id: input.toLocId,
        qty_acted: input.qtyActed,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        captured_data: {
          ...input.capturedData,
          serial_numbers: input.serialNumbers,
        },
      })
      .select()
      .single();

    if (error) throw new Error(`记录动作失败: ${error.message}`);
    return this.mapRow(data);
  }

  /**
   * 批量记录动作
   */
  async recordBatch(inputs: (ActionLogInput & { durationMs?: number })[]): Promise<ActionLog[]> {
    const records = inputs.map(input => {
      const startAt = new Date();
      const endAt = input.durationMs ? new Date(startAt.getTime() + input.durationMs) : new Date();
      return {
        wo_id: input.woId,
        sku_id: input.skuId,
        action_type: input.actionType,
        from_loc_id: input.fromLocId,
        to_loc_id: input.toLocId,
        qty_acted: input.qtyActed,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        captured_data: {
          ...input.capturedData,
          serial_numbers: input.serialNumbers,
        },
      };
    });

    const { data, error } = await this.supabase
      .from('wo_action_logs')
      .insert(records)
      .select();

    if (error) throw new Error(`批量记录动作失败: ${error.message}`);
    return (data || []).map(this.mapRow);
  }

  /**
   * 获取工单的所有动作日志
   */
  async getByWorkOrder(woId: string): Promise<ActionLog[]> {
    const { data, error } = await this.supabase
      .from('wo_action_logs')
      .select('*')
      .eq('wo_id', woId)
      .order('start_at', { ascending: true });

    if (error) throw new Error(`获取动作日志失败: ${error.message}`);
    return (data || []).map(this.mapRow);
  }

  /**
   * 获取操作员的动作日志（用于绩效考核）
   */
  async getByOperator(
    operatorId: string,
    dateFrom: Date,
    dateTo: Date,
    actionType?: ActionType
  ): Promise<ActionLog[]> {
    // 通过 work_orders 关联查询
    const { data, error } = await this.supabase
      .from('wo_action_logs')
      .select(`
        *,
        work_orders!inner(assigned_user_id)
      `)
      .eq('work_orders.assigned_user_id', operatorId)
      .gte('start_at', dateFrom.toISOString())
      .lte('start_at', dateTo.toISOString())
      .order('start_at', { ascending: true });

    if (error) throw new Error(`获取操作员动作日志失败: ${error.message}`);

    let logs = (data || []).map(this.mapRow);

    if (actionType) {
      logs = logs.filter((l: ActionLog) => l.action_type === actionType);
    }

    return logs;
  }

  /**
   * 计算操作员 PPH (每小时拣货件数)
   */
  async calculatePPH(
    operatorId: string,
    dateFrom: Date,
    dateTo: Date
  ): Promise<{
    totalQty: number;
    totalHours: number;
    pph: number;
    byActionType: Record<ActionType, { qty: number; hours: number; pph: number }>;
  }> {
    const logs = await this.getByOperator(operatorId, dateFrom, dateTo);

    let totalQty = 0;
    let totalHours = 0;
    const byAction: Record<string, { qty: number; hours: number }> = {};

    for (const log of logs) {
      const qty = log.qty_acted || 0;
      const hours = (log.end_at.getTime() - log.start_at.getTime()) / 3600000;

      totalQty += qty;
      totalHours += hours;

      if (!byAction[log.action_type]) {
        byAction[log.action_type] = { qty: 0, hours: 0 };
      }
      byAction[log.action_type].qty += qty;
      byAction[log.action_type].hours += hours;
    }

    const byActionType: Record<ActionType, { qty: number; hours: number; pph: number }> = {} as any;
    for (const [action, stats] of Object.entries(byAction)) {
      byActionType[action as ActionType] = {
        qty: stats.qty,
        hours: stats.hours,
        pph: stats.hours > 0 ? stats.qty / stats.hours : 0,
      };
    }

    return {
      totalQty,
      totalHours,
      pph: totalHours > 0 ? totalQty / totalHours : 0,
      byActionType,
    };
  }

  /**
   * 获取异常动作日志（用于异常分析）
   */
  async getExceptions(
    tenantId: string,
    dateFrom: Date,
    dateTo: Date
  ): Promise<ActionLog[]> {
    const { data, error } = await this.supabase
      .from('wo_action_logs')
      .select(`
        *,
        work_orders!inner(tenant_id, status)
      `)
      .eq('work_orders.tenant_id', tenantId)
      .eq('action_type', 'EXCEPTION')
      .gte('start_at', dateFrom.toISOString())
      .lte('start_at', dateTo.toISOString())
      .order('start_at', { ascending: false });

    if (error) throw new Error(`获取异常日志失败: ${error.message}`);
    return (data || []).map(this.mapRow);
  }

  private mapRow(row: any): ActionLog {
    return {
      id: row.log_id,
      wo_id: row.wo_id,
      sku_id: row.sku_id,
      action_type: row.action_type,
      from_loc_id: row.from_loc_id,
      to_loc_id: row.to_loc_id,
      qty_acted: row.qty_acted,
      start_at: new Date(row.start_at),
      end_at: new Date(row.end_at),
      captured_data: row.captured_data,
      created_at: new Date(row.created_at),
    };
  }
}

export default ActionLogService;