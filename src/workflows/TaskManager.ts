// TaskManager.ts - Thin wrapper around workflow-engine's TaskManager
// Re-exports workflow-engine's TaskManager and RetryableTask for backward compatibility

export {
  TaskManager,
  RetryableTask,
} from 'wms-workflow-engine';

// Legacy exports for backward compatibility
export type { WorkflowContext } from './types';