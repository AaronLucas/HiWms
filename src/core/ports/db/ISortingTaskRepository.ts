/**
 * 分拣任务仓储端口接口
 * 聚合根：SortingTask + SortingChute
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type SortingTaskRow = Tables<'sorting_tasks'>;
export type SortingTaskInsert = TablesInsert<'sorting_tasks'>;
export type SortingTaskUpdate = TablesUpdate<'sorting_tasks'>;

export type SortingChuteRow = Tables<'sorting_chutes'>;
export type SortingChuteInsert = TablesInsert<'sorting_chutes'>;
export type SortingChuteUpdate = TablesUpdate<'sorting_chutes'>;

export interface SortingTaskWithChute {
  task: SortingTaskRow;
  chute: SortingChuteRow | null;
}

export interface ISortingTaskRepository extends IRepository<SortingTaskRow, SortingTaskInsert, SortingTaskUpdate> {
  /**
   * 按租户查找分拣任务（分页、状态过滤）
   */
  findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; assignedUserId?: string; waveId?: string }
  ): Promise<SortingTaskRow[]>;

  /**
   * 查找分拣任务及其关联滑道
   */
  findWithChute(taskId: string): Promise<SortingTaskWithChute | null>;

  /**
   * 查找待分拣任务
   */
  findPendingSorting(tenantId: string): Promise<SortingTaskRow[]>;

  /**
   * 查找指定滑道的任务
   */
  findByChute(chuteId: string): Promise<SortingTaskRow[]>;

  /**
   * 查找待发货任务
   */
  findPendingDispatch(tenantId: string): Promise<SortingTaskRow[]>;

  /**
   * 更新任务状态
   */
  updateStatus(taskId: string, status: string, extra?: { startedAt?: string; completedAt?: string; exceptionReason?: string }): Promise<SortingTaskRow>;

  /**
   * 分配滑道
   */
  assignChute(taskId: string, chuteId: string): Promise<SortingTaskRow>;

  /**
   * 记录分拣完成
   */
  recordSortingComplete(taskId: string, sortedQty: number): Promise<SortingTaskRow>;

  /**
   * 记录异常
   */
  recordException(taskId: string, reason: string): Promise<SortingTaskRow>;

  /**
   * 获取分拣效率统计
   */
  getEfficiencyStats(tenantId: string, startDate: string, endDate: string): Promise<{
    completedTasks: number;
    totalQty: number;
    avgDurationMinutes: number;
    exceptionRate: number;
  }>;

  /**
   * 获取分拣员绩效统计
   */
  getSorterPerformance(tenantId: string, startDate: string, endDate: string): Promise<Array<{
    sorterId: string;
    sorterName: string;
    taskCount: number;
    qty: number;
    avgDurationMinutes: number;
    exceptionCount: number;
  }>>;

  /**
   * 滑道管理：创建滑道
   */
  createChute(data: SortingChuteInsert): Promise<SortingChuteRow>;

  /**
   * 滑道管理：更新滑道
   */
  updateChute(chuteId: string, data: SortingChuteUpdate): Promise<SortingChuteRow>;

  /**
   * 滑道管理：查找滑道
   */
  findChuteById(chuteId: string): Promise<SortingChuteRow | null>;

  /**
   * 滑道管理：按波次查找滑道
   */
  findChutesByWave(waveId: string): Promise<SortingChuteRow[]>;

  /**
   * 滑道管理：按目标查找滑道
   */
  findChutesByTarget(targetId: string, targetType: string): Promise<SortingChuteRow[]>;

  /**
   * 滑道管理：更新滑道状态/数量
   */
  updateChuteStatus(chuteId: string, status: string, currentQty?: number): Promise<SortingChuteRow>;

  /**
   * 获取滑道利用率统计
   */
  getChuteUtilization(tenantId: string, waveId?: string): Promise<Array<{
    chuteId: string;
    chuteCode: string;
    capacity: number;
    currentQty: number;
    utilizationPct: number;
    targetId: string | null;
    targetType: string;
  }>>;
}