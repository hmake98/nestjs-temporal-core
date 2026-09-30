---
id: health-monitoring
title: Health Monitoring
---

The package includes comprehensive health monitoring capabilities for production deployments.

## Using Built-in Health Module

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { TemporalModule } from 'nestjs-temporal-core';
import { TemporalHealthModule } from 'nestjs-temporal-core/health';

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
    TemporalHealthModule, // Adds /health/temporal endpoint
  ],
})
export class AppModule {}
```

## Custom Health Checks

```typescript
@Controller('health')
export class HealthController {
  constructor(private readonly temporal: TemporalService) {}

  @Get('/status')
  async getHealthStatus() {
    const health = this.temporal.getHealth();

    return {
      status: health.overallHealth,
      timestamp: new Date(),
      services: {
        client: {
          healthy: health.client.status === 'healthy',
          connection: health.client.connectionStatus,
        },
        worker: {
          healthy: health.worker.status === 'healthy',
          state: health.worker.state,
          activitiesRegistered: health.worker.activitiesCount,
        },
        discovery: {
          healthy: health.discovery.status === 'healthy',
          activitiesDiscovered: health.discovery.activitiesDiscovered,
        },
      },
      uptime: health.uptime,
    };
  }
}
```

Next: [Troubleshooting](./troubleshooting.md).
