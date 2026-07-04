"use strict";
// TaskManager.ts
// Unified task management system for workflow execution
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskManager = exports.RetryableTask = void 0;
/**
 * RetryableTask - A wrapper class that adds retry logic with exponential backoff
 * to any async function.
 */
class RetryableTask {
    constructor(maxAttempts = 3, delayMs = 1000) {
        this.maxAttempts = maxAttempts;
        this.delayMs = delayMs;
    }
    async execute(taskFn) {
        for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
            try {
                return await taskFn();
            }
            catch (error) {
                // If error is not retryable or it's the last attempt, throw
                if (!error.retryable || attempt === this.maxAttempts - 1) {
                    throw error;
                }
                // Exponential backoff
                const delay = this.delayMs * Math.pow(2, attempt);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        // This should never be reached due to the throw above
        throw new Error('Task failed after all retry attempts');
    }
}
exports.RetryableTask = RetryableTask;
class TaskManager {
    constructor() {
        this.taskRegistry = new Map();
    }
    /**
     * Register a new task with retry configuration support
     */
    registerTask(taskId, executeFn, metadata) {
        // Store the task function (metadata would be stored separately in production)
        this.taskRegistry.set(taskId, executeFn);
    }
    /**
     * Execute a task with retry logic
     */
    async executeTask(taskId, context) {
        const task = this.taskRegistry.get(taskId);
        if (!task)
            throw new Error(`Task ${taskId} not found`);
        const maxAttempts = 3; // Default retry attempts
        const baseDelayMs = 1000; // Default base delay in ms
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                const result = await task();
                return result;
            }
            catch (error) {
                if (!error.retryable) {
                    throw error; // Non-retryable errors are thrown immediately
                }
                if (attempt === maxAttempts - 1) {
                    throw error; // Last attempt failed
                }
                const delay = baseDelayMs * Math.pow(2, attempt); // Exponential backoff
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw new Error(`Task ${taskId} failed after ${maxAttempts} attempts`);
    }
}
exports.TaskManager = TaskManager;
//# sourceMappingURL=TaskManager.js.map