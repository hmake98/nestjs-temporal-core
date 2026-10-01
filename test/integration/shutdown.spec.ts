import { TemporalService } from '../../src';
import { SlowActivities, slowState } from './fixtures/slow.activities';
import { createTestEnv, WORKFLOWS_PATH } from './helpers/test-env';

describe('integration: graceful shutdown drains in-flight activities', () => {
    it('lets a running activity finish after shutdown starts, given a grace period', async () => {
        const ctx = await createTestEnv({
            activityClasses: [SlowActivities],
            options: {
                shutdownTimeout: 20000,
                worker: {
                    workflowsPath: WORKFLOWS_PATH,
                    activityClasses: [SlowActivities],
                    autoStart: true,
                    // Without a grace period the SDK cancels in-flight activities on shutdown.
                    workerOptions: { shutdownGraceTime: '10s' },
                },
            },
        });
        const temporal = ctx.app.get(TemporalService);

        try {
            await temporal.startWorkflow('slowWorkflow', [1500], {
                taskQueue: ctx.taskQueue,
                workflowId: `drain-${Date.now()}`,
            });

            // Wait until the activity is actually running on the worker.
            const deadline = Date.now() + 15000;
            while (slowState.started === 0 && Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 50));
            }
            expect(slowState.started).toBe(1);
            expect(slowState.finished).toBe(0);

            await ctx.app.close();

            // close() only signals the worker; the drain completes in the background, so poll.
            const drainDeadline = Date.now() + 15000;
            while (slowState.finished === 0 && Date.now() < drainDeadline) {
                await new Promise((r) => setTimeout(r, 50));
            }
            expect(slowState.finished).toBe(1);
        } finally {
            await ctx.env.teardown();
        }
    });
});

describe('integration: shutdown without a grace period', () => {
    it('cancels in-flight activities (SDK default), so they do not finish', async () => {
        const before = { ...slowState };
        const ctx = await createTestEnv({ activityClasses: [SlowActivities] });
        const temporal = ctx.app.get(TemporalService);

        try {
            await temporal.startWorkflow('slowWorkflow', [1500], {
                taskQueue: ctx.taskQueue,
                workflowId: `nodrain-${Date.now()}`,
            });
            const deadline = Date.now() + 15000;
            while (slowState.started === before.started && Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 50));
            }

            await ctx.app.close();
            await new Promise((r) => setTimeout(r, 2500));

            expect(slowState.finished).toBe(before.finished);
        } finally {
            await ctx.env.teardown();
        }
    });
});
