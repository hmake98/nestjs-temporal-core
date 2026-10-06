import { TemporalService } from '../../src';
import {
    assertReplays,
    replayHistories,
    ReplayFailedError,
    TemporalTestEnvironment,
} from '../../src/testing';
import { GreetingActivities } from './fixtures/greeting.activities';
import { WORKFLOWS_PATH } from './helpers/test-env';
import * as path from 'path';

const downloadDir = process.env.TEMPORAL_DEV_SERVER_DIR;

describe('integration: TemporalTestEnvironment', () => {
    describe('time skipping', () => {
        let testEnv: TemporalTestEnvironment;

        beforeAll(async () => {
            testEnv = await TemporalTestEnvironment.create({ timeSkipping: true, downloadDir });
        });
        afterAll(async () => testEnv.teardown());

        it('a one-day timer finishes at once through TemporalService', async () => {
            const { app, taskQueue } = await testEnv.createApp({
                options: { worker: { workflowsPath: WORKFLOWS_PATH, autoStart: true } },
            });
            const started = await app.get(TemporalService).startWorkflow<{
                result: () => Promise<string>;
            }>('sleeperWorkflow', [], { taskQueue, workflowId: `sleep-${Date.now()}` });

            const before = Date.now();
            await expect(started.result?.result()).resolves.toBe('slept');
            expect(Date.now() - before).toBeLessThan(20_000);
            // The server clock moved about a day ahead of wall-clock time.
            expect((await testEnv.currentTimeMs()) - Date.now()).toBeGreaterThan(23 * 3600 * 1000);
        }, 90_000);
    });

    describe('replayHistories', () => {
        let testEnv: TemporalTestEnvironment;
        let history: { workflowId: string; history: unknown };

        beforeAll(async () => {
            testEnv = await TemporalTestEnvironment.create({ downloadDir });
            const { app, taskQueue } = await testEnv.createApp({
                options: { worker: { workflowsPath: WORKFLOWS_PATH, autoStart: true } },
                activityClasses: [GreetingActivities],
            });
            const workflowId = `replay-${Date.now()}`;
            const started = await app.get(TemporalService).startWorkflow<{
                result: () => Promise<string>;
            }>('greetingWorkflow', ['Replay'], { taskQueue, workflowId });
            await started.result?.result();
            history = {
                workflowId,
                history: await testEnv.client.workflow.getHandle(workflowId).fetchHistory(),
            };
        }, 90_000);
        afterAll(async () => testEnv.teardown());

        it('replays cleanly against unchanged workflow code', async () => {
            const outcomes = await replayHistories({ workflowsPath: WORKFLOWS_PATH }, [history]);
            expect(outcomes).toHaveLength(1);
            expect(outcomes[0].error).toBeUndefined();
            await expect(
                assertReplays({ workflowsPath: WORKFLOWS_PATH }, [history]),
            ).resolves.toBeUndefined();
        });

        it('reports non-determinism when the workflow code changed', async () => {
            const changed = path.resolve(__dirname, 'fixtures/workflows-changed.ts');
            const outcomes = await replayHistories({ workflowsPath: changed }, [history]);
            expect(outcomes[0].error?.name).toMatch(/Determinism/);

            await expect(
                assertReplays({ workflowsPath: changed }, [history]),
            ).rejects.toBeInstanceOf(ReplayFailedError);
        });
    });
});
