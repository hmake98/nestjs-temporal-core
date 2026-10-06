import { INestApplicationContext, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestWorkflowEnvironment } from '@temporalio/testing';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { TEMPORAL_CLIENT } from '../constants';
import { TemporalClientError } from '../errors';
import type { TemporalOptions } from '../interfaces';
import { TemporalModule } from '../temporal.module';

export interface TemporalTestEnvironmentOptions {
    /**
     * `true` starts the time-skipping test server: awaiting a workflow result (or calling
     * {@link TemporalTestEnvironment.sleep}) fast-forwards timers. Default `false` (a real
     * dev server, real time). Time skipping downloads a separate test-server binary.
     */
    timeSkipping?: boolean;
    /**
     * Directory to cache the downloaded server binary (CI: cache this directory).
     * Default: the `TEMPORAL_DEV_SERVER_DIR` environment variable, if set.
     */
    downloadDir?: string;
}

export interface CreateAppOptions {
    /** Merged over the defaults (address, a unique task queue, `autoStart` worker). */
    options?: Partial<TemporalOptions>;
    /** Activity classes registered on the worker. */
    activityClasses?: Type<object>[];
    /** Extra Nest providers; activity classes are added for you. */
    providers?: Type<object>[];
}

/**
 * A real Temporal test server wired into Nest. One per test file (`beforeAll`), `teardown()` in
 * `afterAll`. Works with Jest, Vitest or Mocha.
 *
 * With `timeSkipping: true` the Nest app's `TEMPORAL_CLIENT` is the environment's own client, so
 * `TemporalService` calls skip time too: a workflow that sleeps for a day returns at once.
 *
 * @example
 * ```typescript
 * const testEnv = await TemporalTestEnvironment.create({ timeSkipping: true });
 * const { app, taskQueue } = await testEnv.createApp({
 *   options: { worker: { workflowsPath: require.resolve('./workflows') } },
 *   activityClasses: [EmailActivities],
 * });
 * const result = await app.get(TemporalService).startWorkflow('reminderWorkflow', [], { taskQueue });
 * await testEnv.teardown();
 * ```
 */
export class TemporalTestEnvironment {
    private readonly apps: INestApplicationContext[] = [];

    private constructor(
        /** The underlying `TestWorkflowEnvironment`, for anything not wrapped here. */
        readonly env: TestWorkflowEnvironment,
        readonly timeSkipping: boolean,
    ) {}

    static async create(
        options: TemporalTestEnvironmentOptions = {},
    ): Promise<TemporalTestEnvironment> {
        const { timeSkipping = false, downloadDir = process.env.TEMPORAL_DEV_SERVER_DIR } = options;
        if (downloadDir) fs.mkdirSync(downloadDir, { recursive: true });
        // Loaded lazily so `/testing` still imports for users who only need the fakes.
        let testing: typeof import('@temporalio/testing');
        try {
            testing = await import('@temporalio/testing');
        } catch (cause) {
            throw new TemporalClientError(
                "TemporalTestEnvironment requires the optional peer dependency '@temporalio/testing'. " +
                    'Install it with: npm install --save-dev @temporalio/testing',
                cause,
            );
        }
        const server = downloadDir
            ? { server: { executable: { type: 'cached-download' as const, downloadDir } } }
            : {};
        const env = timeSkipping
            ? await testing.TestWorkflowEnvironment.createTimeSkipping(server)
            : await testing.TestWorkflowEnvironment.createLocal(server);
        return new TemporalTestEnvironment(env, timeSkipping);
    }

    get address(): string {
        return this.env.address;
    }

    /** Client for the test server; time-skipping when `timeSkipping` is on. */
    get client(): TestWorkflowEnvironment['client'] {
        return this.env.client;
    }

    /** Sleep for `ms`: skips ahead with `timeSkipping`, otherwise really waits. */
    sleep(ms: number): Promise<void> {
        return this.env.sleep(ms);
    }

    /** Current time of the test server, in ms since the epoch. */
    currentTimeMs(): Promise<number> {
        return this.env.currentTimeMs();
    }

    /**
     * Module options pointing at this server, with a unique task queue so suites never see each
     * other's tasks. Spread into your own `TemporalModule.register(...)`.
     */
    moduleOptions(overrides: Partial<TemporalOptions> = {}): TemporalOptions {
        return {
            connection: { address: this.env.address, namespace: 'default' },
            taskQueue: `test-${randomUUID()}`,
            ...overrides,
        };
    }

    /** Boot a Nest app (workers started) against this server and track it for `teardown()`. */
    async createApp(
        config: CreateAppOptions = {},
    ): Promise<{ app: INestApplicationContext; taskQueue: string }> {
        const activityClasses = config.activityClasses ?? [];
        const options = this.moduleOptions({
            worker: { autoStart: true, activityClasses },
            ...config.options,
        });
        let builder = Test.createTestingModule({
            imports: [TemporalModule.register(options)],
            providers: [...activityClasses, ...(config.providers ?? [])],
        });
        if (this.timeSkipping) {
            builder = builder.overrideProvider(TEMPORAL_CLIENT).useValue(this.env.client);
        }
        const app = await (await builder.compile()).init();
        this.apps.push(app);
        return { app, taskQueue: options.taskQueue as string };
    }

    /** Close every app created with {@link createApp}, then stop the server. */
    async teardown(): Promise<void> {
        await Promise.all(this.apps.splice(0).map((app) => app.close()));
        await this.env.teardown();
    }
}
