import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const runReplayHistories = jest.fn();
jest.mock('@temporalio/worker', () => ({
    ...jest.requireActual('@temporalio/worker'),
    Worker: { runReplayHistories: (...a: unknown[]) => runReplayHistories(...a) },
}));

const createLocal = jest.fn();
const createTimeSkipping = jest.fn();
jest.mock('@temporalio/testing', () => ({
    TestWorkflowEnvironment: {
        createLocal: (...a: unknown[]) => createLocal(...a),
        createTimeSkipping: (...a: unknown[]) => createTimeSkipping(...a),
    },
}));

import { TEMPORAL_CLIENT } from '../../src/constants';
import {
    assertReplays,
    readHistoryFile,
    replayHistories,
    ReplayFailedError,
    TemporalTestEnvironment,
} from '../../src/testing';

async function* results(...items: object[]) {
    for (const item of items) yield item;
}

describe('replay helpers', () => {
    beforeEach(() => runReplayHistories.mockReset());

    it('replayHistories maps SDK results to outcomes', async () => {
        runReplayHistories.mockReturnValue(
            results(
                { workflowId: 'a', runId: 'r1' },
                { workflowId: 'b', runId: 'r2', error: new Error('x') },
            ),
        );
        const histories = [
            { workflowId: 'a', history: {} },
            { workflowId: 'b', history: {} },
        ];
        const out = await replayHistories({ workflowsPath: 'w' }, histories);
        expect(runReplayHistories).toHaveBeenCalledWith({ workflowsPath: 'w' }, histories);
        expect(out).toEqual([
            { workflowId: 'a', runId: 'r1', error: undefined },
            { workflowId: 'b', runId: 'r2', error: expect.any(Error) },
        ]);
    });

    it('rejects duplicate workflow ids', async () => {
        await expect(
            replayHistories({ workflowsPath: 'w' }, [
                { workflowId: 'a', history: {} },
                { workflowId: 'a', history: {} },
            ]),
        ).rejects.toThrow('workflowId values must be unique');
    });

    it('assertReplays resolves when all replay, throws ReplayFailedError listing failures', async () => {
        runReplayHistories.mockReturnValueOnce(results({ workflowId: 'a', runId: 'r' }));
        await expect(
            assertReplays({ workflowsPath: 'w' }, [{ workflowId: 'a', history: {} }]),
        ).resolves.toBeUndefined();

        runReplayHistories.mockReturnValueOnce(
            results({ workflowId: 'a', runId: 'r', error: new Error('nondeterminism') }),
        );
        const error = await assertReplays({ workflowsPath: 'w' }, [
            { workflowId: 'a', history: {} },
        ]).catch((e) => e);
        expect(error).toBeInstanceOf(ReplayFailedError);
        expect(error.message).toContain('1 workflow history failed to replay');
        expect(error.message).toContain('a: nondeterminism');
        expect(error.failures).toHaveLength(1);
    });

    it('pluralizes the failure message', () => {
        const err = new ReplayFailedError([
            { workflowId: 'a', runId: '1', error: new Error('e') },
            { workflowId: 'b', runId: '2', error: new Error('e') },
        ]);
        expect(err.message).toContain('2 workflow histories failed');
        expect(err.name).toBe('ReplayFailedError');
    });

    it('readHistoryFile parses JSON and derives the workflow id from the file name', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-'));
        const file = path.join(dir, 'order-42.json');
        fs.writeFileSync(file, JSON.stringify({ events: [] }));
        expect(readHistoryFile(file)).toEqual({ workflowId: 'order-42', history: { events: [] } });
        expect(readHistoryFile(file, 'custom').workflowId).toBe('custom');
        fs.rmSync(dir, { recursive: true });
    });
});

