/**
 * Supabase 同步事件仓储实现
 * 封装：sync_events 写入 + fn_apply_sync_event / fn_apply_pick_action / fn_apply_putaway_action / fn_apply_count_action / fn_apply_pack_action
 * 对应表：sync_events
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { ISyncEventRepository, SyncEventRow, SyncEventInsert, SyncEventUpdate, SyncEventStatus, SyncActionType } from '@core/ports/db/ISyncEventRepository';
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
      // 根据 action_type 调用对应的 RPC
      let rpcName = 'fn_apply_sync_event';
      const actionType = event.action_type as SyncActionType;

      switch (actionType) {
        case 'PICK':
          rpcName = 'fn_apply_pick_action';
          break;
        case 'PUTAWAY':
          rpcName = 'fn_apply_putaway_action';
          break;
        case 'COUNT':
          rpcName = 'fn_apply_count_action';
          break;
        case 'PACK':
          rpcName = 'fn_apply_pack_action';
          break;
        default:
          rpcName = 'fn_apply_sync_event';
      }

      const result = await this.rpcClient.raw(rpcName as RpcFunctionName, {
        p_event_id: eventId,
      });

      // 更新事件状态为 APPLIED
      await this.getClient()
        .from(this.tableName)
        .update({
          status: 'APPLIED',
          applied_at: new Date().toISOString(),
          result_data: result as any,
        } as SyncEventUpdate)
        .eq('id', eventId);

      return { success: true, result };
    } catch (rpcError) {
      const errorMessage = rpcError instanceof Error ? rpcError.message : 'Unknown error';

      // 更新事件状态为 EXCEPTION
      await this.getClient()
        .from(this.tableName)
        .update({
          status: 'EXCEPTION',
          error_message: errorMessage,
        } as SyncEventUpdate)
        .eq('id', eventId);

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
   */
  async markAsDuplicate(eventId: string, reason: string): Promise<void> {
    const { error } = await this.getClient()
      .from(this.tableName)
      .update({ status: 'DUPLICATE', error_message: reason } as SyncEventUpdate)
      .eq('id', eventId);

    if (error) throw error;
  }

  /**
   * 重试失败事件（重置状态为 PENDING）
   */
  async retryEvent(eventId: string): Promise<void> {
    const { error } = await this.getClient()
      .from(this.tableName)
      .update({ status: 'PENDING', error_message: null } as SyncEventUpdate)
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
      APPLIED: 0,
      EXCEPTION: 0,
      DUPLICATE: 0,
      IGNORED: 0,
    };

    for (const row of (data as { status: SyncEventStatus }[]) || []) {
      if (stats[row.status] !== undefined) {
        stats[row.status]++;
      }
    }

    return stats;
  }
}