// Simple test for enhanced auto-retry functionality in WorkflowManager
import { WorkflowManager } from './WorkflowManager';

// Create ONE instance that will be reused across workflow retries
const flakyTaskInstance = new (class {
  private attemptCount = 0;
  private readonly failUntilAttempt: number;

  constructor(failUntilAttempt: number = 2) {
    this.failUntilAttempt = failUntilAttempt;
  }

  async execute(): Promise<string> {
    this.attemptCount++;
    console.log(`FlakyTask execution attempt #${this.attemptCount}`);

    if (this.attemptCount <= this.failUntilAttempt) {
      const error = new Error(`Simulated failure on attempt ${this.attemptCount}`);
      (error as any).retryable = true;
      throw error;
    }

    return `Success on attempt ${this.attemptCount}`;
  }
})(2); // Fail first 2 attempts, succeed on 3rd

async function testAutoRetry() {
  console.log('Testing enhanced auto-retry functionality...\n');

  const workflowManager = new WorkflowManager();

  // Create a simple workflow that uses the SAME flaky task instance
  const workflowSpec = {
    id: 'test-retry-workflow',
    name: 'Test Retry Workflow',
    description: 'Tests auto-retry functionality',
    tasks: {
      'flaky-task': {
        id: 'flaky-task',
        name: 'Flaky Task',
        description: 'A task that fails a few times then succeeds',
        execute: async () => {
          // Use the SAME instance - maintains attemptCount across retries
          return await flakyTaskInstance.execute();
        },
        retry: {
          retryable: true,
          maxAttempts: 5,
          baseDelayMs: 1000
        }
      }
    },
    dependencies: {},
    initialTasks: ['flaky-task'],
    entryPoints: ['flaky-task']
  };

  // Register the workflow
  workflowManager.registerWorkflow(workflowSpec);

  try {
    const result = await workflowManager.executeWorkflow('test-retry-workflow');
    console.log(`\nWorkflow result: ${result}`);

    return true;
  } catch (error) {
    console.error('Workflow test failed:', error);
    return false;
  }
}

// Run the test
testAutoRetry()
  .then(success => {
    if (success) {
      console.log('\n✅ Auto-retry test PASSED');
    } else {
      console.log('\n❌ Auto-retry test FAILED');
    }
  })
  .catch(err => {
    console.error('Unexpected error:', err);
  });