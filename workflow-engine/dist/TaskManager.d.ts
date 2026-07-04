/**
 * RetryableTask - A wrapper class that adds retry logic with exponential backoff
 * to any async function.
 */
export declare class RetryableTask {
    private maxAttempts;
    private delayMs;
    constructor(maxAttempts?: number, delayMs?: number);
    execute<T>(taskFn: () => Promise<T>): Promise<T>;
}
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
    executeTask(taskId: string, context: any): Promise<string>;
}
//# sourceMappingURL=TaskManager.d.ts.map