/**
 * 历史日志清理 RPC 端口接口
 * 对应数据库函数: fn_purge_old_action_logs
 */
export interface IPurgeOldLogsRpc {
  /**
   * 清理历史日志：wo_action_logs + inventory_history（挂 pg_cron 每天 3 点）
   * @param params 清理参数
   * @returns 清理结果
   */
  purge(params: {
    /** 保留天数（默认 180） */
    p_days?: number;
  }): Promise<Array<{
    /** 清理的库存历史数量 */
    purged_inventory_history: number;
    /** 清理的工单日志数量 */
    purged_wo_logs: number;
  }>>;
}