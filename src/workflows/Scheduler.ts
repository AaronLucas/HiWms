// Configuration for workflow scheduling
// This would normally be stored in a database or configuration file
export interface WorkflowConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  schedule?: {
    cron?: string; // Cron expression for scheduled execution
    interval?: number; // Interval in milliseconds
    trigger?: string; // 'manual', 'scheduled', 'event_based'
  };
  metadata?: Record<string, any>; // Custom metadata
}

// Re-export WorkflowManager from workflow-engine
export { WorkflowManager } from 'wms-workflow-engine';

// Workflow scheduling controller
export class WorkflowScheduler {
  private configs: Map<string, WorkflowConfig> = new Map();
  private workflowManager: InstanceType<typeof import('wms-workflow-engine').WorkflowManager>;

  constructor(workflowManager: InstanceType<typeof import('wms-workflow-engine').WorkflowManager>) {
    this.workflowManager = workflowManager;
  }

  registerConfig(config: WorkflowConfig): void {
    this.configs.set(config.id, config);
  }

  getConfig(id: string): WorkflowConfig | undefined {
    return this.configs.get(id);
  }

  async scheduleAndExecute(configId: string, contextData?: any): Promise<any> {
    const config = this.configs.get(configId);
    if (!config) throw new Error(`Configuration ${configId} not found`);

    if (config.enabled) {
      // For manual execution
      if (config.schedule?.trigger === 'manual' || !config.schedule) {
        // Execute workflow with context
        const workflowId = config.metadata?.workflowId ||
                          config.metadata?.workflow ||
                          'default-workflow';

        // In a real implementation, we would schedule the execution
        // For now, execute immediately
        return this.workflowManager.executeWorkflow(workflowId, contextData);
      }

      // For scheduled execution, we would set up a cron trigger
      // That would be implemented in a real system with cron scheduler
      throw new Error('Scheduled execution requires a scheduler implementation');
    }
  }
}