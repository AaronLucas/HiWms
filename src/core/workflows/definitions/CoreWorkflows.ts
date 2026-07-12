/**
 * 核心工作流定义
 * order-process: 订单全流程处理（下单 → 分配 → 波次 → 拣货 → 复核 → 打包 → 装车）
 * inventory-sync: 库存同步（外部系统 → WMS）
 * replenishment: 补货流程（监测 → 生成工单 → 执行 → 确认）
 */

import { WorkflowDefinition, TaskDefinition, TransitionDefinition } from '../IWorkflowEngine';

/** 订单处理工作流定义 */
export const OrderProcessWorkflow: WorkflowDefinition = {
  id: 'order-process',
  name: '订单全流程处理',
  version: '1.0.0',
  tasks: [
    {
      id: 'validate-order',
      name: '验证订单',
      type: 'sync',
      handler: 'validateOrder',
      inputSchema: { orderId: 'string', tenantId: 'string' },
    },
    {
      id: 'allocate-inventory',
      name: '库存分配',
      type: 'rpc',
      handler: 'allocateInventory',
      inputSchema: { orderId: 'string', skuId: 'string', neededQty: 'number' },
      retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
    },
    {
      id: 'create-wave',
      name: '创建波次',
      type: 'sync',
      handler: 'createWave',
      inputSchema: { orderIds: 'string[]', strategyType: 'string' },
    },
    {
      id: 'generate-work-orders',
      name: '生成工单',
      type: 'sync',
      handler: 'generateWorkOrders',
      inputSchema: { waveId: 'string', taskTypes: 'string[]' },
    },
    {
      id: 'dispatch-picking',
      name: '派发拣货工单',
      type: 'async',
      handler: 'dispatchPicking',
      inputSchema: { workOrderIds: 'string[]' },
    },
    {
      id: 'wait-picking-complete',
      name: '等待拣货完成',
      type: 'human',
      handler: 'waitPickingComplete',
      inputSchema: { waveId: 'string' },
      timeout: 3600000, // 1小时
    },
    {
      id: 'dispatch-verification',
      name: '派发复核工单',
      type: 'async',
      handler: 'dispatchVerification',
      inputSchema: { workOrderIds: 'string[]' },
    },
    {
      id: 'wait-verification-complete',
      name: '等待复核完成',
      type: 'human',
      handler: 'waitVerificationComplete',
      inputSchema: { waveId: 'string' },
      timeout: 1800000, // 30分钟
    },
    {
      id: 'dispatch-packing',
      name: '派发打包工单',
      type: 'async',
      handler: 'dispatchPacking',
      inputSchema: { workOrderIds: 'string[]' },
    },
    {
      id: 'wait-packing-complete',
      name: '等待打包完成',
      type: 'human',
      handler: 'waitPackingComplete',
      inputSchema: { waveId: 'string' },
      timeout: 1800000,
    },
    {
      id: 'dispatch-loading',
      name: '派发装车工单',
      type: 'async',
      handler: 'dispatchLoading',
      inputSchema: { workOrderIds: 'string[]' },
    },
    {
      id: 'wait-loading-complete',
      name: '等待装车完成',
      type: 'human',
      handler: 'waitLoadingComplete',
      inputSchema: { waveId: 'string' },
      timeout: 1800000,
    },
    {
      id: 'complete-order',
      name: '完成订单',
      type: 'sync',
      handler: 'completeOrder',
      inputSchema: { waveId: 'string' },
    },
  ],
  transitions: [
    { from: 'validate-order', to: 'allocate-inventory' },
    { from: 'allocate-inventory', to: 'create-wave' },
    { from: 'create-wave', to: 'generate-work-orders' },
    { from: 'generate-work-orders', to: 'dispatch-picking' },
    { from: 'dispatch-picking', to: 'wait-picking-complete' },
    { from: 'wait-picking-complete', to: 'dispatch-verification' },
    { from: 'dispatch-verification', to: 'wait-verification-complete' },
    { from: 'wait-verification-complete', to: 'dispatch-packing' },
    { from: 'dispatch-packing', to: 'wait-packing-complete' },
    { from: 'wait-packing-complete', to: 'dispatch-loading' },
    { from: 'dispatch-loading', to: 'wait-loading-complete' },
    { from: 'wait-loading-complete', to: 'complete-order' },
  ],
};

