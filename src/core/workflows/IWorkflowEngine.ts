/**
 * 工作流引擎端口接口
 * 定义工作流执行、任务调度、状态管理的核心契约
 */

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  tasks: TaskDefinition[];
  transitions: TransitionDefinition[];
}

export interface TaskDefinition {
  id: string;
  name: string;
  type: 'sync' | 'async' | 'rpc' | 'human';
  handler: string;
  inputSchema: Record<string, string>;
  timeout?: number;
  retryPolicy?: RetryPolicy;
  circuitBreaker?: CircuitBreakerConfig;
}

export interface TransitionDefinition {
  from: string;
  to: string;
  condition?: string; // 可选条件表达式
}

export interface WorkflowInstance {
  id: string;
  definitionId: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  currentTaskId?: string;
  context: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  error?: string;
}

export interface TaskExecution {
  id: string;
  instanceId: string;
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting';
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  retryCount: number;
}

export interface IWorkflowEngine {
  /** 注册工作流定义 */
  register(definition: WorkflowDefinition): Promise<void>;

  /** 启动工作流实例 */
  start(definitionId: string, input: Record<string, unknown>): Promise<WorkflowInstance>;

  /** 获取工作流实例状态 */
  getInstance(instanceId: string): Promise<WorkflowInstance | null>;

  /** 暂停工作流 */
  pause(instanceId: string): Promise<void>;

  /** 恢复工作流 */
  resume(instanceId: string): Promise<void>;

  /** 取消工作流 */
  cancel(instanceId: string): Promise<void>;

  /** 完成人工任务 */
  completeHumanTask(instanceId: string, taskId: string, output: Record<string, unknown>): Promise<void>;

  /** 重试失败任务 */
  retryTask(instanceId: string, taskId: string): Promise<void>;

  /** 订阅工作流事件 */
  onEvent(event: 'started' | 'completed' | 'failed' | 'taskCompleted' | 'taskFailed', handler: (instance: WorkflowInstance, task?: TaskExecution) => void): () => void;
}

/** 任务注册表接口 */
export interface ITaskRegistry {
  /** 注册任务处理器 */
  register<TIn, TOut>(handlerName: string, handler: TaskHandler<TIn, TOut>): void;

  /** 获取任务处理器 */
  get<TIn, TOut>(handlerName: string): TaskHandler<TIn, TOut> | undefined;

  /** 执行任务 */
  execute<TIn, TOut>(handlerName: string, input: TIn): Promise<TOut>;
}

/** 任务处理器接口 - 支持补偿事务 */
export interface TaskHandler<TIn = Record<string, unknown>, TOut = Record<string, unknown>> {
  execute(input: TIn): Promise<TOut>;
  compensate?(output: unknown, context: any): Promise<void>;
}

/** 工作流定义存储接口 */
export interface IWorkflowDefinitionStore {
  save(definition: WorkflowDefinition): Promise<void>;
  findById(id: string): Promise<WorkflowDefinition | null>;
  findAll(): Promise<WorkflowDefinition[]>;
  delete(id: string): Promise<void>;
}

/** 工作流实例存储接口 */
export interface IWorkflowInstanceStore {
  save(instance: WorkflowInstance): Promise<void>;
  findById(id: string): Promise<WorkflowInstance | null>;
  findByDefinition(definitionId: string): Promise<WorkflowInstance[]>;
  findByStatus(status: WorkflowInstance['status']): Promise<WorkflowInstance[]>;
  update(instance: WorkflowInstance): Promise<void>;
}

/** 任务执行存储接口 */
export interface ITaskExecutionStore {
  save(execution: TaskExecution): Promise<void>;
  findByInstance(instanceId: string): Promise<TaskExecution[]>;
  findById(id: string): Promise<TaskExecution | null>;
  update(execution: TaskExecution): Promise<void>;
}

/**
 * 重试策略配置
 */
export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  jitterFactor?: number;
  retryableErrors?: string[];
}

/**
 * 熔断器配置
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
  halfOpenMaxRequests: number;
}

/**
 * 熔断器状态
 */
export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';