export interface WorkflowTask {
  /** 唯一标识 */
  id: string;
  /** 可读名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 后续任务列表（依赖后续执行） */
  next?: string[];
  /** 依赖的前置任务 */
  requires?: string[];
  /** 任务执行函数（必须支持任意参数） */
  execute: (...args: any[]) => Promise<string>;
  /** 是否已完成 */
  isCompleted?: boolean;
  /** 结果缓存（可选） */
  result?: string;
  /** 重试配置（可选） */
  retry?: {
    /** 最大重试次数（不包括首次执行） */
    maxAttempts?: number;
    /** 基础延迟（毫秒） */
    baseDelayMs?: number;
    /** 熔断器最大打开时长（毫秒） */
    maxCircuitOpenMs?: number;
    /** 是否可重试（标记错误） */
    retryable?: boolean;
    /** 额外的自定义参数数组（直接透传到 execute） */
    args?: any[];
  };
}

export interface WorkflowSpec {
  id: string;
  name: string;
  description: string;
  tasks: Record<string, WorkflowTask>;
  dependencies: Record<string, string[]>; // taskId -> [依赖的任务ID]
  initialTasks: string[]; // 可以立即执行的入口任务列表
  entryPoints: string[]; // 实际启动执行的任务列表（一般和 initialTasks 一致）
}

export interface WorkflowContext {
  tasks: Record<string, WorkflowTask>;
  results: Record<string, any>;
  status: WorkflowStatus;
  completedTasks: string[];
  failedTasks: string[];
  logs: string[];
  workflowId: string;
  interruptStage?: string;
}

/** 运行状态枚举 */
export enum WorkflowStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}