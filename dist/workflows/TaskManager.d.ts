import { WorkflowContext } from './types';
export declare class TaskManager {
    private taskRegistry;
    /**
     * Register a new task with retry configuration support
     */
    registerTask(taskId: string, executeFn: () => Promise<string>, metadata?: {
        retry?: {
            maxAttempts?: number;
            baseDelayMs?: number;
            maxCircuitOpenMs?: number;
        };
    }): void;
    /**
     * Execute a task with retry logic
     */
    executeTask(taskId: string, context: WorkflowContext, ...args: any[]): Promise<string>;
}