/** 库存同步工作流定义 */
export const InventorySyncWorkflow: WorkflowDefinition = {
  id: 'inventory-sync',
  name: '库存同步',
  version: '1.0.0',
  tasks: [
    {
      id: 'fetch-source-inventory',
      name: '获取源系统库存',
      type: 'async',
      handler: 'fetchSourceInventory',
      inputSchema: { tenantId: 'string', sourceSystem: 'string' },
      timeout: 300000, // 5分钟
    },
    {
      id: 'compare-inventory',
      name: '对比库存差异',
      type: 'sync',
      handler: 'compareInventory',
      inputSchema: { sourceData: 'object', localData: 'object' },
    },
    {
      id: 'resolve-conflicts',
      name: '解决冲突',
      type: 'sync',
      handler: 'resolveConflicts',
      inputSchema: { differences: 'object[]' },
    },
    {
      id: 'apply-changes',
      name: '应用变更',
      type: 'rpc',
      handler: 'applyInventoryChanges',
      inputSchema: { changes: 'object[]' },
      retryPolicy: { maxAttempts: 3, backoffMs: 2000 },
    },
    {
      id: 'notify-completion',
      name: '通知完成',
      type: 'async',
      handler: 'sendNotification',
      inputSchema: { tenantId: 'string', result: 'object' },
    },
  ],
  transitions: [
    { from: 'fetch-source-inventory', to: 'compare-inventory' },
    { from: 'compare-inventory', to: 'resolve-conflicts' },
    { from: 'resolve-conflicts', to: 'apply-changes' },
    { from: 'apply-changes', to: 'notify-completion' },
  ],
};

/** 补货工作流定义 */
export const ReplenishmentWorkflow: WorkflowDefinition = {
  id: 'replenishment',
  name: '补货流程',
  version: '1.0.0',
  tasks: [
    {
      id: 'detect-low-stock',
      name: '检测低库存',
      type: 'sync',
      handler: 'detectLowStock',
      inputSchema: { tenantId: 'string' },
    },
    {
      id: 'calculate-replenishment-qty',
      name: '计算补货量',
      type: 'sync',
      handler: 'calculateReplenishmentQty',
      inputSchema: { lowStockItems: 'object[]' },
    },
    {
      id: 'create-replenishment-orders',
      name: '创建补货工单',
      type: 'sync',
      handler: 'createReplenishmentOrders',
      inputSchema: { items: 'object[]' },
    },
    {
      id: 'dispatch-replenishment',
      name: '派发补货工单',
      type: 'async',
      handler: 'dispatchReplenishment',
      inputSchema: { workOrderIds: 'string[]' },
    },
    {
      id: 'wait-replenishment-complete',
      name: '等待补货完成',
      type: 'human',
      handler: 'waitReplenishmentComplete',
      inputSchema: { workOrderIds: 'string[]' },
      timeout: 7200000, // 2小时
    },
    {
      id: 'verify-replenishment',
      name: '验证补货结果',
      type: 'sync',
      handler: 'verifyReplenishment',
      inputSchema: { workOrderIds: 'string[]' },
    },
    {
      id: 'update-inventory',
      name: '更新库存',
      type: 'rpc',
      handler: 'updateInventoryAfterReplenishment',
      inputSchema: { workOrderIds: 'string[]' },
      retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
    },
  ],
  transitions: [
    { from: 'detect-low-stock', to: 'calculate-replenishment-qty' },
    { from: 'calculate-replenishment-qty', to: 'create-replenishment-orders' },
    { from: 'create-replenishment-orders', to: 'dispatch-replenishment' },
    { from: 'dispatch-replenishment', to: 'wait-replenishment-complete' },
    { from: 'wait-replenishment-complete', to: 'verify-replenishment' },
    { from: 'verify-replenishment', to: 'update-inventory' },
  ],
};

/** 所有工作流定义导出 */
export const WORKFLOW_DEFINITIONS = [
  OrderProcessWorkflow,
  InventorySyncWorkflow,
  ReplenishmentWorkflow,
];