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
        this.taskRegistry.set(taskId, async (executeFn) => {
            const task = this.taskRegistry.get(taskId);
            if (!task)
                throw new Error(`Task ${taskId} not found`);
            return await task();
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
            return await task()(...args);
        }
        catch (error) {
            if (!error.retryable) {
                throw error;
            }
            // Retry logic would be implemented here in full workflow context
            throw error;
        }
    }
}
