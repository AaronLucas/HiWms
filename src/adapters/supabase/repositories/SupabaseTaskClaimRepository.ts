/**
 * Supabase 任务租约仓储实现
 * 封装：fn_claim_task / fn_release_task_claim / fn_expire_task_claims
 * 对应表：task_claims
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { ITaskClaimRepository } from '@core/ports/db/ITaskClaimRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';
import { SupabaseRpcClient } from '../rpc/SupabaseRpcClient';
import { WmsSupabaseClient } from '../SupabaseClient';

type TaskClaimRow = Tables<'task_claims'>;
type TaskClaimInsert = TablesInsert<'task_claims'>;
type TaskClaimUpdate = TablesUpdate<'task_claims'>;

export class SupabaseTaskClaimRepository extends SupabaseBaseRepository<
  TaskClaimRow,
  TaskClaimInsert,
  TaskClaimUpdate,
  string
> implements ITaskClaimRepository {
  protected tableName = 'task_claims';
  protected idColumn = 'id';

  constructor(
    protected supabase: WmsSupabaseClient,
    private rpcClient: SupabaseRpcClient
  ) {
    super(supabase);
  }

  /**
   * 竞争性领用任务租约
   * 调用 RPC fn_claim_task(p_work_order_id, p_user_id, p_device_id, p_lease_seconds)
   */
  async claimTask(params: {
    workOrderId: string;
    userId: string;
    deviceId: string;
    leaseSeconds: number;
  }): Promise<{ claimId: string; success: boolean; message?: string; expiresAt: string } | null> {
    const result = await this.rpcClient.raw('fn_claim_task', {
      p_work_order_id: params.workOrderId,
      p_user_id: params.userId,
      p_device_id: params.deviceId,
      p_lease_seconds: params.leaseSeconds,
    });

    // RPC 返回数组，取第一个结果
    const claimResult = Array.isArray(result) && result.length > 0 ? result[0] : null;

    if (!claimResult || !claimResult.success) {
      return claimResult ? {
        claimId: '',
        success: false,
        message: claimResult.message || 'Task already claimed or not available',
        expiresAt: new Date().toISOString(),
      } : null;
    }

    return {
      claimId: claimResult.claim_id,
      success: true,
      expiresAt: new Date(Date.now() + params.leaseSeconds * 1000).toISOString(),
    };
  }

  /**
   * 释放任务租约
   * 调用 RPC fn_release_task_claim(p_claim_id)
   */
  async releaseTaskClaim(claimId: string): Promise<boolean> {
    const result = await this.rpcClient.raw('fn_release_task_claim', {
      p_claim_id: claimId,
    });
    // RPC 返回 boolean
    return result === true || (Array.isArray(result) && result[0] === true);
  }

  /**
   * 清扫过期租约（配合 pg_cron 定时调用）
   * 调用 RPC fn_expire_task_claims() -> 返回过期数量
   */
  async expireTaskClaims(): Promise<number> {
    const result = await this.rpcClient.raw('fn_expire_task_claims' as any, {});
    return Number(result) || 0;
  }

  /**
   * 查找用户当前持有的活跃租约
   */
  async findActiveByUser(userId: string, tenantId: string): Promise<TaskClaimRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('claimed_by_user_id', userId)
      .eq('tenant_id', tenantId)
      .eq('status', 'ACTIVE')
      .gt('expires_at', new Date().toISOString())
      .order('claimed_at', { ascending: false });

    if (error) throw error;
    return (data as TaskClaimRow[]) || [];
  }

  /**
   * 查找设备当前持有的活跃租约
   */
  async findActiveByDevice(deviceId: string, tenantId: string): Promise<TaskClaimRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('claimed_by_device_id', deviceId)
      .eq('tenant_id', tenantId)
      .eq('status', 'ACTIVE')
      .gt('expires_at', new Date().toISOString())
      .order('claimed_at', { ascending: false });

    if (error) throw error;
    return (data as TaskClaimRow[]) || [];
  }

  /**
   * 查找工单的活跃租约
   */
  async findActiveByWorkOrder(workOrderId: string, tenantId: string): Promise<TaskClaimRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('work_order_id', workOrderId)
      .eq('tenant_id', tenantId)
      .eq('status', 'ACTIVE')
      .gt('expires_at', new Date().toISOString())
      .order('claimed_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as TaskClaimRow;
  }

  /**
   * 查找即将过期的租约（用于前置预警）
   */
  async findExpiringSoon(tenantId: string, withinSeconds: number): Promise<TaskClaimRow[]> {
    const threshold = new Date(Date.now() + withinSeconds * 1000).toISOString();
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'ACTIVE')
      .lt('expires_at', threshold)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: true });

    if (error) throw error;
    return (data as TaskClaimRow[]) || [];
  }

  /**
   * 延长租约（续租）
   */
  async extendLease(claimId: string, additionalSeconds: number): Promise<TaskClaimRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('expires_at')
      .eq('id', claimId)
      .single();

    if (error || !data) return null;

    const newExpiresAt = new Date(new Date(data.expires_at).getTime() + additionalSeconds * 1000).toISOString();

    const { data: updated, error: updateError } = await this.getClient()
      .from(this.tableName)
      .update({ expires_at: newExpiresAt } as TaskClaimUpdate)
      .eq('id', claimId)
      .select()
      .single();

    if (updateError) throw updateError;
    return updated as TaskClaimRow;
  }
}