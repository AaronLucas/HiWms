/**
 * Inventory Synchronization Workflow Tasks
 */
export declare function checkInventoryLevels(): Promise<string>;
export declare function updateInventoryRecords(): Promise<string>;
export declare function notifyStakeholders(): Promise<string>;
export declare function generateReplenishmentReport(): Promise<string>;
/**
 * Order Processing Workflow Tasks
 */
export declare function validateOrder(orderData: any): Promise<string>;
export declare function checkInventoryAvailability(orderData: any): Promise<string>;
export declare function allocateInventoryAndCreateWorkOrder(availabilityData: any): Promise<string>;
export declare function createWorkOrder(workOrderData: any): Promise<string>;
export declare function processShipment(workOrderData: any): Promise<string>;
/**
 * Helper function to run a task with retry logic
 */
declare function executeTaskWithRetry<T>(taskFn: () => Promise<T>, maxAttempts?: number, delayMs?: number): Promise<T>;
export declare const InventoryTasks: {
    checkInventoryLevels: typeof checkInventoryLevels;
    updateInventoryRecords: typeof updateInventoryRecords;
    notifyStakeholders: typeof notifyStakeholders;
    generateReplenishmentReport: typeof generateReplenishmentReport;
};
export declare const OrderTasks: {
    validateOrder: typeof validateOrder;
    checkInventoryAvailability: typeof checkInventoryAvailability;
    allocateInventoryAndCreateWorkOrder: typeof allocateInventoryAndCreateWorkOrder;
    createWorkOrder: typeof createWorkOrder;
    processShipment: typeof processShipment;
};
export { executeTaskWithRetry };
