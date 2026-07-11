/**
 * 订单处理工作流定义
 * 完整流程：订单创建 → 库存分配 → 波次生成 → 工单派发 → 拣货/打包/发货
 */
export const orderProcessWorkflow = {
  id: 'order-process',
  name: '订单全流程处理',
  version: '1.0.0',
  tasks: [
    {
      id: 'validate-order',
      name: '校验订单',
      type: 'sync',
      handler: 'validateOrder',
      inputSchema: {
        orderId: 'string',
        tenantId: 'string',
      },
      timeout: 5000,
    },
    {
      id: 'allocate-inventory',
      name: '库存分配',
      type: 'rpc',
      handler: 'allocateInventory',
      inputSchema: {
        orderId: 'string',
        skuId: 'string',
        neededQty: 'number',
        tenantId: 'string',
      },
      timeout: 30000,
      retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
    },
    {
      id: 'create-wave',
      name: '生成波次',
      type: 'sync',
      handler: 'createWave',
      inputSchema: {
        orderIds: 'string[]',
        strategyType: 'string',
        tenantId: 'string',
      },
      timeout: 10000,
    },
    {
      id: 'dispatch-workorders',
      name: '派发工单',
      type: 'sync',
      handler: 'dispatchWorkOrders',
      inputSchema: {
        waveId: 'string',
        tenantId: 'string',
      },
      timeout: 10000,
    },
    {
      id: 'picking',
      name: '拣货执行',
      type: 'human',
      handler: 'pickingTask',
      inputSchema: {
        workOrderIds: 'string[]',
        tenantId: 'string',
      },
      timeout: 3600000, // 1小时
    },
    {
      id: 'verification',
      name: '复核验货',
      type: 'human',
      handler: 'verificationTask',
      inputSchema: {
        workOrderIds: 'string[]',
        tenantId: 'string',
      },
      timeout: 1800000, // 30分钟
    },
    {
      id: 'packing',
      name: '打包装箱',
      type: 'human',
      handler: 'packingTask',
      inputSchema: {
        workOrderIds: 'string[]',
        tenantId: 'string',
      },
      timeout: 1800000,
    },
    {
      id: 'loading',
      name: '装车发货',
      type: 'human',
      handler: 'loadingTask',
      inputSchema: {
        workOrderIds: 'string[]',
        tenantId: 'string',
      },
      timeout: 1800000,
    },
    {
      id: 'complete-order',
      name: '完成订单',
      type: 'sync',
      handler: 'completeOrder',
      inputSchema: {
        orderId: 'string',
        tenantId: 'string',
      },
      timeout: 5000,
    },
  ],
  transitions: [
    { from: 'validate-order', to: 'allocate-inventory' },
    { from: 'allocate-inventory', to: 'create-wave' },
    { from: 'create-wave', to: 'dispatch-workorders' },
    { from: 'dispatch-workorders', to: 'picking' },
    { from: 'picking', to: 'verification' },
    { from: 'verification', to: 'packing' },
    { from: 'packing', to: 'loading' },
    { from: 'loading', to: 'complete-order' },
  ],
};