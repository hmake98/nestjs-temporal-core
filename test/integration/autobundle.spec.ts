import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TemporalService } from '../../src';
import { GreetingActivities } from './fixtures/greeting.activities';
import { createTestEnv, IntegrationEnv, WORKFLOWS_PATH } from './helpers/test-env';

describe('integration: autoBundle', () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-autobundle-'));
    let ctx: IntegrationEnv | undefined;

    const stop = async () => {
        const current = ctx;
        ctx = undefined;
        await current?.teardown();
    };

    afterEach(stop);

    afterAll(() => fs.rmSync(cacheDir, { recursive: true, force: true }));

    const runGreeting = async () => {
        const started = await ctx!.app.get(TemporalService).startWorkflow<{
            result: () => Promise<string>;
        }>('greetingWorkflow', ['Bundle'], {
            taskQueue: ctx!.taskQueue,
            workflowId: `autobundle-${Date.now()}`,
        });
        expect(started.success).toBe(true);
        return started.result?.result();
    };

    it('bundles at startup, runs a workflow, and reuses the cache on the next boot', async () => {
        const options = {
            worker: {
                workflowsPath: WORKFLOWS_PATH,
                autoBundle: { cacheDir },
                activityClasses: [GreetingActivities],
                autoStart: true,
            },
        };

        ctx = await createTestEnv({ activityClasses: [GreetingActivities], options });
        await expect(runGreeting()).resolves.toBe('Hello, Bundle!');
        const cached = fs.readdirSync(cacheDir);
        expect(cached).toHaveLength(1);
        const mtime = fs.statSync(path.join(cacheDir, cached[0])).mtimeMs;
        await stop();

        ctx = await createTestEnv({ activityClasses: [GreetingActivities], options });
        await expect(runGreeting()).resolves.toBe('Hello, Bundle!');
        // Same source: same single cache entry, not rewritten.
        expect(fs.readdirSync(cacheDir)).toEqual(cached);
        expect(fs.statSync(path.join(cacheDir, cached[0])).mtimeMs).toBe(mtime);
    });

    it('fails at startup with a clear message when the path is wrong', async () => {
        await expect(
            createTestEnv({
                options: {
                    worker: {
                        workflowsPath: './does/not/exist',
                        autoBundle: { cacheDir },
                        autoStart: true,
                    },
                },
            }),
        ).rejects.toThrow(/was not found/);
    });
});
