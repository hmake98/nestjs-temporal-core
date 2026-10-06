/**
 * A real Nest worker app, compiled to JS and booted from the compiled output the way it runs in
 * production. The workflows path has no extension and points next to this file, so it resolves to
 * `workflows.js` here and to `workflows.ts` under ts-node.
 */
import 'reflect-metadata';
import { Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as path from 'path';
import { Activity, ActivityMethod, TemporalModule } from '../../../src';

@Activity()
@Injectable()
export class ShoutActivities {
    @ActivityMethod()
    async shout(text: string): Promise<string> {
        return text.toUpperCase();
    }
}

@Module({
    imports: [
        TemporalModule.register({
            connection: { address: process.env.E2E_TEMPORAL_ADDRESS as string },
            taskQueue: process.env.E2E_TASK_QUEUE as string,
            worker: {
                workflowsPath: path.join(__dirname, 'workflows'),
                autoBundle: { cacheDir: process.env.E2E_CACHE_DIR as string },
                activityClasses: [ShoutActivities],
                autoStart: true,
            },
        }),
    ],
    providers: [ShoutActivities],
})
class AppModule {}

async function main(): Promise<void> {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'log'] });
    app.enableShutdownHooks();
    // Parent waits for this line before starting workflows.
    console.log('E2E_READY');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
