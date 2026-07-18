/**
 * Supabase 同步事件仓储实现
 * 封装：sync_events 写入 + fn_apply_sync_event / fn_apply_pick_action / fn_apply_putaway_action / fn_apply_count_action / fn_apply_pack_action
 * 对应表：sync_events
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { ISyncEventRepository, SyncEventRow, SyncEventInsert, SyncEventUpdate, SyncEventStatus } from '@core/ports/db/ISyncEventRepository';
import { WmsSupabaseClient } from '../SupabaseClient';
import { SupabaseRpcClient } from '../rpc/SupabaseRpcClient';
import type { Database } from '../../../types/database';

type RpcFunctionName = keyof Database['public']['Functions'];

export class SupabaseSyncEventRepository extends SupabaseBaseRepository<
  SyncEventRow,
  SyncEventInsert,
  SyncEventUpdate,
  string
> implements ISyncEventRepository {
  protected tableName = 'sync_events';
  protected idColumn = 'id';

  constructor(
    protected supabase: WmsSupabaseClient,
    private rpcClient: SupabaseRpcClient
  ) {
    super(supabase);
  }

  /**
   * 批量插入同步事件（幂等：id + device_seq 唯一键防重）
   * 用于 PDA 离线动作批量上传
   */
  async insertBatch(events: SyncEventInsert[]): Promise<{ inserted: number; duplicates: number }> {
    let inserted = 0;
    let duplicates = 0;

    for (const event of events) {
      try {
        const { error } = await this.getClient()
          .from(this.tableName)
          .insert(event as any);

        if (error) {
          if (error.code === '23505') { // unique_violation
            duplicates++;
          } else {
            throw error;
          }
        } else {
          inserted++;
        }
      } catch (e) {
        if (e instanceof Error && 'code' in e && (e as any).code === '23505') {
          duplicates++;
        } else {
          throw e;
        }
      }
    }

    return { inserted, duplicates };
  }

  /**
   * 处理单个同步事件（调用对应的 apply RPC）
   * 根据 action_type 路由到 fn_apply_sync_event / fn_apply_pick_action 等
   */
  async applyEvent(eventId: string): Promise<{
    success: boolean;
    result?: unknown;
    error?: string;
    exceptionId?: string;
  }> {
    // 先获取事件详情
    const { data: event, error: findError } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('id', eventId)
      .single();

    if (findError || !event) {
      return { success: false, error: 'Event not found' };
    }

    try {
      // 统一走 fn_apply_sync_event 分发入口，不直接调用 fn_apply_pick_action 等专用函数。
      // 003 迁移的设计明确把 WMS01（合规）/ OTHERS（未预期错误）异常处理收敛到这一层
      // （"异常处理只在这一处，PICK/PUTAWAY/COUNT/PACK 不再各自处理"）——各专用函数自身
      // 已不再包含这层异常捕获。若在这里绕过 fn_apply_sync_event 直接调用专用函数，合规
      // 违规等场景会变成未捕获的原始 Postgres 错误，永远不会在 exceptions 表登记。
      // fn_apply_sync_event 自身在内部完成 sync_events.status 的最终落定
      // （APPLIED/EXCEPTION/REJECTED），无需在此再补一次 UPDATE。
      const result = await this.rpcClient.raw('fn_apply_sync_event' as RpcFunctionName, {
        p_event_id: eventId,
      });

      // fn_apply_sync_event 对 WMS01/OTHERS 异常是"捕获后返回一个字符串"（比如
      // 'COMPLIANCE_EXCEPTION'/'SYSTEM_EXCEPTION'/'REJECTED_UNKNOWN_ACTION'），不是抛出
      // ——RPC 调用本身不会 throw。如果这里只要"调用没抛错"就返回 success:true，会把
      // 合规违规等真实业务失败错误地报告成功。用事件最终的真实 status 判断，而不是猜
      // 返回字符串的含义（也天然兼容 SKIPPED_NOT_PENDING：如果之前已经 APPLIED 过，
      // 重新查到的 status 仍是 APPLIED，视为成功；如果之前已经是 EXCEPTION/REJECTED，
      // 同样如实反映）。
      const { data: finalEvent, error: refetchError } = await this.getClient()
        .from(this.tableName)
        .select('status')
        .eq('id', eventId)
        .single();

      if (refetchError) throw refetchError;

      return { success: finalEvent!.status === 'APPLIED', result };
    } catch (rpcError) {
      const errorMessage = rpcError instanceof Error ? rpcError.message : 'Unknown error';

      // 只有事件仍处于 PENDING（RPC 确实没跑完）才标记为 EXCEPTION；如果状态已经不是
      // PENDING（比如服务端其实已经提交，只是客户端这边超时/连接中断导致这里进了
      // catch），说明 sync_events 的真实状态已经由 SQL 函数自己落定，不应该被这里覆盖
      // 成 EXCEPTION（sync_events 表没有 error_message 列，错误信息只通过返回值传给
      // 调用方，不做持久化）。
      const { data: current } = await this.getClient()
        .from(this.tableName)
        .select('status')
        .eq('id', eventId)
        .single();

      if (current?.status === 'PENDING') {
        const { error: updateError } = await this.getClient()
          .from(this.tableName)
          .update({
            status: 'EXCEPTION',
            applied_at: new Date().toISOString(),
          } as SyncEventUpdate)
          .eq('id', eventId);
        if (updateError) {
          console.error(`applyEvent: failed to mark event ${eventId} as EXCEPTION after RPC error`, updateError);
        }
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * 批量处理待处理事件（状态 = PENDING）
   * 返回处理结果汇总
   */
  async processPendingEvents(tenantId: string, limit?: number): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
    exceptions: Array<{ eventId: string; exceptionId: string }>;
  }> {
    const { data: events, error } = await this.getClient()
      .from(this.tableName)
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('status', 'PENDING')
      .order('device_seq', { ascending: true })
      .limit(limit || 100);

    if (error) throw error;

    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    const exceptions: Array<{ eventId: string; exceptionId: string }> = [];

    for (const event of events || []) {
      processed++;
      const result = await this.applyEvent(event.id);

      if (result.success) {
        succeeded++;
      } else {
        failed++;
        if (result.exceptionId) {
          exceptions.push({ eventId: event.id, exceptionId: result.exceptionId });
        }
      }
    }

    return { processed, succeeded, failed, exceptions };
  }

  /**
   * 查找已处理事件（APPLIED 状态），按 device_seq 递增（用于 /sync/pull 增量拉取）
   */
  async findAppliedSince(tenantId: string, sinceSeq: number, limit?: number): Promise<SyncEventRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .gt('device_seq', sinceSeq)
      .eq('status', 'APPLIED')
      .order('device_seq', { ascending: true })
      .limit(limit || 100);

    if (error) throw error;
    return (data as SyncEventRow[]) || [];
  }

  /**
   * 查找待处理事件
   */
  async findPending(tenantId: string, limit?: number): Promise<SyncEventRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'PENDING')
      .order('device_seq', { ascending: true })
      .limit(limit || 100);

    if (error) throw error;
    return (data as SyncEventRow[]) || [];
  }

  /**
   * 查找异常状态事件（需人工介入）
   */
  async findExceptions(tenantId: string, limit?: number): Promise<SyncEventRow[]> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'EXCEPTION')
      .order('device_seq', { ascending: true })
      .limit(limit || 100);

    if (error) throw error;
    return (data as SyncEventRow[]) || [];
  }

  /**
   * 根据幂等键查找（去重检查）
   */
  async findByIdempotencyKey(id: string, deviceSeq: number, tenantId: string): Promise<SyncEventRow | null> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .eq('device_seq', deviceSeq)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as SyncEventRow;
  }

  /**
   * 获取设备已处理的最大 device_seq（用于增量拉取游标）
   */
  async getMaxDeviceSeq(deviceId: string, tenantId: string): Promise<number> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('device_seq')
      .eq('device_id', deviceId)
      .eq('tenant_id', tenantId)
      .eq('status', 'APPLIED')
      .order('device_seq', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return 0;
      throw error;
    }
    return data?.device_seq || 0;
  }

  /**
   * 标记事件为重复/忽略
   * 注：sync_events.status 的 CHECK 约束只允许 PENDING/APPLIED/EXCEPTION/REJECTED，
   * 没有 DUPLICATE 这个值，故落库为 REJECTED（去重也是一种"不予处理"）。表也没有
   * 存储自由文本原因的列，`reason` 目前仅用于调用方语义表达，不做持久化。
   */
  async markAsDuplicate(eventId: string, reason: string): Promise<void> {
    void reason;
    const { error } = await this.getClient()
      .from(this.tableName)
      .update({ status: 'REJECTED' } as SyncEventUpdate)
      .eq('id', eventId);

    if (error) throw error;
  }

  /**
   * 重试失败事件（重置状态为 PENDING）
   */
  async retryEvent(eventId: string): Promise<void> {
    const { error } = await this.getClient()
      .from(this.tableName)
      .update({ status: 'PENDING' } as SyncEventUpdate)
      .eq('id', eventId);

    if (error) throw error;
  }

  /**
   * 统计事件状态分布
   */
  async getStatusStats(tenantId: string): Promise<Record<SyncEventStatus, number>> {
    const { data, error } = await this.getClient()
      .from(this.tableName)
      .select('status')
      .eq('tenant_id', tenantId);

    if (error) throw error;

    const stats: Record<SyncEventStatus, number> = {
      PENDING: 0,
      PROCESSING: 0,
      APPLIED: 0,
      EXCEPTION: 0,
      REJECTED: 0,
    };

    for (const row of (data as { status: SyncEventStatus }[]) || []) {
      if (stats[row.status] !== undefined) {
        stats[row.status]++;
      }
    }

    return stats;
  }
}