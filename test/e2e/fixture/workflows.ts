// Sandboxed workflow: only @temporalio/workflow imports.
import { proxyActivities } from '@temporalio/workflow';

const { shout } = proxyActivities<{ shout(text: string): Promise<string> }>({
    startToCloseTimeout: '10 seconds',
});

export async function e2eWorkflow(name: string): Promise<string> {
    return shout(`hello ${name}`);
}
