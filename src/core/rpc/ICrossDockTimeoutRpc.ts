/**
 * 交叉理货超时扫描 RPC 端口接口
 * 对应数据库函数: fn_cross_dock_timeout_sweep
 */
export interface ICrossDockTimeoutRpc {
  /**
   * 扫描超时的交叉理货作业并自动降级：MATCHED/STAGING → FALLBACK
   * @returns 处理数量
   */
  sweep(): Promise<number>;
}