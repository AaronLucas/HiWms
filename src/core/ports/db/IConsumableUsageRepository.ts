/**
 * 耗材使用仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type ConsumableUsageRow = Tables<'consumable_usages'>;
export type ConsumableUsageInsert = TablesInsert<'consumable_usages'>;
export type ConsumableUsageUpdate = TablesUpdate<'consumable_usages'>;

export interface IConsumableUsageRepository extends IRepository<ConsumableUsageRow, ConsumableUsageInsert, ConsumableUsageUpdate> {
  /**
   * 按租户查找耗材使用记录（分页、任务/类型/日期过滤）
   */
  findByTenant(
    tenantId: string,
    options?: {
      limit?: number;
      offset?: number;
      packingTaskId?: string;
      itemType?: string;
      startDate?: string;
      endDate?: string
    }
  ): Promise<ConsumableUsageRow[]>;

  /**
   * 按打包任务查找耗材使用
   */
  findByPackingTask(packingTaskId: string): Promise<ConsumableUsageRow[]>;

  /**
   * 记录耗材使用
   */
  recordUsage(data: ConsumableUsageInsert): Promise<ConsumableUsageRow>;

  /**
   * 获取耗材消耗统计
   */
  getStats(tenantId: string, startDate: string, endDate: string): Promise<{
    totalQty: number;
    totalCost: number;
    byType: Record<string, { qty: number; cost: number }>;
    byTask: Record<string, { qty: number; cost: number }>;
  }>;

  /**
   * 获取耗材库存预警（低库存）
   */
  getLowStockAlerts(tenantId: string, thresholdDays: number): Promise<Array<{
    itemCode: string;
    itemType: string;
    avgDailyUsage: number;
    estimatedDaysLeft: number;
  }>>;
}