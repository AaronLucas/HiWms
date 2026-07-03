// TaskManager.ts
// Unified task management system for workflow execution

import { WorkflowContext } from './types';

/**
 * RetryableTask - A wrapper class that adds retry logic with exponential backoff
 * to any async function.
 */
export class RetryableTask {
  private maxAttempts: number;
  private delayMs: number;

  constructor(maxAttempts: number = 3, delayMs: number = 1000) {
    this.maxAttempts = maxAttempts;
    this.delayMs = delayMs;
  }

  async execute<T>(taskFn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        return await taskFn();
      } catch (error: any) {
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

export class TaskManager {
  private taskRegistry: Map<string, () => Promise<string>> = new Map();

  /**
   * Register a new task with retry configuration support
   */
  registerTask(taskId: string, executeFn: () => Promise<string>, metadata?: {
    retry?: {
      maxAttempts?: number;
      baseDelayMs?: number;
      maxCircuitOpenMs?: number;
    }
  }): void {
    // Store the task function (metadata would be stored separately in production)
    this.taskRegistry.set(taskId, executeFn);
  }

  /**
   * Execute a task with retry logic
   */
  async executeTask(taskId: string, context: any): Promise<string> {
    const task = this.taskRegistry.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const maxAttempts = 3; // Default retry attempts
    const baseDelayMs = 1000; // Default base delay in ms

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await task();
        return result;
      } catch (error: any) {
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