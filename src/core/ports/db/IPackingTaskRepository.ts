/**
 * 打包任务仓储端口接口
 * 聚合根：PackingTask + ConsumableUsages
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

export type PackingTaskRow = Tables<'packing_tasks'>;
export type PackingTaskInsert = TablesInsert<'packing_tasks'>;
export type PackingTaskUpdate = TablesUpdate<'packing_tasks'>;

export type ConsumableUsageRow = Tables<'consumable_usages'>;
export type ConsumableUsageInsert = TablesInsert<'consumable_usages'>;
export type ConsumableUsageUpdate = TablesUpdate<'consumable_usages'>;

export interface PackingTaskWithConsumables {
  task: PackingTaskRow;
  consumables: ConsumableUsageRow[];
}

export interface IPackingTaskRepository extends IRepository<PackingTaskRow, PackingTaskInsert, PackingTaskUpdate> {
  /**
   * 按租户查找打包任务（分页、状态过滤）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; packerId?: string; waveId?: string }
  ): Promise<PackingTaskRow[]>;

  /**
   * 查找打包任务及其耗材使用
   */
  findWithConsumables(taskId: string): Promise<PackingTaskWithConsumables | null>;

  /**
   * 查找待打包任务
   */
  findPendingPacking(tenantId: string): Promise<PackingTaskRow[]>;

  /**
   * 查找待打印面单任务
   */
  findPendingLabelPrint(tenantId: string): Promise<PackingTaskRow[]>;

  /**
   * 查找待封箱任务
   */
  findPendingSeal(tenantId: string): Promise<PackingTaskRow[]>;

  /**
   * 更新任务状态
   */
  updateStatus(taskId: string, status: string, extra?: { startedAt?: string; completedAt?: string; exceptionReason?: string }): Promise<PackingTaskRow>;

  /**
   * 记录打包完成（箱数、重量、体积、面单号）
   */
  recordPackingComplete(
    taskId: string,
    data: { boxesPacked: number; totalWeight: number; totalVolume: number; trackingNumbers: string[] }
  ): Promise<PackingTaskRow>;

  /**
   * 记录面单打印
   */
  recordLabelPrint(taskId: string, count: number): Promise<PackingTaskRow>;

  /**
   * 记录耗材使用
   */
  recordConsumableUsage(usage: ConsumableUsageInsert): Promise<ConsumableUsageRow>;

  /**
   * 获取打包效率统计
   */
  getEfficiencyStats(tenantId: string, startDate: string, endDate: string): Promise<{
    completedTasks: number;
    totalBoxes: number;
    totalLabels: number;
    avgDurationMinutes: number;
    totalWeightKg: number;
  }>;

  /**
   * 获取打包员绩效统计
   */
  getPackerPerformance(tenantId: string, startDate: string, endDate: string): Promise<Array<{
    packerId: string;
    packerName: string;
    taskCount: number;
    boxCount: number;
    labelCount: number;
    avgDurationMinutes: number;
  }>>;
}