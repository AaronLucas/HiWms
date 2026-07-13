/**
 * 装车任务仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type LoadingTaskRow = Tables<'loading_tasks'>;
export type LoadingTaskInsert = TablesInsert<'loading_tasks'>;
export type LoadingTaskUpdate = TablesUpdate<'loading_tasks'>;

export interface ILoadingTaskRepository extends IRepository<LoadingTaskRow, LoadingTaskInsert, LoadingTaskUpdate> {
  /**
   * 按波次查找装车任务
   */
  findByWave(waveId: string): Promise<LoadingTaskRow[]>;

  /**
   * 按分配用户查找装车任务
   */
  findByAssignee(userId: string, status?: string): Promise<LoadingTaskRow[]>;

  /**
   * 按关联订单查找装车任务
   */
  findByOrder(orderId: string): Promise<LoadingTaskRow[]>;

  /**
   * 查找待派发装车任务
   */
  findPendingDispatch(tenantId: string): Promise<LoadingTaskRow[]>;

  /**
   * 更新装车任务状态
   */
  updateStatus(loadingTaskId: string, status: string, extra?: { startedAt?: string; completedAt?: string; actualWeight?: number; actualVolume?: number; sealNumber?: string; exceptionReason?: string }): Promise<LoadingTaskRow>;
}