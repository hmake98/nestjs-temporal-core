---
id: advanced-configuration
title: Advanced Configuration
---

This section documents capabilities added in the Temporal SDK 1.16–1.19 line. Some require no code changes on your part — they pass straight through existing configuration options — others are new client methods.

## Client & Worker Interceptors

Worker-side interceptors already work today via `workerOptions.interceptors` — it's spread wholesale into `Worker.create()`, so any interceptor accepted by `@temporalio/worker` just works:

```typescript
TemporalModule.register({
  connection: { address: 'localhost:7233' },
  worker: {
    workflowsPath: './dist/workflows',
    workerOptions: {
      interceptors: {
        activityInbound: [(ctx) => new MyActivityInterceptor(ctx)],
      },
    },
  },
});
```

Client-side interceptors (for the workflow/activity/schedule clients) are threaded via `connection.interceptors`:

```typescript
TemporalModule.register({
  connection: {
    address: 'localhost:7233',
    interceptors: {
      workflow: [myWorkflowClientInterceptor],
    },
  },
});
```

## gRPC Compression

Temporal SDK 1.19 enables gRPC gzip compression by default **for the worker's native connection**. If your server can't decompress it, opt out with `{ codec: 'none' }`:

```typescript
TemporalModule.register({
  connection: {
    address: 'localhost:7233',
    grpcCompression: { codec: 'none' },
  },
});
```

This only affects the worker's `NativeConnection` — the plain gRPC client connection (used for starting/signaling/querying workflows) does not compress by default and has no matching toggle.

## Worker Versioning

Worker Deployments / Worker Versioning (GA in SDK 1.16+) also passes straight through `workerOptions`:

```typescript
worker: {
  workflowsPath: './dist/workflows',
  workerOptions: {
    workerDeploymentOptions: {
      version: { buildId: 'v1.2.0', deploymentName: 'my-service' },
      useWorkerVersioning: true,
    },
  },
},
```

## Async Activity Completion

For Activities that complete outside their handler (e.g. a human-in-the-loop approval, or a callback from another process), use the task-token-based completion methods on `TemporalClientService` (`temporalService.client`):

```typescript
await this.clientService.heartbeatActivity(taskToken, { progress: 50 });
await this.clientService.completeActivity(taskToken, { approved: true });
// or, on failure:
await this.clientService.failActivity(taskToken, new Error('rejected by approver'));
```

## Standalone Activities

> **Public Preview** — this is a Temporal server feature still in Public Preview; the underlying API may change in future SDK releases.

Standalone Activities run a durable, retryable Activity directly from the client — no workflow required:

```typescript
const result = await this.clientService.executeStandaloneActivity('sendEmail', {
  id: 'email-123',
  taskQueue: 'emails',
  args: ['user@example.com'],
  startToCloseTimeout: '1m',
});

// Or start it and await the result later
const handle = await this.clientService.startStandaloneActivity('sendEmail', {
  id: 'email-124',
  taskQueue: 'emails',
  startToCloseTimeout: '1m',
});
const outcome = await handle.result();

// Query executions
const info = await this.clientService.countStandaloneActivities('ActivityType="sendEmail"');
```

## Schedule Lifecycle Management

`TemporalScheduleService` (reachable as `temporalService.schedule`) covers the full schedule lifecycle, not just create/get. Its methods return result envelopes (`{ success, scheduleId, error? }`) rather than throwing:

```typescript
await this.scheduleService.pauseSchedule('daily-report', 'investigating an incident');
await this.scheduleService.unpauseSchedule('daily-report');
await this.scheduleService.triggerSchedule('daily-report', 'ALLOW_ALL');
await this.scheduleService.deleteSchedule('daily-report');

await this.scheduleService.updateSchedule('daily-report', (previous) => ({
  ...previous,
  spec: { ...previous.spec, cronExpressions: ['0 9 * * *'] },
}));

const { description } = await this.scheduleService.describeSchedule('daily-report');

const { schedules } = this.scheduleService.listSchedules();
for await (const schedule of schedules ?? []) {
  console.log(schedule.scheduleId, schedule.state.paused);
}
```

If you register schedules on every application bootstrap, `createSchedule()` returns `{ success: false, error }` (the SDK's `ScheduleAlreadyRunning`) on the second and subsequent runs. Use `upsertSchedule()` instead — it creates the schedule if it doesn't exist yet, or updates it in place (spec, action, policies, state) if it does:

```typescript
const result = await this.scheduleService.upsertSchedule({
  scheduleId: 'daily-report',
  spec: { cronExpressions: ['0 9 * * *'] },
  action: {
    type: 'startWorkflow',
    workflowType: 'sendDailyReport',
    taskQueue: 'reports',
    args: [],
  },
});

console.log(result.action); // 'created' | 'updated'
```

## Explicitly Out of Scope

Evaluated and deliberately not implemented:

- **Nexus** (standalone operations/service clients) — a large, cross-namespace service-mesh feature outside a single-app NestJS wrapper's mission
- The contrib packages (`@temporalio/openai-agents`, `@temporalio/lambda-worker`, `@temporalio/workflow-streams`, `@temporalio/langsmith`)
- `SerializationContext` custom payload conversion — would require a much larger payload-converter extension point this wrapper doesn't expose today

Workflow-code-only concerns (named random streams, continue-as-new backoff interval, `unsafe.random`, workflow-failure-exception-type selection) are consumed directly via `@temporalio/workflow` in your workflow functions and aren't mediated by this package.

Next: [Advanced Usage](./advanced-usage.md).
