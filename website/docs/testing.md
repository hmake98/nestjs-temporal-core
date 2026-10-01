---
id: testing
title: Testing Your Temporal Code
---

`nestjs-temporal-core/testing` ships helpers for unit-testing code that uses this library, without a Temporal server. Nothing in it imports Jest, so it works with Jest, Vitest or Mocha. The main entry point never loads it.

```bash
npm install --save-dev @nestjs/testing @temporalio/testing
```

Both are optional peer dependencies. `TemporalTestingModule` only needs `@nestjs/testing`; `createActivityHarness` also needs `@temporalio/testing`.

## Testing with NestJS 12

NestJS 12 is ESM-only. Jest 30 loads it through `require(esm)`, which works only on Node 24.9+ with the VM modules flag:

```json
{
  "scripts": {
    "test": "node --experimental-vm-modules node_modules/jest/bin/jest.js"
  }
}
```

On Node 20 or 22, Jest cannot load NestJS 12. Either test against NestJS 11 there, or move your tests to Node 24. Vitest handles ESM natively and needs no flag. This repository's own CI follows the same split: NestJS 12 on Node 24, NestJS 11 on Node 20, 22 and 24.

## Test a service that starts a workflow

Import `TemporalTestingModule` instead of `TemporalModule`. Code that injects `TemporalService` or `TemporalClientService` gets a fake that records every call and returns a successful default.

```typescript
import { Test } from '@nestjs/testing';
import { TemporalTestingModule, TemporalTestingRecorder } from 'nestjs-temporal-core/testing';

it('starts the order workflow', async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [TemporalTestingModule.register()],
    providers: [OrderService],
  }).compile();

  await moduleRef.get(OrderService).place({ id: 'o1' });

  const temporal = moduleRef.get(TemporalTestingRecorder);
  expect(temporal.callsTo('startWorkflow')[0].args[0]).toBe('processOrder');
});
```

`OrderService` is any class that injects `TemporalService`. The module is global, so every provider in the testing module sees the fakes.

### Configure results and errors

```typescript
const temporal = moduleRef.get(TemporalTestingRecorder);

// Fixed result
temporal.respondWith('queryWorkflow', { success: true, result: { status: 'paid' } });

// Computed from the arguments
temporal.respondWith('signalWorkflow', (workflowId: string, signalName: string) => ({
  success: true,
  workflowId,
  signalName,
}));

// Error injection
temporal.failWith('startWorkflow', new Error('Temporal is down'));

temporal.reset(); // clear calls, responses and failures between tests
```

Method names match `TemporalService`: `startWorkflow`, `signalWorkflow`, `signalWithStart`, `queryWorkflow`, `getWorkflowHandle`, `terminateWorkflow`, `cancelWorkflow`, `upsertSchedule`, `updateSchedule`, `deleteSchedule`, `startWorker`, `stopWorker`, `isWorkerRunning`, `hasWorker`. For the fake `TemporalClientService`, prefix the name with `client.` (for example `client.startWorkflow`, `client.updateWorkflow`).

Every recorded call is `{ method, args }` in `recorder.calls`; `callsTo(method)` filters it.

## Test an activity

`createActivityHarness` builds your activity through Nest DI and runs its methods inside a mocked Activity context, so `Context.current()`, heartbeats and cancellation work.

```typescript
import { createActivityHarness } from 'nestjs-temporal-core/testing';

it('charges the customer', async () => {
  const harness = await createActivityHarness(PaymentActivities, {
    providers: [{ provide: PaymentGateway, useValue: { charge: async () => 'ok' } }],
  });

  await expect(harness.run('charge', 100)).resolves.toBe('ok');
  await harness.close();
});
```

Heartbeats and cancellation:

```typescript
await harness.run('longJob', 3);
expect(harness.heartbeats).toEqual([{ step: 1 }, { step: 2 }, { step: 3 }]);

const running = harness.run('waitForCancel');
harness.cancel('CANCELLED'); // Context.current().cancellationSignal aborts
await running;
```

Pass `info: { attempt: 3 }` to override fields of `Context.current().info`. Once `cancel()` has been called, the context stays cancelled for later `run()` calls on the same harness; create a new harness per test.

## Mock an activity in another service's test

When a provider depends on an activity class, replace the activity:

```typescript
import { overrideActivity } from 'nestjs-temporal-core/testing';

const builder = Test.createTestingModule({ providers: [Checkout, PaymentActivities] });
const mock = { charge: jest.fn().mockResolvedValue('mocked') }; // vi.fn() with Vitest

const moduleRef = await overrideActivity(builder, PaymentActivities, mock).compile();
```

## Vitest

Nest relies on `emitDecoratorMetadata`, which Vitest's default transform (esbuild) does not emit. Add `unplugin-swc` to your Vitest config, as described in the NestJS testing docs. The helpers themselves need no changes; use `vi.fn()` where the examples use `jest.fn()`.

## What the fakes do not cover

The fakes verify that your code calls Temporal correctly. They do not run workflows. To test workflow logic and activities together against a real engine, use `@temporalio/testing`'s `TestWorkflowEnvironment` (this repository's `test/integration` suite shows how to wire it to a Nest app).
