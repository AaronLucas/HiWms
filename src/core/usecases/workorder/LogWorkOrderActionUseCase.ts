/**
 * 记录工单动作日志用例
 * 替代 ActionLogService，使用 IWorkOrderRepository 端口
 */
import { IWorkOrderRepository } from '@core/ports/db/IWorkOrderRepository';
import type { Tables } from '@/types/database';

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
  capturedData?: Record<string, any>;
  durationMs?: number;
}

export interface ActionLogOutput {
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

export class LogWorkOrderActionUseCase {
  constructor(private workOrderRepo: IWorkOrderRepository) {}

  /**
   * 记录动作开始
   * 返回 log_id，后续用于记录结束
   */
  async start(input: ActionLogInput): Promise<{ logId: number }> {
    const log = await this.workOrderRepo.logAction({
      wo_id: input.woId,
      sku_id: input.skuId ?? null,
      action_type: input.actionType,
      from_loc_id: input.fromLocId ?? null,
      to_loc_id: input.toLocId ?? null,
      qty_acted: input.qtyActed ?? null,
      start_at: new Date().toISOString(),
      end_at: null,
      captured_data: input.capturedData ?? null,
    } as any);

    return { logId: log.log_id };
  }

  /**
   * 记录动作结束（更新同一条记录）
   */
  async end(logId: number, updates: {
    qtyActed?: number;
    serialNumbers?: string[];
    capturedData?: Record<string, any>;
  } = {}): Promise<ActionLogOutput> {
    const updateData: any = {
      end_at: new Date().toISOString(),
    };

    if (updates.qtyActed !== undefined) updateData.qty_acted = updates.qtyActed;
    if (updates.serialNumbers) updateData.captured_data = { serial_numbers: updates.serialNumbers };
    if (updates.capturedData) updateData.captured_data = { ...updateData.captured_data, ...updates.capturedData };

    const log = await this.workOrderRepo.updateActionLog(logId, updateData);

    return this.mapRow(log);
  }

  /**
   * 完整记录一个动作（开始+结束一次性完成，适用于快速操作）
   */
  async record(input: ActionLogInput & { durationMs?: number }): Promise<ActionLogOutput> {
    const startAt = new Date();
    const endAt = input.durationMs ? new Date(startAt.getTime() + input.durationMs) : new Date();

    const log = await this.workOrderRepo.logAction({
      wo_id: input.woId,
      sku_id: input.skuId ?? null,
      action_type: input.actionType,
      from_loc_id: input.fromLocId ?? null,
      to_loc_id: input.toLocId ?? null,
      qty_acted: input.qtyActed ?? null,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      captured_data: {
        ...input.capturedData,
        serial_numbers: input.serialNumbers,
      },
    } as any);

    return this.mapRow(log);
  }

  /**
   * 批量记录动作
   */
  async recordBatch(inputs: (ActionLogInput & { durationMs?: number })[]): Promise<ActionLogOutput[]> {
    const results: ActionLogOutput[] = [];
    for (const input of inputs) {
      results.push(await this.record(input));
    }
    return results;
  }

  /**
   * 获取工单的所有动作日志
   */
  async getByWorkOrder(woId: string): Promise<ActionLogOutput[]> {
    const logs = await this.workOrderRepo.getActionLogsByWorkOrder(woId);
    return logs.map(this.mapRow);
  }

  /**
   * 获取操作员的动作日志（用于绩效考核）
   */
  async getByOperator(
    operatorId: string,
    dateFrom: Date,
    dateTo: Date,
    actionType?: ActionType
  ): Promise<ActionLogOutput[]> {
    let logs = await this.workOrderRepo.getActionLogsByOperator(operatorId, dateFrom, dateTo);

    if (actionType) {
      logs = logs.filter(l => l.action_type === actionType);
    }

    return logs.map(this.mapRow);
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
    const logs = await this.workOrderRepo.getActionLogsByOperator(operatorId, dateFrom, dateTo);

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
  ): Promise<ActionLogOutput[]> {
    const logs = await this.workOrderRepo.getExceptionLogs(tenantId, dateFrom, dateTo);
    return logs.map(this.mapRow);
  }

  private mapRow(row: any): ActionLogOutput {
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

export default LogWorkOrderActionUseCase;