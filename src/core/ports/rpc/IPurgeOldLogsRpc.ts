/**
 * 历史日志清理 RPC 端口接口
 * 对应数据库函数: fn_purge_old_action_logs(INT, INT)
 *
 * 迁移 023（2026-07-26）：DROP 旧单参数 ghost function fn_purge_old_action_logs(INT)，
 * 统一为双参数批量重载。旧 legacy 类型 PurgeOldLogsResultLegacy 已移除。
 */

export type PurgeOldLogsResult = Array<{
  /** 本批次删除的库存历史数量 */
  batch_deleted_inventory_history: number;
  /** 本批次删除的工单日志数量 */
  batch_deleted_wo_logs: number;
  /** 是否还有更多批次 */
  more_batches_available: boolean;
  /** 累计删除的库存历史总数 */
  total_deleted_inventory_history: number;
  /** 累计删除的工单日志总数 */
  total_deleted_wo_logs: number;
}>;

/** 清理参数 */
export type PurgeOldLogsParams = {
  /** 保留天数（默认 180，必须 >= 1） */
  p_days?: number;
  /** 批量大小（1-100000，必填） */
  p_batch_size: number;
};

/** 有效的 p_batch_size 范围（与迁移 023 参数校验一致） */
export const PURGE_BATCH_SIZE_MIN = 1;
export const PURGE_BATCH_SIZE_MAX = 100_000;

export interface IPurgeOldLogsRpc {
  /**
   * 清理历史日志：wo_action_logs + inventory_history（挂 pg_cron 每 2 小时）
   *
   * 迁移 023 后只有双参数批量模式（p_days >= 1, p_batch_size ∈ [1, 100000]）。
   *
   * @param params 清理参数
   * @returns 批量清理结果
   */
  purge(params: PurgeOldLogsParams): Promise<PurgeOldLogsResult>;
}
