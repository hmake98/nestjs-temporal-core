import { TemporalService } from '../../src';
import { attempts, FailingActivities } from './fixtures/failing.activities';
import { createTestEnv, IntegrationEnv } from './helpers/test-env';

describe('integration: errorMapping and @NonRetryable', () => {
    let on: IntegrationEnv;
    let off: IntegrationEnv;

    beforeAll(async () => {
        on = await createTestEnv({
            activityClasses: [FailingActivities],
            options: { errorMapping: true },
        });
        off = await createTestEnv({ activityClasses: [FailingActivities] });
    });

    afterAll(async () => {
        await on.teardown();
        await off.teardown();
    });

    const run = async (ctx: IntegrationEnv, which: string) => {
        attempts[which] = 0;
        const started = await ctx.app.get(TemporalService).startWorkflow<{
            result: () => Promise<void>;
        }>('failingWorkflow', [which], {
            taskQueue: ctx.taskQueue,
            workflowId: `fail-${which}-${Date.now()}`,
        });
        await expect(started.result?.result()).rejects.toThrow();
        return attempts[which];
    };

    it('mapping on: HttpException 4xx and @NonRetryable stop after one attempt', async () => {
        await expect(run(on, 'httpFail')).resolves.toBe(1);
        await expect(run(on, 'decoratedFail')).resolves.toBe(1);
    });

    it('mapping on: an unmarked error is still retried up to the policy', async () => {
        await expect(run(on, 'plainFail')).resolves.toBe(3);
    });

    it('mapping off (default): behavior is unchanged, everything retries', async () => {
        await expect(run(off, 'httpFail')).resolves.toBe(3);
        await expect(run(off, 'decoratedFail')).resolves.toBe(3);
    });
});
