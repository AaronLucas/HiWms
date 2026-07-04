/**
 * Type definitions for the workflow system.
 * Defines the core structures used throughout the workflow engine.
 */
export interface WorkflowTask {
    id: string;
    name: string;
    description: string;
    execute: (...args: any[]) => Promise<string>;
    next?: string[];
    requires?: string[];
    result?: string;
    retry?: {
        maxAttempts?: number;
        baseDelayMs?: number;
        maxCircuitOpenMs?: number;
        retryable?: boolean;
        args?: any[];
    };
}
export interface WorkflowSpec {
    id: string;
    name: string;
    description: string;
    tasks: Record<string, WorkflowTask>;
    dependencies: Record<string, string[]>;
    initialTasks: string[];
    entryPoints: string[];
}
export interface WorkflowContext {
    tasks: Record<string, WorkflowTask>;
    results: Record<string, any>;
    status: 'running' | 'completed' | 'failed';
    completedTasks: string[];
    failedTasks: string[];
    logs: string[];
    workflowId: string;
    interruptStage?: string;
}
export declare enum WorkflowStatus {
    RUNNING = "running",
    COMPLETED = "completed",
    FAILED = "failed"
}
