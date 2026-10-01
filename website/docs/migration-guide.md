---
id: migration-guide
title: Migration Guide
---

## Migrating to v3.0.12+ (Multiple Workers Support)

Version 3.0.12 introduces support for multiple workers without breaking existing single-worker configurations.

### No Changes Required for Single Worker

Your existing configuration continues to work:

```typescript
// ✅ This still works exactly as before
TemporalModule.register({
  connection: { address: 'localhost:7233' },
  taskQueue: 'my-queue',
  worker: {
    workflowsPath: require.resolve('./workflows'),
    activityClasses: [MyActivity],
  },
})
```

### Migrating to Multiple Workers

**After (v3.0.12):**
```typescript
// Option 1: Configure multiple workers in module
TemporalModule.register({
  connection: { address: 'localhost:7233' },
  workers: [
    {
      taskQueue: 'main-queue',
      workflowsPath: require.resolve('./workflows/main'),
      activityClasses: [MainActivity],
    },
    {
      taskQueue: 'schedule-queue',
      workflowsPath: require.resolve('./workflows/schedule'),
      activityClasses: [ScheduleActivity],
    },
  ],
})
```

### New APIs in v3.0.12

```typescript
// Get native connection for custom worker creation
const workerManager = temporal.getWorkerManager();
const connection: NativeConnection | null = workerManager.getConnection();

// Get specific worker by task queue
const worker: Worker | null = temporal.getWorker('payments-queue');

// Get all workers information
const workersInfo: MultipleWorkersInfo = temporal.getAllWorkers();
console.log(`${workersInfo.runningWorkers}/${workersInfo.totalWorkers} workers running`);

// Control specific workers
await temporal.startWorkerByTaskQueue('payments-queue');
await temporal.stopWorkerByTaskQueue('notifications-queue');

// Register new worker dynamically
const result = await temporal.registerWorker({
  taskQueue: 'new-queue',
  workflowsPath: require.resolve('./workflows/new'),
  activityClasses: [NewActivity],
  autoStart: true,
});
```

## Migrating to v3.3.0 (Typed Workflow Proxy + Schedule fixes)

This release is **backward-compatible** — existing code continues to compile and run. The headline additions are a typed workflow proxy, `signalWithStart` on both service layers, and correctness fixes for a few schedule fields that were previously silently ignored.

### No changes required

Every type that was previously exported is still exported with the same name. Old field shapes continue to compile:

- `spec.timezones?: string[]` on `ScheduleSpec` (deprecated — prefer SDK `timezone` singular, automatically normalized at runtime)
- `action.retryPolicy?` on schedule actions (deprecated — prefer SDK `retry`, automatically forwarded)
- `searchAttributes?: Record<string, unknown>` on `ScheduleCreationOptions`
- `enableSDKTracing?` / `enableOpenTelemetry?` on `WorkerCreateOptions` (deprecated no-ops — had no effect in prior versions either)

### Runtime behavior fixes

Three schedule fields were previously declared in the API but silently dropped by the SDK because of wrong field names or wrong shapes. They now work as the field name promises:

| Field | Before v3.3.0 | After v3.3.0 |
|---|---|---|
| `spec.timezone` on a schedule | Written to `spec.timeZone` (wrong casing) — SDK ignored it, schedules always ran in UTC | Routed to SDK's `timezone` — schedule honors the zone |
| `description` on `createSchedule()` | Passed as a top-level field SDK ignored | Flows to `state.note` |
| `searchAttributes` on `createSchedule()` | Cast to `typedSearchAttributes` with the wrong shape | Routed to the correct `searchAttributes` SDK field |

**Action**: if you had set `timezone` on a `@Scheduled` or `createSchedule()` call and configured your schedule times assuming UTC (because the timezone was being ignored), double-check your schedule timing after upgrade — the timezone will now actually apply.

`limitedActions` on `createSchedule()` remains a no-op for backward compatibility; set `state.remainingActions` directly via the SDK if you need that behavior.

### New APIs in v3.3.0

