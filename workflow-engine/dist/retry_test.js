"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Simple test for enhanced auto-retry functionality in WorkflowManager
const WorkflowManager_1 = require("./WorkflowManager");
// Simple task that can fail intermittently for testing retry logic
class FlakyTask {
    constructor(failUntilAttempt = 2) {
        this.attemptCount = 0;
        this.failUntilAttempt = failUntilAttempt;
    }
    async execute() {
        this.attemptCount++;
        console.log(`FlakyTask execution attempt #${this.attemptCount}`);
        if (this.attemptCount <= this.failUntilAttempt) {
            throw new Error(`Simulated failure on attempt ${this.attemptCount}`);
        }
        return `Success on attempt ${this.attemptCount}`;
    }
}
async function testAutoRetry() {
    console.log('Testing enhanced auto-retry functionality...\n');
    const workflowManager = new WorkflowManager_1.WorkflowManager();
    // Create a simple workflow with one flaky task
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
                    const flakyTask = new FlakyTask(2); // Fail first 2 attempts, succeed on 3rd
                    return await flakyTask.execute();
                },
                isCompleted: false
            }
        },
        dependencies: {},
        initialTasks: ['flaky-task'],
        entryPoints: ['flaky-task']
    };
    // Register the workflow
    workflowManager.registerWorkflow(workflowSpec);
    try {
        // Execute with retry configuration (should succeed after 2 failures)
        const result = await workflowManager.executeWorkflow('test-retry-workflow');
        console.log(`\nWorkflow result: ${result}`);
        // Check context for detailed logs
        const context = workflowManager.getContext('test-retry-workflow');
        if (context) {
            console.log('\nExecution logs:');
            context.logs.forEach(log => console.log(log));
            console.log(`\nCompleted tasks: ${context.completedTasks.join(', ')}`);
            console.log(`Failed tasks: ${context.failedTasks.join(', ')}`);
        }
        return true;
    }
    catch (error) {
        console.error('Workflow test failed:', error);
        return false;
    }
}
// Run the test
testAutoRetry()
    .then(success => {
    if (success) {
        console.log('\n✅ Auto-retry test PASSED');
        process.exit(0);
    }
    else {
        console.log('\n❌ Auto-retry test FAILED');
        process.exit(1);
    }
})
    .catch(err => {
    console.error('\n❌ Auto-retry test ERROR:', err);
    process.exit(1);
});
//# sourceMappingURL=retry_test.js.map