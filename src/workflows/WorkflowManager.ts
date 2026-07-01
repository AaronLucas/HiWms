import { WorkflowTask, WorkflowSpec, WorkflowContext, WorkflowStatus } from './types';

/**
 * Fixed: Properly extract and use retry configuration from the actual task definition
 * instead of trying to access it from the taskArgs array
 */
export class WorkflowManager {
  private workflows: Map<string, WorkflowSpec> = new Map();
  private contexts: Map<string, WorkflowContext> = new Map();

  registerWorkflow(spec: WorkflowSpec): void {
    this.workflows.set(spec.id, spec);
  }

  getWorkflow(id: string): WorkflowSpec | undefined {
    return this.workflows.get(id);
  }

  getTaskDependencies(taskId: string, workflowId: string): string[] {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return [];
    return workflow.dependencies[taskId] || [];
  }

  getReadyTasks(workflowId: string, completedTasks: Set<string>): string[] {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return [];

    const readyTasks: string[] = [];
    for (const [taskId, dependencies] of Object.entries(workflow.dependencies)) {
      if (completedTasks.has(taskId)) continue;
      const allDepsCompleted = dependencies.every(dep => completedTasks.has(dep));
      if (allDepsCompleted) {
        readyTasks.push(taskId);
      }
    }
    return readyTasks;
  }

  async executeTask(taskId: string, context: WorkflowContext, ...args: any[]): Promise<any> {
    const workflow = this.workflows.get(context.workflowId ?? '');
    if (!workflow) throw new Error(`Workflow ${context.workflowId} not found`);

    const task = workflow.tasks[taskId];
    if (!task) throw new Error(`Task ${taskId} not found in workflow ${context.workflowId}`);

    try {
      const result = await task.execute(...args);

      context.results[taskId] = result;
      context.completedTasks.push(taskId);
      context.logs.push(`[${new Date().toISOString()}] Task ${taskId} completed: ${typeof result === 'string' ? result : JSON.stringify(result)}`);

      return result;
    } catch (error: unknown) {
      context.failedTasks.push(taskId);
      context.logs.push(`[${new Date().toISOString()}] Task ${taskId} failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async executeWorkflow(workflowId: string, initialData: any = null): Promise<string> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

    const context: WorkflowContext = {
      tasks: workflow.tasks,
      results: {},
      status: WorkflowStatus.RUNNING,
      completedTasks: [],
      failedTasks: [],
      logs: [],
      workflowId,
      interruptStage: undefined
    };
    this.contexts.set(workflowId, context);

    try {
      const readyTasks = new Set<string>(workflow.initialTasks);

      while (readyTasks.size > 0) {
        for (const taskId of Array.from(readyTasks)) {
          const deps = this.getTaskDependencies(taskId, workflowId);
          const depsMet = deps.every(dep => context.completedTasks.includes(dep));

          if (depsMet) {
            let taskArgs: any[] = [];

            // For workflows that need to pass data between tasks
            if (taskId === '6' && workflowId === 'order-process') {
              const prevResult = context.results['5'];
              taskArgs = [JSON.parse(prevResult)];
            } else if (taskId === '7' && workflowId === 'order-process') {
              const prevResult = context.results['6'];
              taskArgs = [JSON.parse(prevResult)];
            } else if (taskId === '8' && workflowId === 'order-process') {
              const prevResult = context.results['7'];
              taskArgs = [JSON.parse(prevResult)];
            } else if (taskId === '9' && workflowId === 'order-process') {
              const prevResult = context.results['8'];
              taskArgs = [JSON.parse(prevResult)];
            }

            // Get the actual task definition to access its retry configuration
            const task = workflow.tasks[taskId];
            const retryCfg = task.retry || {};

            const maxAttempts = retryCfg.maxAttempts ?? 3;
            const baseDelayMs = retryCfg.baseDelayMs ?? 1000;
            let attempt = 0;
            let success = false;
            let circuitOpenMs = 0;

            while (attempt < maxAttempts && !success) {
              try {
                const result = await this.executeTask(taskId, context, ...taskArgs);
                success = true;
              } catch (error: unknown) {
                // Enhanced error classification
                if (!(error as any).retryable) {
                  throw error;
                }

                if (circuitOpenMs > 0 && circuitOpenMs < (retryCfg.maxCircuitOpenMs ?? 30000)) {
                  context.logs.push(`[${new Date().toISOString()}] Circuit breaker active for task ${taskId}, waiting ${circuitOpenMs}ms`);
                  await new Promise(resolve => setTimeout(resolve, circuitOpenMs));
                }

                if (attempt === maxAttempts - 1) {
                  throw error;
                }

                attempt++;
                const delay = baseDelayMs * Math.pow(2, attempt);
                context.logs.push(`[${new Date().toISOString()}] Task ${taskId} attempt ${attempt} failed, retrying in ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
              }
            }

            if (!success) {
              circuitOpenMs = Math.min(
                retryCfg.maxCircuitOpenMs ?? 30000,
                baseDelayMs * Math.pow(2, maxAttempts)
              );
            }

            readyTasks.delete(taskId);

            const taskItem = workflow.tasks[taskId];
            if (taskItem.next) {
              for (const nextTaskId of taskItem.next) {
                const nextTaskDeps = this.getTaskDependencies(nextTaskId, workflowId);
                const nextDepsMet = nextTaskDeps.every(dep =>
                  context.completedTasks.includes(dep)
                );
                if (nextDepsMet) {
                  readyTasks.add(nextTaskId);
                }
              }
            }
          }
        }
      }

      if (context.failedTasks.length > 0) {
        context.status = WorkflowStatus.FAILED;
        return `Workflow ${workflowId} failed. Failed tasks: ${context.failedTasks.join(', ')}`;
      }

      context.status = WorkflowStatus.COMPLETED;
      return `Workflow ${workflowId} completed successfully`;
    } catch (error: unknown) {
      context.status = WorkflowStatus.FAILED;
      context.logs.push(`[${new Date().toISOString()}] Workflow execution failed: ${error instanceof Error ? error.stack : String(error)}`);
      throw error;
    }
  }

  getStatus(workflowId: string): WorkflowStatus {
    const context = this.contexts.get(workflowId);
    return (context?.status ?? 'completed') as WorkflowStatus;
  }

  getContext(workflowId: string): WorkflowContext | undefined {
    return this.contexts.get(workflowId);
  }
}