/**
 * 补货工作流定义
 * 自动补货：监测 → 计算 → 生成工单 → 派发 → 执行 → 验证 → 更新库存
 */
export const replenishmentWorkflow = {
  id: 'replenishment',
  name: '自动补货',
  version: '1.0.0',
  tasks: [
    {
      id: 'detect-low-stock',
      name: '检测低库存库位',
      type: 'sync',
      handler: 'detectLowStock',
      inputSchema: {
        tenantId: 'string',
      },
      timeout: 30000,
    },
    {
      id: 'calculate-replenishment',
      name: '计算补货量',
      type: 'sync',
      handler: 'calculateReplenishmentQty',
      inputSchema: {
        lowStockItems: 'any[]',
        tenantId: 'string',
      },
      timeout: 30000,
    },
    {
      id: 'create-replenishment-orders',
      name: '创建补货工单',
      type: 'sync',
      handler: 'createReplenishmentOrders',
      inputSchema: {
        items: 'any[]',
        tenantId: 'string',
      },
      timeout: 30000,
    },
    {
      id: 'dispatch-replenishment',
      name: '派发补货工单',
      type: 'async',
      handler: 'dispatchReplenishment',
      inputSchema: {
        workOrderIds: 'string[]',
        tenantId: 'string',
      },
      timeout: 60000,
    },
    {
      id: 'execute-replenishment',
      name: '执行补货（PDA/人工）',
      type: 'human',
      handler: 'executeReplenishment',
      inputSchema: {
        workOrderIds: 'string[]',
        tenantId: 'string',
      },
      timeout: 7200000, // 2小时
    },
    {
      id: 'verify-replenishment',
      name: '验证补货结果',
      type: 'sync',
      handler: 'verifyReplenishment',
      inputSchema: {
        workOrderIds: 'string[]',
        tenantId: 'string',
      },
      timeout: 10000,
    },
    {
      id: 'update-inventory',
      name: '更新库存记录',
      type: 'rpc',
      handler: 'updateInventoryAfterReplenishment',
      inputSchema: {
        workOrderIds: 'string[]',
        tenantId: 'string',
      },
      timeout: 60000,
      retryPolicy: { maxAttempts: 3, backoffMs: 2000 },
    },
    {
      id: 'check-next-replenishment',
      name: '检查后续补货需求',
      type: 'sync',
      handler: 'checkNextReplenishment',
      inputSchema: {
        tenantId: 'string',
      },
      timeout: 10000,
    },
  ],
  transitions: [
    { from: 'detect-low-stock', to: 'calculate-replenishment' },
    { from: 'calculate-replenishment', to: 'create-replenishment-orders' },
    { from: 'create-replenishment-orders', to: 'dispatch-replenishment' },
    { from: 'dispatch-replenishment', to: 'execute-replenishment' },
    { from: 'execute-replenishment', to: 'verify-replenishment' },
    { from: 'verify-replenishment', to: 'update-inventory' },
    { from: 'update-inventory', to: 'check-next-replenishment' },
  ],
};