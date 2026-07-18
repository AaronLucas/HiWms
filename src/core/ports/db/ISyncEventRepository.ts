/**
 * 同步事件收件箱仓储端口接口
 * 封装：sync_events 写入 + fn_apply_sync_event / fn_apply_pick_action / fn_apply_putaway_action / fn_apply_count_action / fn_apply_pack_action
 * 对应表：sync_events
 */
import { IRepository } from './IRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

export type SyncEventRow = Tables<'sync_events'>;
export type SyncEventInsert = TablesInsert<'sync_events'>;
export type SyncEventUpdate = TablesUpdate<'sync_events'>;

// 与 sync_events.status 的 chk_sync_events_status CHECK 约束保持一致（已用 psql \d 核实）。
// PROCESSING 由 005_concurrency_hardening_V1.sql 引入：fn_apply_sync_event 原子抢占
// PENDING -> PROCESSING 后才继续执行业务逻辑，是"已被抢占、正在处理中"的瞬时中间态。
export type SyncEventStatus = 'PENDING' | 'PROCESSING' | 'APPLIED' | 'EXCEPTION' | 'REJECTED';
export type SyncActionType =
  | 'PICK'
  | 'PUTAWAY'
  | 'COUNT'
  | 'PACK'
  | 'RECEIVE'
  | 'SHIP'
  | 'REPLENISH'
  | 'MOVE'
  | 'ADJUST';

export interface ISyncEventRepository extends IRepository<SyncEventRow, SyncEventInsert, SyncEventUpdate> {
  /**
   * 批量插入同步事件（幂等：id + device_seq 唯一键防重）
   * 用于 PDA 离线动作批量上传
   */
  insertBatch(events: SyncEventInsert[]): Promise<{ inserted: number; duplicates: number }>;

  /**
   * 处理单个同步事件（调用对应的 apply RPC）
   * 根据 action_type 路由到 fn_apply_sync_event / fn_apply_pick_action 等
   */
  applyEvent(eventId: string): Promise<{
    success: boolean;
    result?: unknown;
    error?: string;
    exceptionId?: string;
  }>;

  /**
   * 批量处理待处理事件（状态 = PENDING）
   * 返回处理结果汇总
   */
  processPendingEvents(tenantId: string, limit?: number): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
    exceptions: Array<{ eventId: string; exceptionId: string }>;
  }>;

  /**
   * 查找已处理事件（APPLIED 状态），按 device_seq 递增（用于 /sync/pull 增量拉取）
   */
  findAppliedSince(tenantId: string, sinceSeq: number, limit?: number): Promise<SyncEventRow[]>;

  /**
   * 查找待处理事件
   */
  findPending(tenantId: string, limit?: number): Promise<SyncEventRow[]>;

  /**
   * 查找异常状态事件（需人工介入）
   */
  findExceptions(tenantId: string, limit?: number): Promise<SyncEventRow[]>;

  /**
   * 根据幂等键查找（去重检查）
   */
  findByIdempotencyKey(id: string, deviceSeq: number, tenantId: string): Promise<SyncEventRow | null>;

  /**
   * 获取设备已处理的最大 device_seq（用于增量拉取游标）
   */
  getMaxDeviceSeq(deviceId: string, tenantId: string): Promise<number>;

  /**
   * 标记事件为重复/忽略
   */
  markAsDuplicate(eventId: string, reason: string): Promise<void>;

  /**
   * 重试失败事件（重置状态为 PENDING）
   */
  retryEvent(eventId: string): Promise<void>;

  /**
   * 统计事件状态分布
   */
  getStatusStats(tenantId: string): Promise<Record<SyncEventStatus, number>>;
}