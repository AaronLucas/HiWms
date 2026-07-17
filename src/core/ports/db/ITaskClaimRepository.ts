/**
 * 任务租约仓储端口接口
 * 封装竞争性任务租约：fn_claim_task / fn_release_task_claim / fn_expire_task_claims
 * 对应表：task_claims
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type TaskClaimRow = Tables<'task_claims'>;
export type TaskClaimInsert = TablesInsert<'task_claims'>;
export type TaskClaimUpdate = TablesUpdate<'task_claims'>;

export interface ITaskClaimRepository extends IRepository<TaskClaimRow, TaskClaimInsert, TaskClaimUpdate> {
  /**
   * 竞争性领用任务租约
   * 调用 RPC fn_claim_task(p_work_order_id, p_user_id, p_device_id, p_lease_seconds)
   * @returns { claim_id, success, message, expires_at } | null
   */
  claimTask(params: {
    workOrderId: string;
    userId: string;
    deviceId: string;
    leaseSeconds: number;
  }): Promise<{ claimId: string; success: boolean; message?: string; expiresAt: string } | null>;

  /**
   * 释放任务租约
   * 调用 RPC fn_release_task_claim(p_claim_id)
   */
  releaseTaskClaim(claimId: string): Promise<boolean>;

  /**
   * 清扫过期租约（配合 pg_cron 定时调用）
   * 调用 RPC fn_expire_task_claims() -> 返回过期数量
   */
  expireTaskClaims(): Promise<number>;

  /**
   * 查找用户当前持有的活跃租约
   */
  findActiveByUser(userId: string, tenantId: string): Promise<TaskClaimRow[]>;

  /**
   * 查找设备当前持有的活跃租约
   */
  findActiveByDevice(deviceId: string, tenantId: string): Promise<TaskClaimRow[]>;

  /**
   * 查找工单的活跃租约
   */
  findActiveByWorkOrder(workOrderId: string, tenantId: string): Promise<TaskClaimRow | null>;

  /**
   * 查找即将过期的租约（用于前置预警）
   */
  findExpiringSoon(tenantId: string, withinSeconds: number): Promise<TaskClaimRow[]>;

  /**
   * 延长租约（续租）
   */
  extendLease(claimId: string, additionalSeconds: number): Promise<TaskClaimRow | null>;
}