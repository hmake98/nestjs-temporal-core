import { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { TemporalModule } from '../../../src';
import { TemporalOptions } from '../../../src/interfaces';

export const WORKFLOWS_PATH = path.resolve(__dirname, '../fixtures/workflows.ts');

export interface IntegrationEnv {
    /** The Temporal dev server the Nest app is connected to. */
    env: TestWorkflowEnvironment;
    /** A booted Nest application context with TemporalModule wired to `env`. */
    app: INestApplicationContext;
    /** Unique per call, so suites sharing one server never see each other's tasks. */
    taskQueue: string;
    teardown(): Promise<void>;
}

/**
 * Start a local Temporal dev server and boot a Nest app against it.
 * Call once per suite (`beforeAll`) and `teardown()` in `afterAll`.
 */
export async function createTestEnv(
    overrides: {
        /**
         * Extra module options, merged over the defaults. A function receives the dev
         * server address and the task queue, for options that depend on them.
         */
        options?:
            | Partial<TemporalOptions>
            | ((ctx: { address: string; taskQueue: string }) => Partial<TemporalOptions>);
        /** Activity classes registered on the worker. */
        activityClasses?: Array<new (...args: never[]) => object>;
        /** Extra Nest providers (the activity classes are added automatically). */
        providers?: Array<new (...args: never[]) => object>;
    } = {},
): Promise<IntegrationEnv> {
    // CI points this at a cached directory so the dev-server binary is downloaded once.
    const downloadDir = process.env.TEMPORAL_DEV_SERVER_DIR;
    if (downloadDir) fs.mkdirSync(downloadDir, { recursive: true });
    const env = await TestWorkflowEnvironment.createLocal(
        downloadDir ? { server: { executable: { type: 'cached-download', downloadDir } } } : {},
    );
    const taskQueue = `it-${randomUUID()}`;
    const activityClasses = overrides.activityClasses ?? [];

    const moduleRef = await Test.createTestingModule({
        imports: [
            TemporalModule.register({
                connection: { address: env.address, namespace: 'default' },
                taskQueue,
                worker: {
                    workflowsPath: WORKFLOWS_PATH,
                    activityClasses,
                    autoStart: true,
                },
                ...(typeof overrides.options === 'function'
                    ? overrides.options({ address: env.address, taskQueue })
                    : overrides.options),
            }),
        ],
        providers: [...activityClasses, ...(overrides.providers ?? [])],
    }).compile();

    // No HTTP adapter needed: init() runs the lifecycle hooks that start the worker.
    const app = await moduleRef.init();

    return {
        env,
        app,
        taskQueue,
        async teardown() {
            await app.close();
            await env.teardown();
        },
    };
}
