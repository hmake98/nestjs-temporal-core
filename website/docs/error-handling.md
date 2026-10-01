---
id: error-handling
title: Error Handling
---

## Original errors are preserved as `cause`

When a client, schedule or facade call fails, the library throws (or returns) an error whose **message text is unchanged** and whose `cause` is the original error from the Temporal SDK. Nothing is lost: the gRPC status, details and stack of the underlying failure are still reachable.

```typescript
import { TemporalClientError } from 'nestjs-temporal-core';

try {
  await temporalClient.signalWorkflow('order-1', 'cancel');
} catch (error) {
  if (error instanceof TemporalClientError) {
    console.error(error.message);     // Failed to send signal 'cancel' to workflow order-1: ...
    console.error(error.cause);       // the original SDK error
    console.error(error.originalName);// e.g. 'ServiceError'
    console.error(error.grpcCode);    // e.g. 14 (UNAVAILABLE), when present
    console.error(error.grpcDetails); // gRPC details string, when present
  }
}
```

`TemporalClientError` extends `Error`, so existing `instanceof Error` checks and `catch` blocks keep working.

## Where each style applies

| API | On failure |
| --- | --- |
| `TemporalClientService` methods (`signalWorkflow`, `queryWorkflow`, ...) | Throws `TemporalClientError` with `cause`. |
| `TemporalService.startWorkflow`, `signalWorkflow`, `queryWorkflow` | Throws; the error is the original `Error` or a `TemporalClientError` when a non-`Error` value was thrown. |
| `TemporalService` / `TemporalScheduleService` methods returning `{ success, error }` | Same envelope shape as before. `error` is the original `Error`, or a `TemporalClientError` (with `cause`) when a non-`Error` value was thrown. |

## Errors that are never wrapped

`WorkflowExecutionAlreadyStartedError` is rethrown as-is by `startWorkflow`, so you can still catch it by type to implement idempotent starts:

```typescript
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

try {
  await temporalClient.startWorkflow('processOrder', [order], { workflowId: order.id });
} catch (error) {
  if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
}
```

## Unwrapping

To inspect the root SDK error regardless of nesting:

```typescript
function rootCause(error: unknown): unknown {
  let current = error;
  while (current instanceof Error && (current as { cause?: unknown }).cause) {
    current = (current as { cause?: unknown }).cause;
  }
  return current;
}
```

## Schedules

Schedule create/upsert/update/delete are also exposed on `TemporalService`:

```typescript
await temporalService.upsertSchedule({
  scheduleId: 'daily-report',
  spec: { cronExpressions: ['0 9 * * *'] },
  action: { type: 'startWorkflow', workflowType: 'sendDailyReport', taskQueue: 'reports' },
}); // safe to call on every app start: creates, or updates in place

await temporalService.updateSchedule('daily-report', (previous) => ({
  ...previous,
  spec: { ...previous.spec, cronExpressions: ['0 10 * * *'] },
}));

await temporalService.deleteSchedule('daily-report');
```

All three return `{ success, scheduleId, error? }`; check `success` and read `error` (and `error.cause`) on failure.
