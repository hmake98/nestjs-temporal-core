import { TemporalService } from '../../src';
import { GreetingActivities } from './fixtures/greeting.activities';
import { createTestEnv, IntegrationEnv } from './helpers/test-env';

describe('integration smoke: start workflow, worker runs activity, result returned', () => {
    let ctx: IntegrationEnv;

    beforeAll(async () => {
        ctx = await createTestEnv({ activityClasses: [GreetingActivities] });
    });

    afterAll(async () => {
        await ctx.teardown();
    });

    it('runs the workflow through the Nest-managed worker', async () => {
        const temporal = ctx.app.get(TemporalService);

        const started = await temporal.startWorkflow<{
            workflowId: string;
            result: () => Promise<string>;
        }>('greetingWorkflow', ['Temporal'], {
            taskQueue: ctx.taskQueue,
            workflowId: `greeting-${Date.now()}`,
        });

        expect(started.success).toBe(true);
        await expect(started.result?.result()).resolves.toBe('Hello, Temporal!');
    });
});
