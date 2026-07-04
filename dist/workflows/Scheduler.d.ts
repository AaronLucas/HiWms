export interface WorkflowConfig {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    schedule?: {
        cron?: string;
        interval?: number;
        trigger?: string;
    };
    metadata?: Record<string, any>;
}
export { WorkflowManager } from 'wms-workflow-engine';
export declare class WorkflowScheduler {
    private configs;
    private workflowManager;
    constructor(workflowManager: InstanceType<typeof import('wms-workflow-engine').WorkflowManager>);
    registerConfig(config: WorkflowConfig): void;
    getConfig(id: string): WorkflowConfig | undefined;
    scheduleAndExecute(configId: string, contextData?: any): Promise<any>;
}
