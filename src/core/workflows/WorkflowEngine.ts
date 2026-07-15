/**
 * 工作流引擎实现
 * 单一实现，替代 workflow-engine + src/workflows 双引擎
 */

import {
  IWorkflowEngine,
  WorkflowDefinition,
  WorkflowInstance,
  TaskDefinition,
  TaskExecution,
  TaskHandler,
  ITaskRegistry,
  IWorkflowDefinitionStore,
  IWorkflowInstanceStore,
  ITaskExecutionStore,
} from './IWorkflowEngine';

export class WorkflowEngine implements IWorkflowEngine {
  private definitions = new Map<string, WorkflowDefinition>();
  private instances = new Map<string, WorkflowInstance>();
  private executions = new Map<string, TaskExecution[]>();
  private eventHandlers = new Map<string, Set<Function>>();

  constructor(
    private taskRegistry: ITaskRegistry,
    private definitionStore: IWorkflowDefinitionStore,
    private instanceStore: IWorkflowInstanceStore,
    private executionStore: ITaskExecutionStore
  ) {}

  async register(definition: WorkflowDefinition): Promise<void> {
    this.definitions.set(definition.id, definition);
    await this.definitionStore.save(definition);
  }

  async start(definitionId: string, input: Record<string, unknown>): Promise<WorkflowInstance> {
    const definition = this.definitions.get(definitionId) || await this.definitionStore.findById(definitionId);
    if (!definition) {
      throw new Error(`Workflow definition not found: ${definitionId}`);
    }

    const instance: WorkflowInstance = {
      id: `inst-${definitionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      definitionId,
      status: 'running',
      context: { input, variables: {} },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // 找到起始任务
    const startTasks = definition.tasks.filter(t =>
      !definition.transitions.some(tr => tr.to === t.id)
    );

    if (startTasks.length === 0) {
      throw new Error('Workflow has no start task');
    }

    // 执行起始任务
    for (const task of startTasks) {
      await this.executeTask(instance, task, definition);
    }

    await this.instanceStore.save(instance);
    this.instances.set(instance.id, instance);
    this.emitEvent('started', instance);

    return instance;
  }

  async getInstance(instanceId: string): Promise<WorkflowInstance | null> {
    const cached = this.instances.get(instanceId);
    if (cached) return cached;

    const instance = await this.instanceStore.findById(instanceId);
    if (instance) {
      this.instances.set(instanceId, instance);
    }
    return instance;
  }

  async pause(instanceId: string): Promise<void> {
    const instance = await this.getInstance(instanceId);
    if (!instance) throw new Error(`Instance not found: ${instanceId}`);

    instance.status = 'paused';
    instance.updatedAt = new Date();
    await this.instanceStore.update(instance);
    this.instances.set(instanceId, instance);
  }

  async resume(instanceId: string): Promise<void> {
    const instance = await this.getInstance(instanceId);
    if (!instance) throw new Error(`Instance not found: ${instanceId}`);

    if (instance.status !== 'running' && instance.status !== 'paused') {
      throw new Error(`Cannot resume instance in status: ${instance.status}`);
    }

    const definition = this.definitions.get(instance.definitionId) ||
      await this.definitionStore.findById(instance.definitionId);
    if (!definition) throw new Error(`Definition not found: ${instance.definitionId}`);

    instance.status = 'running';
    instance.updatedAt = new Date();

    // 找到下一个待执行任务
    const nextTasks = this.findNextTasks(instance, definition);
    for (const task of nextTasks) {
      await this.executeTask(instance, task, definition);
    }

    await this.instanceStore.update(instance);
    this.instances.set(instanceId, instance);
  }

  async cancel(instanceId: string): Promise<void> {
    const instance = await this.getInstance(instanceId);
    if (!instance) throw new Error(`Instance not found: ${instanceId}`);

    instance.status = 'cancelled';
    instance.updatedAt = new Date();
    instance.completedAt = new Date();
    await this.instanceStore.update(instance);
    this.instances.set(instanceId, instance);
  }

  async completeHumanTask(instanceId: string, taskId: string, output: Record<string, unknown>): Promise<void> {
    const instance = await this.getInstance(instanceId);
    if (!instance) throw new Error(`Instance not found: ${instanceId}`);

    const execution = this.executions.get(instanceId)?.find(e => e.taskId === taskId);
    if (!execution) throw new Error(`Task execution not found: ${taskId}`);

    execution.status = 'completed';
    execution.output = output;
    execution.completedAt = new Date();
    await this.executionStore.update(execution);

    // 继续执行后续任务
    const definition = this.definitions.get(instance.definitionId) ||
      await this.definitionStore.findById(instance.definitionId);
    if (!definition) throw new Error(`Definition not found: ${instance.definitionId}`);

    const nextTasks = this.findNextTasks(instance, definition);
    for (const task of nextTasks) {
      await this.executeTask(instance, task, definition);
    }
  }

  async retryTask(instanceId: string, taskId: string): Promise<void> {
    const instance = await this.getInstance(instanceId);
    if (!instance) throw new Error(`Instance not found: ${instanceId}`);

    const definition = this.definitions.get(instance.definitionId) ||
      await this.definitionStore.findById(instance.definitionId);
    if (!definition) throw new Error(`Definition not found: ${instance.definitionId}`);

    const task = definition.tasks.find(t => t.id === taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const executions = this.executions.get(instanceId) || [];
    const execution = executions.find(e => e.taskId === taskId);
    if (!execution) throw new Error(`Execution not found: ${taskId}`);

    execution.status = 'running';
    execution.retryCount++;
    execution.startedAt = new Date();
    await this.executionStore.update(execution);

    await this.executeTask(instance, task, definition);
  }

  onEvent(event: string, handler: (instance: WorkflowInstance, task?: TaskExecution) => void): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);

    return () => {
      this.eventHandlers.get(event)?.delete(handler);
    };
  }

  private findNextTasks(instance: WorkflowInstance, definition: WorkflowDefinition): TaskDefinition[] {
    if (!instance.currentTaskId) {
      return definition.tasks.filter(t =>
        !definition.transitions.some(tr => tr.to === t.id)
      );
    }

    const transitions = definition.transitions.filter(tr => tr.from === instance.currentTaskId);
    const nextTaskIds = transitions
      .filter(tr => !tr.condition || this.evaluateCondition(tr.condition, instance.context))
      .map(tr => tr.to);

    return definition.tasks.filter(t => nextTaskIds.includes(t.id));
  }

  private evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
    // 简单的条件求值，实际可使用表达式引擎
    try {
      return Function('context', `with(context) { return ${condition}; }`)(context);
    } catch {
      return false;
    }
  }

  private async executeTask(instance: WorkflowInstance, task: TaskDefinition, definition: WorkflowDefinition): Promise<void> {
    const handler = this.taskRegistry.get(task.handler);
    if (!handler) {
      throw new Error(`Task handler not found: ${task.handler}`);
    }

    instance.currentTaskId = task.id;
    instance.updatedAt = new Date();

    const execution: TaskExecution = {
      id: `exec-${task.id}-${Date.now()}`,
      instanceId: instance.id,
      taskId: task.id,
      status: 'running',
      input: instance.context,
      retryCount: 0,
      startedAt: new Date(),
    };

    if (!this.executions.has(instance.id)) {
      this.executions.set(instance.id, []);
    }
    this.executions.get(instance.id)!.push(execution);
    await this.executionStore.save(execution);

    try {
      const output = await handler.execute(instance.context) as Record<string, unknown>;
      execution.output = output;
      execution.status = 'completed';
      execution.completedAt = new Date();

      // 合并输出到上下文
      instance.context = { ...instance.context, ...output };

      await this.executionStore.update(execution);
      this.emitEvent('taskCompleted', instance, execution);

      // 执行下一个任务
      const nextTasks = this.findNextTasks(instance, definition);
      for (const nextTask of nextTasks) {
        await this.executeTask(instance, nextTask, definition);
      }

      // 如果没有后续任务，工作流完成
      if (nextTasks.length === 0) {
        instance.status = 'completed';
        instance.completedAt = new Date();
        await this.instanceStore.update(instance);
        this.emitEvent('completed', instance);
      }
    } catch (error) {
      execution.error = error instanceof Error ? error.message : String(error);
      execution.status = 'failed';
      execution.completedAt = new Date();
      await this.executionStore.update(execution);

      instance.status = 'failed';
      instance.error = execution.error;
      instance.completedAt = new Date();
      await this.instanceStore.update(instance);

      this.emitEvent('taskFailed', instance, execution);
      this.emitEvent('failed', instance);
      throw error;
    }
  }

  private emitEvent(event: string, instance: WorkflowInstance, task?: TaskExecution): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(instance, task);
        } catch (error) {
          console.error(`Event handler error for ${event}:`, error);
        }
      }
    }
  }
}

/** 内存存储实现（开发/测试用） */
export class InMemoryDefinitionStore implements IWorkflowDefinitionStore {
  private store = new Map<string, WorkflowDefinition>();

  async save(definition: WorkflowDefinition): Promise<void> {
    this.store.set(definition.id, definition);
  }

  async findById(id: string): Promise<WorkflowDefinition | null> {
    return this.store.get(id) || null;
  }

  async findAll(): Promise<WorkflowDefinition[]> {
    return Array.from(this.store.values());
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

export class InMemoryInstanceStore implements IWorkflowInstanceStore {
  private store = new Map<string, WorkflowInstance>();

  async save(instance: WorkflowInstance): Promise<void> {
    this.store.set(instance.id, instance);
  }

  async findById(id: string): Promise<WorkflowInstance | null> {
    return this.store.get(id) || null;
  }

  async findByDefinition(definitionId: string): Promise<WorkflowInstance[]> {
    return Array.from(this.store.values()).filter(i => i.definitionId === definitionId);
  }

  async findByStatus(status: WorkflowInstance['status']): Promise<WorkflowInstance[]> {
    return Array.from(this.store.values()).filter(i => i.status === status);
  }

  async update(instance: WorkflowInstance): Promise<void> {
    instance.updatedAt = new Date();
    this.store.set(instance.id, instance);
  }
}

export class InMemoryExecutionStore implements ITaskExecutionStore {
  private store = new Map<string, TaskExecution>();

  async save(execution: TaskExecution): Promise<void> {
    this.store.set(execution.id, execution);
  }

  async findByInstance(instanceId: string): Promise<TaskExecution[]> {
    return Array.from(this.store.values()).filter(e => e.instanceId === instanceId);
  }

  async findById(id: string): Promise<TaskExecution | null> {
    return this.store.get(id) || null;
  }

  async update(execution: TaskExecution): Promise<void> {
    this.store.set(execution.id, execution);
  }
}

/** 任务注册表实现 */
export class TaskRegistry implements ITaskRegistry {
  private handlers = new Map<string, TaskHandler<any, any>>();

  register<TIn, TOut>(handlerName: string, handler: TaskHandler<TIn, TOut>): void {
    this.handlers.set(handlerName, handler);
  }

  get<TIn, TOut>(handlerName: string): TaskHandler<TIn, TOut> | undefined {
    return this.handlers.get(handlerName);
  }

  async execute<TIn, TOut>(handlerName: string, input: TIn): Promise<TOut> {
    const handler = this.get(handlerName);
    if (!handler) throw new Error(`Handler not found: ${handlerName}`);
    return handler.execute(input) as Promise<TOut>;
  }
}