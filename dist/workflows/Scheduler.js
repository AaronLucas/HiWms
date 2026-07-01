// Configuration for workflow scheduling
// This would normally be stored in a database or configuration file
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
                    Object.keys(this.workflows).find(key => this.workflows.get(key).entryPoints.includes(config.metadata?.workflowId || '')) ||
                    Object.keys(this.workflows)[0];
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
