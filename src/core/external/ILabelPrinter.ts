/**
 * 标签打印机端口接口
 * 面单打印抽象
 */
export interface ILabelPrinter {
  /**
   * 打印标签
   */
  print(params: {
    /** 模板 ID */
    templateId: string;
    /** 打印数据 */
    data: Record<string, unknown>;
    /** 打印份数 */
    copies?: number;
    /** 打印机标识（可选，默认使用默认打印机） */
    printerId?: string;
  }): Promise<{
    /** 打印任务 ID */
    jobId: string;
    /** 打印状态 */
    status: 'queued' | 'printing' | 'completed' | 'failed';
  }>;

  /**
   * 获取打印状态
   */
  getStatus(jobId: string): Promise<{
    status: 'queued' | 'printing' | 'completed' | 'failed';
    error?: string;
  }>;

  /**
   * 获取可用打印机列表
   */
  listPrinters(): Promise<Array<{
    id: string;
    name: string;
    status: 'online' | 'offline' | 'error';
    paperSize?: string;
  }>>;
}