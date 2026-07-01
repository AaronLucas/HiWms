// 统一工作流系统入口文件，将所有导出汇总
import { WorkflowStatus } from './types';
export { WorkflowStatus };
export { WorkflowManager } from './WorkflowManager';
export { TaskManager } from './TaskManager';
export { WorkflowScheduler } from './Scheduler';
export { InventoryTasks, OrderTasks } from './tasks';
// Sample workflows defined inline to avoid circular imports
export const SAMPLE_WORKFLOWS = {
    'inventory-sync': {
        id: 'inventory-sync',
        name: '库存同步工作流',
        description: '在多个仓库之间同步最新库存信息',
        tasks: {
            // 任务 1：抓取原始库存数据
            '1': {
                id: '1',
                name: '抓取库存数据',
                description: '从外部数据源拉取原始库存记录',
                execute: async (...args) => {
                    return '库存数据已抓取';
                },
                retry: {
                    maxAttempts: 3,
                    baseDelayMs: 500,
                    maxCircuitOpenMs: 20000,
                    retryable: true,
                },
            },
            // 任务 2：比对差异
            '2': {
                id: '2',
                name: '比对差异',
                description: '与预期库存进行对比并生成差异报告',
                execute: async (...args) => {
                    return '差异比对完成';
                },
                retry: { maxAttempts: 2, baseDelayMs: 300 },
            },
            // 任务 3：更新库存
            '3': {
                id: '3',
                name: '更新库存',
                description: '根据差异信息更新库存系统',
                execute: async (...args) => {
                    return '库存已更新';
                },
            },
        },
        dependencies: {
            '2': ['1'],
            '3': ['2'],
        },
        initialTasks: ['1'],
        entryPoints: ['1'],
    },
    'order-process': {
        id: 'order-process',
        name: '订单处理工作流',
        description: '完整的订单从创建到发货的全流程',
        tasks: {
            // 参数化任务示例
            '5': {
                id: '5',
                name: '校验订单',
                description: '校验订单信息并检查库存可用性',
                execute: async (...args) => {
                    const orderData = args[0] || {};
                    return JSON.stringify({ status: 'validated', orderId: 'ORD-001', items: orderData.items || [] });
                },
                retry: { maxAttempts: 2, baseDelayMs: 200 },
            },
            '6': {
                id: '6',
                name: '检查库存可用性',
                description: '基于上一步结果查询库存',
                execute: async (...args) => {
                    const prevResult = args[0] || {};
                    return JSON.stringify({ inventory: 'available', prev: prevResult });
                },
                retry: { maxAttempts: 3, baseDelayMs: 400 },
            },
            '7': {
                id: '7',
                name: '分配库存并创建工单',
                description: '根据检查结果分配资源并生成工单',
                execute: async (...args) => {
                    const prevResult = args[0] || {};
                    return JSON.stringify({ workOrder: 'WO-001', prev: prevResult });
                },
                retry: { maxAttempts: 2, baseDelayMs: 600 },
            },
            '8': {
                id: '8',
                name: '生成并发送工单',
                description: '将工单写入系统并发送到拣货区',
                execute: async (...args) => {
                    const prevResult = args[0] || {};
                    return JSON.stringify({ workOrderSent: true, prev: prevResult });
                },
            },
            '9': {
                id: '9',
                name: '处理发货',
                description: '完成发货流程并更新状态',
                execute: async (...args) => {
                    const prevResult = args[0] || {};
                    return JSON.stringify({ shipped: true, prev: prevResult });
                },
            },
        },
        dependencies: {
            '6': ['5'],
            '7': ['6'],
            '8': ['7'],
            '9': ['8'],
        },
        initialTasks: ['5'],
        entryPoints: ['5'],
    }
};
export * from './types';
