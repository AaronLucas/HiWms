/**
 * 历史日志清理 RPC 端口接口
 * 对应数据库函数: fn_purge_old_action_logs
 *
 * 迁移 021 新增批量清理重载：
 *   - 原签名 purge({ p_days }) → { purged_inventory_history, purged_wo_logs }[]
 *   - 批量签名 purge({ p_days, p_batch_size }) → { batch_deleted_*, more_batches_available }[]
 */
export type PurgeOldLogsResultLegacy = Array<{
  /** 清理的库存历史数量 */
  purged_inventory_history: number;
  /** 清理的工单日志数量 */
  purged_wo_logs: number;
}>;

export type PurgeOldLogsResultBatched = Array<{
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

export type PurgeOldLogsParams =
  | { p_days?: number }
  | { p_days?: number; p_batch_size?: number };

/** 类型守卫：判断批量清理结果（迁移 021 新增） */
export function isBatchedResult(
  result: PurgeOldLogsResultLegacy | PurgeOldLogsResultBatched
): result is PurgeOldLogsResultBatched {
  return result.length > 0 && 'more_batches_available' in result[0];
}

export interface IPurgeOldLogsRpc {
  /**
   * 清理历史日志：wo_action_logs + inventory_history（挂 pg_cron 每天 3 点）
   *
   * 迁移 021 后支持两种模式：
   *   - 全量清理：只传 p_days，返回 PurgeOldLogsResultLegacy
   *   - 批量清理：加传 p_batch_size，返回 PurgeOldLogsResultBatched
   *
   * @param params 清理参数
   * @returns 清理结果（根据参数自动选择返回类型）
   */
  purge(params: PurgeOldLogsParams): Promise<PurgeOldLogsResultLegacy | PurgeOldLogsResultBatched>;
}