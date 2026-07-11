/**
 * 库存同步工作流定义
 * 多租户库存同步：源系统 → 校验 → 同步 → 缓存刷新 → 通知
 */
export const inventorySyncWorkflow = {
  id: 'inventory-sync',
  name: '库存同步',
  version: '1.0.0',
  tasks: [
    {
      id: 'fetch-source-inventory',
      name: '获取源库存数据',
      type: 'async',
      handler: 'fetchSourceInventory',
      inputSchema: {
        tenantId: 'string',
        sourceSystem: 'string',
      },
      timeout: 60000,
      retryPolicy: { maxAttempts: 3, backoffMs: 5000 },
    },
    {
      id: 'validate-inventory-data',
      name: '校验库存数据',
      type: 'sync',
      handler: 'validateInventoryData',
      inputSchema: {
        inventoryData: 'any[]',
        tenantId: 'string',
      },
      timeout: 10000,
    },
    {
      id: 'sync-inventory',
      name: '同步库存到数据库',
      type: 'rpc',
      handler: 'syncInventory',
      inputSchema: {
        tenantId: 'string',
        inventoryItems: 'any[]',
      },
      timeout: 120000,
      retryPolicy: { maxAttempts: 2, backoffMs: 10000 },
    },
    {
      id: 'invalidate-cache',
      name: '失效相关缓存',
      type: 'async',
      handler: 'invalidateCache',
      inputSchema: {
        tenantId: 'string',
        productIds: 'string[]',
      },
      timeout: 10000,
    },
    {
      id: 'notify-completion',
      name: '通知同步完成',
      type: 'async',
      handler: 'notifyCompletion',
      inputSchema: {
        tenantId: 'string',
        syncedCount: 'number',
        errors: 'string[]',
      },
      timeout: 5000,
    },
  ],
  transitions: [
    { from: 'fetch-source-inventory', to: 'validate-inventory-data' },
    { from: 'validate-inventory-data', to: 'sync-inventory' },
    { from: 'sync-inventory', to: 'invalidate-cache' },
    { from: 'invalidate-cache', to: 'notify-completion' },
  ],
};