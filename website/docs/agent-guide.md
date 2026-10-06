---
id: agent-guide
title: Guide for AI Coding Agents
---

Conventions for LLM coding agents (and humans in a hurry) adding Temporal code to a NestJS app with `nestjs-temporal-core`. The machine-readable index is [`llms.txt`](pathname:///nestjs-temporal-core/llms.txt), also shipped inside the package at `node_modules/nestjs-temporal-core/llms.txt`.

## The one rule

**Workflows are plain exported functions that run in a deterministic v8 sandbox. Activities are Nest providers that do all I/O.** Almost every mistake is crossing that line.

| Need | Use | Where it runs |
| --- | --- | --- |
| Orchestration, waiting, branching | Workflow function | Sandbox: deterministic, no DI |
| HTTP, DB, files, randomness, clock, anything non-deterministic | Activity (`@Activity` + `@ActivityMethod`) | Normal Node, full Nest DI |
| Push an event into a running workflow | Signal | Handler declared in the workflow |
| Read workflow state | Query | Read-only, must not mutate |
| Change state and return a result | Update | Validated, returns a value |
| Run another workflow from a workflow | Child workflow | In the workflow |
| Run something on a schedule | `TemporalService.upsertSchedule()` | Client side |

## File layout

```
src/orders/
  orders.module.ts          imports TemporalModule (once, in AppModule) and provides the activities
  orders.activities.ts      @Injectable() @Activity() class: all I/O
  orders.workflows.ts       exported async functions, imports ONLY @temporalio/workflow (+ types)
  orders.service.ts         starts/signals/queries workflows through TemporalService
```

## Exact patterns

**Module (once):**

```typescript
TemporalModule.register({
  connection: { address: process.env.TEMPORAL_ADDRESS! },
  taskQueue: 'orders',
  worker: {
    workflowsPath: path.join(__dirname, 'orders/orders.workflows'), // works from src/ and dist/
    activityClasses: [OrdersActivities],                           // also add to providers: []
    autoBundle: true,                                              // cached bundling, see Bundling
  },
});
```

**Activity:**

```typescript
@Injectable()
@Activity()
export class OrdersActivities {
  constructor(private readonly payments: PaymentsService) {}

  @ActivityMethod('chargeCard')            // the name the workflow calls
  async chargeCard(orderId: string, cents: number): Promise<string> {
    return this.payments.charge(orderId, cents);
  }
}
```

**Workflow (note: type-only import of the activity class):**

```typescript
import { proxyActivities, defineSignal, defineQuery, setHandler, condition } from '@temporalio/workflow';
import type { OrdersActivities } from './orders.activities';

const { chargeCard } = proxyActivities<OrdersActivities>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 3 },
});

export const cancelSignal = defineSignal('cancel');
export const statusQuery = defineQuery<string>('status');

export async function orderWorkflow(orderId: string, cents: number): Promise<string> {
  let status = 'pending';
  let cancelled = false;
  setHandler(cancelSignal, () => { cancelled = true; });
  setHandler(statusQuery, () => status);

  if (cancelled) return 'cancelled';
  const receipt = await chargeCard(orderId, cents);
  status = 'paid';
  return receipt;
}
```

**Start, signal, query from a service:**

```typescript
const started = await this.temporal.startWorkflow<{ workflowId: string }>('orderWorkflow', [id, cents], {
  taskQueue: 'orders',
  workflowId: `order-${id}`,          // use a business key so retries do not double-start
});
await this.temporal.signalWorkflow(`order-${id}`, 'cancel');
const status = await this.temporal.queryWorkflow<string>(`order-${id}`, 'status');
```

`startWorkflow`, `signalWorkflow`, `queryWorkflow`, `cancelWorkflow` and `terminateWorkflow` live on `TemporalService`. Failures throw `TemporalClientError` with the SDK error as `.cause`.

**Test with no server:**

```typescript
const moduleRef = await Test.createTestingModule({
  imports: [TemporalTestingModule.register()],
  providers: [OrdersService],
}).compile();
await moduleRef.get(OrdersService).place({ id: 'o1' });
expect(moduleRef.get(TemporalTestingRecorder).callsTo('startWorkflow')).toHaveLength(1);
```

Activities: `createActivityHarness(OrdersActivities, { providers })`. Real workflows with skipped timers: `TemporalTestEnvironment.create({ timeSkipping: true })`. Workflow edits: `assertReplays(...)`. See [Testing](./testing).

## Common errors and fixes

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Activity not found` / `Activity function X is not registered` | Activity class missing from `activityClasses`, or not in a module's `providers`, or `@ActivityMethod` name differs from the workflow's call | Do all three: `@Activity()` class, `activityClasses: [...]`, `providers: [...]`; match names |
| `Cannot find module` / webpack error at worker start | Wrong `workflowsPath`, or running from `dist/` with a `src/` path | Use `path.join(__dirname, '...')` with no extension; `.ts`/`.js` are swapped for you |
| Worker starts but workflow never runs | `taskQueue` differs between worker and the `startWorkflow` call | Use the same string; check `worker.taskQueue` in logs |
| `Nondeterminism error` / `DeterminismViolationError` | Workflow code changed under running executions, or uses `Date.now()`, `Math.random()`, `setTimeout`, I/O | Move non-determinism to an activity; use `patched()` for edits; verify with `assertReplays` |
| `Importing ... from @nestjs/common in workflow` sandbox errors | A workflow file imports `nestjs-temporal-core`, a service, or an activity value | Workflows import only `@temporalio/workflow`; use `import type` for activities |
| Activity retries forever on a bad request | Every error is retryable by default | `errorMapping: true` and `@NonRetryable()`; see [Error handling](./error-handling) |
| `WorkflowExecutionAlreadyStartedError` | Same `workflowId` started twice | Intended: catch it, or set an id conflict policy |
| Shutdown hangs or drops tasks | Missing `app.enableShutdownHooks()` | Call it in `main.ts` |
| `Must use import to load ES Module` in Jest | NestJS 12 is ESM-only | Node 24.9+ with `--experimental-vm-modules`, or NestJS 11. See [Troubleshooting](./troubleshooting) |
| Worker-only process exits immediately | No HTTP server keeps it alive | `NestFactory.createApplicationContext` and keep the process running; see [Worker-only apps](./worker-only-apps) |

## Do not

- Do not import Nest, `nestjs-temporal-core` values, or application services into workflow files.
- Do not call `Date.now()`, `Math.random()`, `fetch`, timers or `process.env` in a workflow. Use `sleep()`, `uuid4()` from `@temporalio/workflow`, and activities.
- Do not share one connection between client and worker (the library already creates separate ones).
- Do not add an `exports` map to a fork of this package: it breaks deep imports.
- Do not inline timeout or retry numbers if a `TIMEOUTS` / `RETRY_POLICIES` preset fits.

## Optional features, one line each

| Want | Option / entry |
| --- | --- |
| Fast production bundling | `worker.autoBundle` ([Bundling](./bundling)) |
| Stop retrying bad requests | `errorMapping` + `@NonRetryable()` |
| Trace across HTTP, workflow, activity | `correlation`, `nestjs-temporal-core/otel` ([Observability](./observability)) |
| Encrypt payloads | `nestjs-temporal-core/encryption` ([Security](./security)) |
| Health endpoint | `TemporalHealthModule`, `nestjs-temporal-core/terminus` |
| Unit and workflow tests | `nestjs-temporal-core/testing` ([Testing](./testing)) |
