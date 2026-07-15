/**
 * 工作流引擎统一导出
 */
export { WorkflowEngine } from './WorkflowEngine';
export { IWorkflowEngine } from './IWorkflowEngine';
export type {
  WorkflowDefinition,
  TaskDefinition,
  TransitionDefinition,
  WorkflowInstance,
  TaskExecution,
  ITaskRegistry,
  TaskHandler,
  IWorkflowDefinitionStore,
  IWorkflowInstanceStore,
  ITaskExecutionStore,
} from './IWorkflowEngine';

// 内存存储实现（开发/测试用）
export { InMemoryDefinitionStore } from './WorkflowEngine';
export { InMemoryInstanceStore } from './WorkflowEngine';
export { InMemoryExecutionStore } from './WorkflowEngine';
export { TaskRegistry } from './WorkflowEngine';