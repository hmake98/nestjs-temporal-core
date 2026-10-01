---
id: observability
title: Production Observability
---

Logs, correlation ids, traces and metrics for a Temporal app built on this library. Everything here is opt-in; nothing changes unless you enable it.

## Logs

### Send SDK logs to the Nest logger

The Temporal SDK has one process-wide `Runtime`. By default it prints to stderr, outside your Nest logger. Use the `runtime` option to route SDK and native Core logs through Nest:

```typescript
TemporalModule.register({
  runtime: { logger: 'nest' },
  connection: { address: 'localhost:7233' },
  taskQueue: 'orders',
});
```

- The runtime is installed **once, before the first client or worker is created**. Later calls are no-ops.
- If something else already created the SDK runtime (for example you opened a `Connection` yourself earlier), the option cannot apply. The library logs a warning and keeps the existing runtime.
- Pass your own SDK `Logger` instead of `'nest'` to use another logging backend. `runtime.telemetry` takes the SDK's `TelemetryOptions` (log filters, metrics).

### Redaction

Structured data the library logs passes through `redact()`: credentials (`apiKey`, `authorization`, `password`, `token`, ...), TLS material and workflow/activity payload bodies are replaced with `[REDACTED]`. Matching ignores case, `-` and `_`, nested objects and arrays are covered, cycles are handled and the input is never mutated.

Add your own keys:

```typescript
TemporalModule.register({ redactKeys: ['ssn', 'cardNumber'] /* ... */ });
```

Use it in your own code too:

```typescript
import { redact } from 'nestjs-temporal-core';
logger.log(redact({ user, apiKey })); // apiKey: '[REDACTED]'
```

## Correlation ids

One id that follows a request from your HTTP handler through the workflow into every activity:

```typescript
TemporalModule.register({ correlation: true /* ... */ });
```

- The client stamps every workflow call (`start`, `signal`, `signalWithStart`, `query`, updates) with the id from the current async context, or generates a UUID if there is none.
- The workflow forwards it to its activities, child workflows, signals and `continueAsNew`.
- Activities run inside that id; library log lines are tagged `[correlationId=...]`.

Set the id for a request, for example in middleware:

```typescript
import { runWithCorrelationId, getCorrelationId } from 'nestjs-temporal-core';

app.use((req, res, next) =>
  runWithCorrelationId(String(req.headers['x-request-id'] ?? randomUUID()), next),
);

// anywhere in the request, or inside an activity:
getCorrelationId(); // 'abc-123'
```

Concurrent requests never share an id (it is stored with `AsyncLocalStorage`).

Notes:

- The id travels in the `x-correlation-id` header. Workflow code itself cannot read it (the sandbox has no `AsyncLocalStorage`); it is only forwarded.
- With a prebuilt `workflowBundle`, the SDK ignores `workflowModules`. Add `nestjs-temporal-core/dist/observability/workflow-interceptors` to your bundle's interceptor modules yourself.

## Traces (OpenTelemetry)

`nestjs-temporal-core/otel` connects Temporal to your OpenTelemetry setup so one request produces one trace across HTTP, client, workflow and activity. It is a separate entry point; the main package never loads OpenTelemetry.

```bash
npm install @temporalio/interceptors-opentelemetry @opentelemetry/api @opentelemetry/resources @opentelemetry/sdk-trace-base
```

Use OpenTelemetry 1.x packages (`@temporalio/interceptors-opentelemetry` depends on them).

```typescript
import { createTemporalOpenTelemetry } from 'nestjs-temporal-core/otel';

// Your usual OpenTelemetry SDK setup: tracer provider, exporter, context manager.
const otel = createTemporalOpenTelemetry({ resource, spanProcessor });

TemporalModule.register({
  connection: { address, interceptors: otel.client },
  taskQueue: 'orders',
  worker: {
    workflowsPath: require.resolve('./workflows'),
    activityClasses: [OrderActivities],
    workerOptions: { ...otel.worker }, // activity interceptors, workflow module, span sink
  },
});
```

`otel.worker` bundles the activity interceptors, the workflow-side interceptors module (`otel.workflowInterceptorsModule` is its path) and the sink that exports spans created inside workflows. Your tracer provider must be registered with a context manager and the W3C propagator (`provider.register({ contextManager: new AsyncLocalStorageContextManager().enable() })`), otherwise the trace id will not cross the client-to-worker hop.

You can combine `otel` with `correlation: true`; the library merges its interceptors with yours.

## Metrics

SDK Core metrics (task latencies, poll counts, cache) on a Prometheus scrape endpoint:

```typescript
import { prometheusTelemetry } from 'nestjs-temporal-core/otel';

TemporalModule.register({
  runtime: { logger: 'nest', telemetry: prometheusTelemetry('0.0.0.0:9464') },
});
```

For OTLP or custom metric exporters, pass the SDK's own `telemetry.metrics` options through `runtime.telemetry`.