describe('TemporalTestEnvironment', () => {
    const makeEnv = () => ({
        address: 'localhost:1234',
        client: { fake: 'client' },
        sleep: jest.fn().mockResolvedValue(undefined),
        currentTimeMs: jest.fn().mockResolvedValue(42),
        teardown: jest.fn().mockResolvedValue(undefined),
    });

    beforeEach(() => {
        createLocal.mockReset();
        createTimeSkipping.mockReset();
    });

    it('create: local by default, time-skipping on request, with a cached server dir', async () => {
        createLocal.mockResolvedValue(makeEnv());
        createTimeSkipping.mockResolvedValue(makeEnv());
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-'));

        await TemporalTestEnvironment.create();
        expect(createLocal).toHaveBeenCalledWith({});

        const skipping = await TemporalTestEnvironment.create({
            timeSkipping: true,
            downloadDir: dir,
        });
        expect(createTimeSkipping).toHaveBeenCalledWith({
            server: { executable: { type: 'cached-download', downloadDir: dir } },
        });
        expect(skipping.timeSkipping).toBe(true);
        fs.rmSync(dir, { recursive: true });
    });

    it('exposes address, client, sleep and time; builds module options with a unique queue', async () => {
        const env = makeEnv();
        createLocal.mockResolvedValue(env);
        const testEnv = await TemporalTestEnvironment.create();

        expect(testEnv.address).toBe('localhost:1234');
        expect(testEnv.client).toBe(env.client);
        await testEnv.sleep(5);
        expect(env.sleep).toHaveBeenCalledWith(5);
        await expect(testEnv.currentTimeMs()).resolves.toBe(42);

        const a = testEnv.moduleOptions();
        const b = testEnv.moduleOptions({ taskQueue: 'fixed' });
        expect(a.connection?.address).toBe('localhost:1234');
        expect(a.taskQueue).toMatch(/^test-/);
        expect(a.taskQueue).not.toBe(testEnv.moduleOptions().taskQueue);
        expect(b.taskQueue).toBe('fixed');
    });

    it('teardown closes apps then the server', async () => {
        const env = makeEnv();
        createLocal.mockResolvedValue(env);
        const testEnv = await TemporalTestEnvironment.create();
        const close = jest.fn().mockResolvedValue(undefined);
        (testEnv as any).apps.push({ close }, { close });
        await testEnv.teardown();
        expect(close).toHaveBeenCalledTimes(2);
        expect(env.teardown).toHaveBeenCalled();
    });

    it('time skipping overrides TEMPORAL_CLIENT with the environment client', async () => {
        const env = makeEnv();
        createTimeSkipping.mockResolvedValue(env);
        const testEnv = await TemporalTestEnvironment.create({ timeSkipping: true });

        const overrideProvider = jest.fn();
        const useValue = jest.fn();
        const builder: any = {
            overrideProvider: overrideProvider.mockReturnValue({
                useValue: useValue.mockReturnValue('B'),
            }),
        };
        const { Test } = jest.requireActual('@nestjs/testing');
        const spy = jest.spyOn(Test, 'createTestingModule').mockReturnValue(builder);
        builder.compile = undefined;
        // After override the builder is replaced by useValue's return value.
        (useValue as jest.Mock).mockReturnValue({
            compile: async () => ({ init: async () => ({ close: jest.fn() }) }),
        });

        const { taskQueue } = await testEnv.createApp({ activityClasses: [] });
        expect(overrideProvider).toHaveBeenCalledWith(TEMPORAL_CLIENT);
        expect(useValue).toHaveBeenCalledWith(env.client);
        expect(taskQueue).toMatch(/^test-/);
        spy.mockRestore();
    });

    it('without time skipping the client is not overridden', async () => {
        createLocal.mockResolvedValue(makeEnv());
        const testEnv = await TemporalTestEnvironment.create();
        const builder: any = {
            overrideProvider: jest.fn(),
            compile: async () => ({ init: async () => ({ close: jest.fn() }) }),
        };
        const { Test } = jest.requireActual('@nestjs/testing');
        const spy = jest.spyOn(Test, 'createTestingModule').mockReturnValue(builder);
        await testEnv.createApp();
        expect(builder.overrideProvider).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('throws a clear error when @temporalio/testing is missing', async () => {
        jest.resetModules();
        jest.doMock('@temporalio/testing', () => {
            throw new Error("Cannot find module '@temporalio/testing'");
        });
        const { TemporalTestEnvironment: Env } = await import('../../src/testing/test-environment');
        await expect(Env.create()).rejects.toThrow(
            /optional peer dependency '@temporalio\/testing'/,
        );
    });
});
