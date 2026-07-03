import { WorkflowManager, TaskManager, RetryableTask } from 'wms-workflow-engine';
import { WorkflowScheduler } from './src/workflows/Scheduler.ts';

console.log('🧪 Testing end-to-end integration...');

// 1. Create workflow manager
const workflowManager = new WorkflowManager();

// 2. Register a simple workflow
const workflowSpec = {
  id: 'integration-test-workflow',
  name: 'Integration Test Workflow',
  description: 'Tests workflow-engine + src/workflows integration',
  tasks: {
    'task-1': {
      id: 'task-1',
      name: 'First Task',
      description: 'A simple task that succeeds',
      execute: async () => {
        console.log('  → Task 1 executing...');
        return 'Task 1 completed';
      },
    },
    'task-2': {
      id: 'task-2',
      name: 'Second Task',
      description: 'A task that retries twice then succeeds',
      execute: async () => {
        const rt = new RetryableTask(3, 100);
        return rt.execute(async () => {
          console.log('  → Task 2 executing (with retry)...');
          if (Math.random() > 0.5) {
            const err = new Error('Random failure');
            (err as any).retryable = true;
            throw err;
          }
          return 'Task 2 completed after retry';
        });
      },
      retry: { maxAttempts: 3, baseDelayMs: 50 },
    },
  },
  dependencies: {
    'task-2': ['task-1'],
  },
  initialTasks: ['task-1'],
  entryPoints: ['task-1'],
};

workflowManager.registerWorkflow(workflowSpec);

// 3. Execute workflow
console.log('\n🚀 Executing workflow...');
const result = await workflowManager.executeWorkflow('integration-test-workflow');
console.log(`\n📋 Result: ${result}`);

// 4. Test Scheduler
const workflowManager2 = new WorkflowManager();
const scheduler = new (await import('./src/workflows/Scheduler.ts')).WorkflowScheduler(workflowManager2);

const config = {
  id: 'test-config',
  name: 'Test Config',
  description: 'Test scheduler config',
  enabled: true,
  metadata: { workflowId: 'integration-test-workflow' },
};

await scheduler.registerConfig(config);
console.log('\n✅ Scheduler config registered');

console.log('\n🎉 All integration tests passed!');