---
id: worker-only-apps
title: Worker-Only Apps
---

A worker-only app runs Temporal activities (and hosts the workflow code bundle) without exposing an HTTP server. This is the usual shape for a dedicated worker deployment next to an API service.

## Bootstrap with `createApplicationContext`

Use `NestFactory.createApplicationContext` instead of `NestFactory.create`. No HTTP listener is opened, but the module lifecycle still runs, so the worker starts and the activities are discovered.

```typescript
// worker.main.ts
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);

  // Required for graceful shutdown: lets the worker drain in-flight activities
  // on SIGTERM/SIGINT before the process exits.
  app.enableShutdownHooks();
}

bootstrap();
```

The process stays alive because the worker keeps polling the task queue. You do not need `app.listen()`.

## Module

```typescript
// worker.module.ts
import { Module } from '@nestjs/common';
import { TemporalModule } from 'nestjs-temporal-core';
import { PaymentActivity } from './activities/payment.activity';

@Module({
  imports: [
    TemporalModule.register({
      connection: {
        address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
        namespace: 'default',
      },
      taskQueue: 'payments',
      worker: {
        workflowsPath: require.resolve('./workflows'),
        activityClasses: [PaymentActivity],
        autoStart: true,
      },
    }),
  ],
  providers: [PaymentActivity],
})
export class WorkerModule {}
```

## `autoStart`

| `autoStart` | Behavior |
| --- | --- |
| `true` (default) | The worker starts during application bootstrap. |
| `false` | The worker is created but not started. Call `temporalService.startWorker()` yourself, for example after warming a cache or running migrations. |

## Graceful shutdown

On `SIGTERM` the worker stops polling for new tasks. By default the Temporal SDK then **cancels** in-flight activities immediately. To let them finish, set a grace period:

```typescript
worker: {
  workflowsPath: require.resolve('./workflows'),
  activityClasses: [PaymentActivity],
  workerOptions: { shutdownGraceTime: '30s' }, // in-flight activities may run this long
},
```

Also call `app.enableShutdownHooks()`; without it the process exits immediately and Temporal retries the interrupted activities after their timeouts. The module-level `shutdownTimeout` option (milliseconds, default `30000`) bounds how long the application waits for the shutdown before moving on.

## Starting workflows from a worker-only app

The client is still available, so a worker can start or signal workflows through `TemporalService` the same way an API service does. If your worker never needs the client, nothing extra is required.

## Checklist

- `createApplicationContext`, not `create`.
- `app.enableShutdownHooks()` in `main.ts`.
- Every activity class is in both `worker.activityClasses` and `providers`.
- `workflowsPath` points to compiled JS in production (see [Troubleshooting](./troubleshooting.md)).
