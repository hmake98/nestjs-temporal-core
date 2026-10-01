/**
 * OpenTelemetry wiring for nestjs-temporal-core. Import from `nestjs-temporal-core/otel`;
 * the main entry never loads it. Requires the optional peers
 * `@temporalio/interceptors-opentelemetry`, `@opentelemetry/api`,
 * `@opentelemetry/sdk-trace-base` and `@opentelemetry/resources`.
 */
import type { Resource } from '@opentelemetry/resources';
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { ClientInterceptors } from '@temporalio/client';
import {
    makeWorkflowExporter,
    OpenTelemetryActivityInboundInterceptor,
    OpenTelemetryActivityOutboundInterceptor,
    OpenTelemetryWorkflowClientInterceptor,
} from '@temporalio/interceptors-opentelemetry';
import type { TelemetryOptions, WorkerOptions } from '@temporalio/worker';

export interface TemporalOpenTelemetryOptions {
    /** Resource attributes (service name, ...) attached to workflow spans. */
    resource: Resource;
    /** Receives spans created inside workflows; usually your OTLP batch processor. */
    spanProcessor: SpanProcessor;
}

export interface TemporalOpenTelemetry {
    /** Pass as `connection.interceptors`. */
    client: ClientInterceptors;
    /** Spread into `worker.workerOptions` (or a `workers[]` entry's `workerOptions`). */
    worker: Pick<WorkerOptions, 'interceptors' | 'sinks'>;
    /** Absolute path of the workflow-side interceptors module the worker bundles. */
    workflowInterceptorsModule: string;
}

/**
 * Build the client, activity and workflow interceptors plus the workflow span sink needed
 * for one distributed trace across HTTP, client, workflow and activity.
 *
 * Register your own OpenTelemetry SDK (tracer provider and an async-context manager) as
 * usual; this only connects Temporal to it.
 *
 * @example
 * ```typescript
 * const otel = createTemporalOpenTelemetry({ resource, spanProcessor });
 * TemporalModule.register({
 *   connection: { address, interceptors: otel.client },
 *   taskQueue: 'orders',
 *   worker: { workflowsPath, activityClasses, workerOptions: { ...otel.worker } },
 * });
 * ```
 */
export function createTemporalOpenTelemetry(
    options: TemporalOpenTelemetryOptions,
): TemporalOpenTelemetry {
    const workflowInterceptorsModule =
        require.resolve('@temporalio/interceptors-opentelemetry/lib/workflow-interceptors');

    return {
        client: { workflow: [new OpenTelemetryWorkflowClientInterceptor()] },
        worker: {
            interceptors: {
                activity: [
                    (ctx) => ({
                        inbound: new OpenTelemetryActivityInboundInterceptor(ctx),
                        outbound: new OpenTelemetryActivityOutboundInterceptor(ctx),
                    }),
                ],
                workflowModules: [workflowInterceptorsModule],
            },
            sinks: {
                exporter: makeWorkflowExporter(options.spanProcessor, options.resource),
            },
        },
        workflowInterceptorsModule,
    };
}

/**
 * Core SDK metrics on a Prometheus scrape endpoint. Use as `runtime.telemetry`.
 *
 * @example
 * ```typescript
 * TemporalModule.register({ runtime: { telemetry: prometheusTelemetry('0.0.0.0:9464') } });
 * ```
 */
export function prometheusTelemetry(bindAddress: string): TelemetryOptions {
    return { metrics: { prometheus: { bindAddress } } };
}
