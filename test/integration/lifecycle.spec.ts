import { TemporalClientService, TemporalService } from '../../src';
import { GreetingActivities } from './fixtures/greeting.activities';
import { createTestEnv, IntegrationEnv } from './helpers/test-env';

describe('integration: worker lifecycle, signal, query, update', () => {
    let ctx: IntegrationEnv;
    let temporal: TemporalService;
    let client: TemporalClientService;

    beforeAll(async () => {
        ctx = await createTestEnv({ activityClasses: [GreetingActivities] });
        temporal = ctx.app.get(TemporalService);
        client = ctx.app.get(TemporalClientService);
    });

    afterAll(async () => {
        await ctx.teardown();
    });

    const start = (type: string, args: unknown[], id: string) =>
        temporal.startWorkflow<{ result: () => Promise<unknown> }>(type, args, {
            taskQueue: ctx.taskQueue,
            workflowId: `${id}-${Date.now()}`,
        });

    it('stops the worker', async () => {
        const stoppable = await createTestEnv({ activityClasses: [GreetingActivities] });
        try {
            const service = stoppable.app.get(TemporalService);
            expect(service.isWorkerRunning()).toBe(true);

            await service.stopWorker();

            expect(service.isWorkerRunning()).toBe(false);
        } finally {
            await stoppable.teardown();
        }
    });

    // Known gap: stopWorker() shuts the SDK Worker down for good, and startWorker() reuses it
    // instead of creating a new one, so the worker never comes back. `it.failing` flips to a
    // failure once that is fixed, at which point this should become a plain `it`.
    it.failing('starts the worker again after stopWorker()', async () => {
        const stoppable = await createTestEnv({ activityClasses: [GreetingActivities] });
        try {
            const service = stoppable.app.get(TemporalService);
            await service.stopWorker();

            await service.startWorker();

            expect(service.isWorkerRunning()).toBe(true);
        } finally {
            await stoppable.teardown();
        }
    });

    it('signals, queries and updates a running workflow, then completes it', async () => {
        const started = await start('counterWorkflow', [], 'counter');
        const workflowId = (started.result as unknown as { workflowId: string }).workflowId;

        await temporal.signalWorkflow(workflowId, 'add', [5]);
        await temporal.signalWorkflow(workflowId, 'add', [7]);

        const queried = await temporal.queryWorkflow<number>(workflowId, 'total');
        expect(queried).toMatchObject({ success: true, result: 12, queryName: 'total' });

        const previous = await client.updateWorkflow<number>(workflowId, 'setTotal', [100]);
        expect(previous).toBe(12);
        await expect(temporal.queryWorkflow<number>(workflowId, 'total')).resolves.toMatchObject({
            result: 100,
        });

        await temporal.signalWorkflow(workflowId, 'finish');
        await expect(started.result?.result()).resolves.toBe(100);
    });

    it('signalWithStart starts the workflow when absent', async () => {
        const workflowId = `sws-${Date.now()}`;
        const result = await temporal.signalWithStart('counterWorkflow', 'add', [3], [], {
            taskQueue: ctx.taskQueue,
            workflowId,
        });
        expect(result).toMatchObject({ success: true, workflowId });

        await temporal.signalWorkflow(workflowId, 'finish');
        const handle = await temporal.getWorkflowHandle<{ result: () => Promise<number> }>(
            workflowId,
        );
        await expect(handle.result()).resolves.toBe(3);
    });

    it('cancels and terminates workflows', async () => {
        const toCancel = await start('counterWorkflow', [], 'cancel');
        const cancelId = (toCancel.result as unknown as { workflowId: string }).workflowId;
        await expect(temporal.cancelWorkflow(cancelId)).resolves.toMatchObject({ success: true });
        await expect(toCancel.result?.result()).rejects.toThrow();

        const toTerminate = await start('counterWorkflow', [], 'terminate');
        const termId = (toTerminate.result as unknown as { workflowId: string }).workflowId;
        await expect(temporal.terminateWorkflow(termId, 'test')).resolves.toMatchObject({
            success: true,
            reason: 'test',
        });
        await expect(toTerminate.result?.result()).rejects.toThrow();
    });

    it('surfaces the original SDK error as cause when signalling a missing workflow', async () => {
        const error: any = await temporal
            .signalWorkflow('does-not-exist', 'add', [1])
            .catch((e) => e);

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('does-not-exist');
        expect(error.cause).toBeDefined();
    });
});
