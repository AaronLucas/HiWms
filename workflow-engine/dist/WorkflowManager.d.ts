import { WorkflowSpec, WorkflowContext, WorkflowStatus } from './types';
/**
 * Fixed: Properly extract and use retry configuration from the actual task definition
 * instead of trying to access it from the taskArgs array
 */
export declare class WorkflowManager {
    private workflows;
    private contexts;
    registerWorkflow(spec: WorkflowSpec): void;
    getWorkflow(id: string): WorkflowSpec | undefined;
    getTaskDependencies(taskId: string, workflowId: string): string[];
    getReadyTasks(workflowId: string, completedTasks: Set<string>): string[];
    executeTask(taskId: string, context: WorkflowContext, ...args: any[]): Promise<any>;
    executeWorkflow(workflowId: string, initialData?: any): Promise<string>;
    getStatus(workflowId: string): WorkflowStatus;
    getContext(workflowId: string): WorkflowContext | undefined;
}
//# sourceMappingURL=WorkflowManager.d.ts.map