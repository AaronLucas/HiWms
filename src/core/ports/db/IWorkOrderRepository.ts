/**
 * 工单仓储端口接口
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';

export type WorkOrderRow = Tables<'work_orders'>;
export type WorkOrderInsert = TablesInsert<'work_orders'>;
export type WorkOrderUpdate = TablesUpdate<'work_orders'>;

export type ActionLogRow = Tables<'wo_action_logs'>;
export type ActionLogInsert = TablesInsert<'wo_action_logs'>;
export type ActionLogUpdate = TablesUpdate<'wo_action_logs'>;

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
   * 按父工单查找子工单
   */
  findByParent(parentWoId: string): Promise<WorkOrderRow[]>;

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
  logAction(log: ActionLogInsert): Promise<ActionLogRow>;

  /**
   * 更新工单动作日志
   */
  updateActionLog(logId: number, data: ActionLogUpdate): Promise<ActionLogRow>;

  /**
   * 按工单获取动作日志
   */
  getActionLogsByWorkOrder(woId: string): Promise<ActionLogRow[]>;

  /**
   * 按操作员获取动作日志
   */
  getActionLogsByOperator(operatorId: string, dateFrom: Date, dateTo: Date): Promise<ActionLogRow[]>;

  /**
   * 获取异常动作日志
   */
  getExceptionLogs(tenantId: string, dateFrom: Date, dateTo: Date): Promise<ActionLogRow[]>;
}