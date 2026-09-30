// Workflow code runs inside the Temporal v8 sandbox: only @temporalio/workflow imports.
import { proxyActivities } from '@temporalio/workflow';

interface GreetingActivities {
    greet(name: string): Promise<string>;
}

const { greet } = proxyActivities<GreetingActivities>({
    startToCloseTimeout: '10 seconds',
});

export async function greetingWorkflow(name: string): Promise<string> {
    return greet(name);
}
