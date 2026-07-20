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
   *
   * "SELECT expires_at → 应用层算新值 → UPDATE" 是读改写竞态：两个并发续租请求都可能
   * 读到同一个旧 expires_at、各自基于它算出"旧值+increment"再写回，后写的那次会覆盖
   * 先写的那次，实际只生效了一次续租而不是两次。同时到期清扫（`fn_expire_task_claims`）
   * 可能与续租并发——如果没有状态守卫，一个已经被清扫标记为 EXPIRED 的租约可能被这里
   * 的 UPDATE 无条件覆盖出一个未来的 expires_at，制造"status=EXPIRED 但 expires_at 在
   * 未来"的不一致状态。
   *
   * 改为乐观并发重试：UPDATE 同时带上 `status = 'ACTIVE'` 与 `expires_at = <刚读到的旧
   * 值>` 两个条件作为原子的"抢占校验"——命中行数为 0 说明这段时间内已被别的请求（另一次
   * extendLease 或到期清扫）抢先修改，重新读取最新状态后重试，而不是无条件覆盖。
   */
  async extendLease(claimId: string, additionalSeconds: number): Promise<TaskClaimRow | null> {
    const MAX_ATTEMPTS = 20;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { data: current, error: readError } = await this.getClient()
        .from(this.tableName)
        .select('expires_at, status')
        .eq('id', claimId)
        .maybeSingle();

      if (readError) throw readError;
      // 不存在，或已不是 ACTIVE（已释放/已过期）：续租没有意义，如实返回 null，
      // 不应该把一个已终结的租约悄悄复活。
      if (!current || current.status !== 'ACTIVE') return null;

      const newExpiresAt = new Date(new Date(current.expires_at).getTime() + additionalSeconds * 1000).toISOString();

      const { data: updated, error: updateError } = await this.getClient()
        .from(this.tableName)
        .update({ expires_at: newExpiresAt } as TaskClaimUpdate)
        .eq('id', claimId)
        .eq('status', 'ACTIVE')
        .eq('expires_at', current.expires_at)
        .select()
        .maybeSingle();

      if (updateError) throw updateError;
      if (updated) return updated as TaskClaimRow;

      // 命中行数为 0：被并发请求抢先修改了同一行，随机退避后重新读取最新状态重试，
      // 避免多个失败者同步在同一轮再次撞车。
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 10 * (attempt + 1)));
    }

    return null;
  }
}