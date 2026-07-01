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
    executeTask(taskId: string, context: any, ...args: any[]): Promise<string>;
}
