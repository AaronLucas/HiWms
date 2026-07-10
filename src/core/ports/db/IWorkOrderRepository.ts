/**
 * 工单仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

export type WorkOrderRow = Tables<'work_orders'>;
export type WorkOrderInsert = TablesInsert<'work_orders'>;
export type WorkOrderUpdate = TablesUpdate<'work_orders'>;

export interface IWorkOrderRepository extends IRepository<WorkOrderRow, WorkOrderInsert, WorkOrderUpdate> {
  /**
   * 按波次查找工单
   */
  findByWave(waveId: string): Promise<WorkOrderRow[]>;

  /**
   * 按分配用户查找工单
   */
  findByAssignee(userId: string, status?: string): Promise<WorkOrderRow[]>;

  /**
   * 按关联订单查找工单
   */
  findByOrder(orderId: string): Promise<WorkOrderRow[]>;

  /**
   * 查找待派发工单
   */
  findPendingDispatch(tenantId: string): Promise<WorkOrderRow[]>;

  /**
   * 更新工单状态
   */
  updateStatus(workOrderId: string, status: string): Promise<WorkOrderRow>;

  /**
   * 记录工单动作日志
   */
  logAction(log: TablesInsert<'wo_action_logs'>): Promise<Tables<'wo_action_logs'>>;
}