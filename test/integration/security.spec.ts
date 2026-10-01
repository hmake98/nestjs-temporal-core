import { randomBytes } from 'crypto';
import {
    createEncryptionDataConverter,
    createStaticKeyProvider,
    ENCRYPTED_ENCODING,
} from '../../src/encryption';
import { TemporalService } from '../../src';
import { GreetingActivities } from './fixtures/greeting.activities';
import { createTestEnv, IntegrationEnv } from './helpers/test-env';

describe('integration: payload encryption through the module-level dataConverter', () => {
    let ctx: IntegrationEnv;

    beforeAll(async () => {
        const keys = createStaticKeyProvider({
            currentKeyId: 'v1',
            keys: { v1: randomBytes(32) },
        });
        ctx = await createTestEnv({
            activityClasses: [GreetingActivities],
            options: { dataConverter: createEncryptionDataConverter(keys) },
        });
    });

    afterAll(async () => {
        await ctx.teardown();
    });

    it('runs a workflow end to end and stores only ciphertext on the server', async () => {
        const temporal = ctx.app.get(TemporalService);
        const workflowId = `enc-${Date.now()}`;

        const started = await temporal.startWorkflow<{ result(): Promise<string> }>(
            'greetingWorkflow',
            ['Top Secret Name'],
            { taskQueue: ctx.taskQueue, workflowId },
        );
        await expect(started.result?.result()).resolves.toBe('Hello, Top Secret Name!');

        // A client without the codec sees what the server sees.
        const history = await ctx.env.client.workflow.getHandle(workflowId).fetchHistory();
        const payloads = (history.events ?? []).flatMap((event) => {
            const attrs =
                event.workflowExecutionStartedEventAttributes ??
                event.activityTaskScheduledEventAttributes ??
                event.activityTaskCompletedEventAttributes ??
                event.workflowExecutionCompletedEventAttributes;
            const holder =
                (attrs as any)?.input ?? (attrs as any)?.result ?? (attrs as any)?.payloads;
            return holder?.payloads ?? [];
        });

        expect(payloads.length).toBeGreaterThanOrEqual(4);
        for (const payload of payloads) {
            expect(Buffer.from(payload.metadata.encoding).toString()).toBe(ENCRYPTED_ENCODING);
            expect(Buffer.from(payload.data).toString()).not.toContain('Top Secret Name');
        }
    });
});
