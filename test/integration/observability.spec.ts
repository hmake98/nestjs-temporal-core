import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { Resource } from '@opentelemetry/resources';
import {
    BasicTracerProvider,
    InMemorySpanExporter,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { runWithCorrelationId, TemporalService } from '../../src';
import { createTemporalOpenTelemetry } from '../../src/otel';
import { CorrelationActivities } from './fixtures/correlation.activities';
import { GreetingActivities } from './fixtures/greeting.activities';
import { createTestEnv, IntegrationEnv, WORKFLOWS_PATH } from './helpers/test-env';

const result = <T>(started: { result?: unknown }) =>
    (started.result as unknown as { result(): Promise<T> }).result();

describe('integration: correlation ids', () => {
    let ctx: IntegrationEnv;
    let temporal: TemporalService;

    beforeAll(async () => {
        ctx = await createTestEnv({
            activityClasses: [CorrelationActivities],
            options: { correlation: true },
        });
        temporal = ctx.app.get(TemporalService);
    });

    afterAll(async () => {
        await ctx.teardown();
    });

    const start = () =>
        temporal.startWorkflow('correlationWorkflow', [], {
            taskQueue: ctx.taskQueue,
            workflowId: `corr-${Date.now()}-${Math.random()}`,
        });

    it('carries the caller id from client through workflow to the activity', async () => {
        const started = await runWithCorrelationId('req-42', start);

        await expect(result(started)).resolves.toBe('req-42');
    });

    it('generates an id when the caller has none', async () => {
        const id = await result<string>(await start());

        expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('does not mix ids between concurrent requests', async () => {
        const ids = ['a', 'b', 'c', 'd', 'e'];

        const seen = await Promise.all(
            ids.map(async (id) => result(await runWithCorrelationId(id, start))),
        );

        expect(seen).toEqual(ids);
    });
});

describe('integration: OpenTelemetry trace across client, workflow and activity', () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
        resource: new Resource({ 'service.name': 'integration-test' }),
    });
    let ctx: IntegrationEnv;

    beforeAll(async () => {
        provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
        // Registers the tracer provider, the W3C propagator and the context manager globally.
        provider.register({ contextManager: new AsyncLocalStorageContextManager().enable() });

        const otel = createTemporalOpenTelemetry({
            resource: provider.resource,
            spanProcessor: new SimpleSpanProcessor(exporter),
        });
        ctx = await createTestEnv({
            options: ({ address, taskQueue }) => ({
                connection: { address, namespace: 'default', interceptors: otel.client },
                taskQueue,
                worker: {
                    workflowsPath: WORKFLOWS_PATH,
                    activityClasses: [GreetingActivities],
                    autoStart: true,
                    workerOptions: { ...otel.worker },
                },
            }),
            activityClasses: [GreetingActivities],
        });
    });

    afterAll(async () => {
        await ctx.teardown();
        await provider.shutdown();
        context.disable();
        trace.disable();
        propagation.disable();
    });

    it('produces one trace id for the request, client, workflow and activity spans', async () => {
        const temporal = ctx.app.get(TemporalService);
        const tracer = trace.getTracer('test');

        let requestTraceId = '';
        await tracer.startActiveSpan('http-request', async (span) => {
            requestTraceId = span.spanContext().traceId;
            const started = await temporal.startWorkflow('greetingWorkflow', ['otel'], {
                taskQueue: ctx.taskQueue,
                workflowId: `otel-${Date.now()}`,
            });
            await result(started);
            span.end();
        });

        const wanted = ['StartWorkflow', 'RunWorkflow', 'StartActivity', 'RunActivity'];
        const deadline = Date.now() + 10000;
        const names = () => exporter.getFinishedSpans().map((s) => s.name);
        while (
            !wanted.every((prefix) => names().some((n) => n.startsWith(prefix))) &&
            Date.now() < deadline
        ) {
            await new Promise((r) => setTimeout(r, 100));
        }

        const spans = exporter.getFinishedSpans();
        for (const prefix of wanted) {
            const span = spans.find((s) => s.name.startsWith(prefix));
            expect(span?.spanContext().traceId).toBe(requestTraceId);
        }
    });
});
