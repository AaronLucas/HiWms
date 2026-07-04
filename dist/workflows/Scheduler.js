// Re-export WorkflowManager from workflow-engine
export { WorkflowManager } from 'wms-workflow-engine';
// Workflow scheduling controller
export class WorkflowScheduler {
    constructor(workflowManager) {
        this.configs = new Map();
        this.workflowManager = workflowManager;
    }
    registerConfig(config) {
        this.configs.set(config.id, config);
    }
    getConfig(id) {
        return this.configs.get(id);
    }
    async scheduleAndExecute(configId, contextData) {
        const config = this.configs.get(configId);
        if (!config)
            throw new Error(`Configuration ${configId} not found`);
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
