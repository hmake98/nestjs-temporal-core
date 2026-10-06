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

## Retryable vs non-retryable activity errors

By default Temporal retries any error an activity throws until the retry policy is exhausted. A validation failure or a 404 will never succeed on retry, so retrying only delays the failure. Turn on `errorMapping` to stop that:

```typescript
TemporalModule.register({
  connection: { address: 'localhost:7233' },
  taskQueue: 'orders',
  errorMapping: true,
});
```

It is **off by default**; with it off, activity handlers reach the SDK untouched. When on, errors thrown by activities are mapped in this order:

1. A Temporal failure (`ApplicationFailure`, `CancelledFailure`, ...) is left exactly as thrown. You already chose its retry behavior.
2. `@NonRetryable()` on the method or class (below).
3. Your `mapper`, if you set one.
4. The default map: a Nest `HttpException` with a 4xx status is non-retryable, **except 408 and 429**, which are worth retrying. 5xx and every other error stay retryable.

A non-retryable error becomes an `ApplicationFailure` with `nonRetryable: true`, the original error as `cause`, the original stack, and `type` set to the error's `name`.

### `@NonRetryable()`

```typescript
import { Activity, ActivityMethod, NonRetryable } from 'nestjs-temporal-core';

@Activity()
export class PaymentActivities {
  @ActivityMethod()
  @NonRetryable([CardDeclinedError])   // only these errors are final
  async charge(order: Order) { /* ... */ }

  @ActivityMethod()
  @NonRetryable({ type: 'ValidationFailed' })   // any error is final
  async validate(order: Order) { /* ... */ }
}
```

Put it on the class to cover every method. It does nothing unless `errorMapping` is on.

### Custom mapping

```typescript
errorMapping: {
  mapper: (error, { activityName }) =>
    error instanceof AxiosError && error.response?.status === 404
      ? ApplicationFailure.nonRetryable('not found', 'NotFound')
      : undefined, // undefined = let the default map decide
  nonRetryableStatuses: [400, 401, 403, 404, 422], // replaces the default 4xx set
  defaultMap: true,
}
```

Set `defaultMap: false` to use only `@NonRetryable()` and your `mapper`.