```typescript
import {
  IWorkflowProxy,
  WorkflowProxyFactory,
  createWorkflowToken,
  createWorkflowProvider,
} from 'nestjs-temporal-core';

// Typed proxy — see "Core Concepts" for the full pattern
const ORDER_WORKFLOW = createWorkflowToken('orderWorkflow');
const provider = createWorkflowProvider<typeof orderWorkflow>(ORDER_WORKFLOW, {
  workflowType: 'orderWorkflow',
  taskQueue: 'orders',
});

// Atomic start + signal — see "Core Concepts" > Signal-with-Start
await temporal.signalWithStart(
  'cartWorkflow',
  'addItem',
  [{ sku: 'SKU-123', qty: 2 }],
  [userId],
  { workflowId: `cart-${userId}`, taskQueue: 'carts' },
);
```

## Upgrading to NestJS 12

`@nestjs/common`, `@nestjs/core` and `@nestjs/testing` now accept `^12.0.0`, and `@nestjs/terminus` accepts `^11.0.0 || ^12.0.0`. No code change is needed in your app for the core module.

- **Node.js**: NestJS 12 is ESM-only. This package is CommonJS, so it loads NestJS through `require(esm)`, which needs Node 20.19+ or 22.12+.
- **Jest**: Jest 30 can load NestJS 12 only on Node 24.9+ with `NODE_OPTIONS=--experimental-vm-modules`. See [Testing with NestJS 12](./testing.md#testing-with-nestjs-12).
- **Terminus**: `@nestjs/terminus` 12 removed `HealthIndicator` and `HealthCheckError`. `TemporalHealthIndicator` from `nestjs-temporal-core/terminus` now returns a `down` result instead of throwing, and Terminus responds with 503 as before. If you called `isHealthy()` yourself and caught `HealthCheckError`, check `result.temporal.status === 'down'` instead. Support for `@nestjs/terminus` 10 was dropped, because the indicator now uses `HealthIndicatorService` (added in 11).

## Migrating to the `@temporalio/*` 1.19 upgrade (Workflow Updates, Standalone Activities, Schedule lifecycle)

This release bumps the peer dependency range to `@temporalio/*` `^1.15.0 || ^1.19.0` and adds four feature areas: Workflow Update support, Async Activity Completion, Standalone Activities, and full schedule lifecycle management. See [Advanced Configuration](./advanced-configuration.md) for usage of all new APIs.

### Breaking change: Node.js version

Temporal SDK 1.19 requires **Node.js >= 20.3.0**. `engines.node` has been updated from `>=16.0.0` accordingly. If you're on Node 16 or 18, either upgrade Node or pin `@temporalio/*` to `^1.15.0` in your own `package.json` (this package's peer range still allows it) and stay on this package's previous minor version.

### No changes required

- Worker Versioning / Worker Deployments (`workerOptions.workerDeploymentOptions`) and worker-side interceptors (`workerOptions.interceptors`) already passed through wholesale to `Worker.create()` — they work automatically now that the SDK types include them.
- gRPC gzip compression is enabled by default on the worker's native connection as of SDK 1.19. If your server can't decompress it, set `connection.grpcCompression = { codec: 'none' }`.

### New APIs

```typescript
import { UpdateMethod } from 'nestjs-temporal-core';

// Workflow Update handler (mirrors @SignalMethod/@QueryMethod)
@UpdateMethod('deposit')
async handleDeposit(amount: number): Promise<number> { /* ... */ }

// Client-side Update calls
await clientService.updateWorkflow<number>('account-123', 'deposit', [100]);
await clientService.startUpdateWorkflow<number>('account-123', 'deposit', [100]);

// Async Activity Completion
await clientService.completeActivity(taskToken, result);
await clientService.failActivity(taskToken, error);

// Standalone Activities (Public Preview)
await clientService.executeStandaloneActivity('sendEmail', { id: 'e-1', taskQueue: 'q' });

// Schedule lifecycle
await scheduleService.pauseSchedule('daily-report');
await scheduleService.triggerSchedule('daily-report');
await scheduleService.deleteSchedule('daily-report');
```
