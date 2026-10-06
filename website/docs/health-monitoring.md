---
id: health-monitoring
title: Health Monitoring
---

The package includes comprehensive health monitoring capabilities for production deployments.

## Using Built-in Health Module

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { TemporalModule, TemporalHealthModule } from 'nestjs-temporal-core';

@Module({
  imports: [
    TemporalModule.register({
      connection: { address: 'localhost:7233' },
      taskQueue: 'my-queue',
      worker: {
        workflowsPath: require.resolve('./workflows'),
        activityClasses: [MyActivity],
      },
    }),
    TemporalHealthModule, // Adds GET /temporal/health
  ],
})
export class AppModule {}
```

`TemporalHealthModule` is exported from the main entry point. The endpoint is `GET /temporal/health` and returns the overall status (`healthy`, `degraded` or `unhealthy`) plus client, worker, discovery, schedule and metadata details.

To expose only `{ status, timestamp }` on a public route, register it with `detail: 'minimal'`:

```typescript
TemporalHealthModule.register({ detail: 'minimal' })
```

## Terminus

If you use `@nestjs/terminus`, `nestjs-temporal-core/terminus` provides `TemporalHealthIndicator`. See [Security](./security.md#terminus).

## Custom Health Checks

```typescript
@Controller('health')
export class HealthController {
  constructor(private readonly temporal: TemporalService) {}

  @Get('/status')
  async getHealthStatus() {
    const health = this.temporal.getHealth();

    return {
      status: health.status,
      timestamp: new Date(),
      namespace: health.namespace,
      services: {
        client: {
          healthy: health.services.client.status === 'healthy',
          connected: health.summary.clientConnected,
        },
        worker: {
          healthy: health.services.worker.status === 'healthy',
          running: health.summary.workerRunning,
        },
        discovery: {
          healthy: health.services.discovery.status === 'healthy',
          activities: health.summary.totalActivities,
        },
      },
      uptime: process.uptime(),
    };
  }
}
```

`getHealth()` is synchronous and reads the current state of each service. `await temporal.getOverallHealth()` returns the same data as per-component results with a `timestamp`.

Next: [Troubleshooting](./troubleshooting.md).
