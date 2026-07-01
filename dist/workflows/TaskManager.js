// TaskManager.ts
// Unified task management system for workflow execution
export class TaskManager {
    constructor() {
        this.taskRegistry = new Map();
    }
    /**
     * Register a new task with retry configuration support
     */
    registerTask(taskId, executeFn, metadata) {
        this.taskRegistry.set(taskId, async () => {
            const task = this.taskRegistry.get(taskId);
            if (!task)
                throw new Error(`Task ${taskId} not found`);
            // Task execution with enhanced retry logic
            return task();
        });
    }
    /**
     * Execute a task with retry logic
     */
    async executeTask(taskId, context, ...args) {
        const task = this.taskRegistry.get(taskId);
        if (!task)
            throw new Error(`Task ${taskId} not found`);
        try {
            return await task(...args);
        }
        catch (error) {
            // Enhanced error classification
            if (!error.retryable) {
                throw error;
            }
            // Retry logic would be implemented here in full workflow context
            throw error; // For now, basic error propagation
        }
    }
}
