---
id: configuration
title: Configuration
---

## Basic Configuration

```typescript
TemporalModule.register({
  connection: {
    address: 'localhost:7233',
    namespace: 'default',
  },
  taskQueue: 'my-task-queue',
  worker: {
    workflowsPath: require.resolve('./workflows'),
    activityClasses: [PaymentActivity, EmailActivity],
    autoStart: true,
    workerOptions: {
      maxConcurrentActivityTaskExecutions: 100,
    },
  },
  logLevel: 'info',
  enableLogger: true,
})
```

## Multiple Workers Configuration

**New in 3.0.12**: Support for multiple workers with different task queues in the same process.

```typescript
TemporalModule.register({
  connection: {
    address: 'localhost:7233',
    namespace: 'default',
  },
  autoRestart: true,  // Global default for all workers
  maxRestarts: 3,     // Global default for all workers
  workers: [
    {
      taskQueue: 'payments-queue',
      workflowsPath: require.resolve('./workflows/payments'),
      activityClasses: [PaymentActivity, RefundActivity],
      autoStart: true,
      maxRestarts: 5,  // Override for this critical worker
      workerOptions: {
        maxConcurrentActivityTaskExecutions: 100,
      },
    },
    {
      taskQueue: 'notifications-queue',
      workflowsPath: require.resolve('./workflows/notifications'),
      activityClasses: [EmailActivity, SmsActivity],
      autoStart: true,
      workerOptions: {
        maxConcurrentActivityTaskExecutions: 50,
      },
    },
    {
      taskQueue: 'background-jobs',
      workflowsPath: require.resolve('./workflows/jobs'),
      activityClasses: [DataProcessingActivity],
      autoStart: false,    // Start manually later
      autoRestart: false,  // Disable auto-restart for this worker
    },
  ],
  logLevel: 'info',
  enableLogger: true,
})
```

### Accessing Multiple Workers

```typescript
import { Injectable } from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';

@Injectable()
export class WorkerManagementService {
  constructor(private readonly temporal: TemporalService) {}

  async checkWorkerStatus() {
    // Get all workers info
    const workersInfo = this.temporal.getAllWorkers();
    console.log(`Total workers: ${workersInfo?.totalWorkers}`);
    console.log(`Running workers: ${workersInfo?.runningWorkers}`);

    // Get specific worker status
    const paymentWorkerStatus = this.temporal.getWorkerStatusByTaskQueue('payments-queue');
    if (paymentWorkerStatus?.isHealthy) {
      console.log('Payment worker is healthy');
    }
  }

  async controlWorkers() {
    // Start a specific worker
    await this.temporal.startWorkerByTaskQueue('background-jobs');

    // Stop a specific worker
    await this.temporal.stopWorkerByTaskQueue('notifications-queue');
  }

  async registerNewWorker() {
    // Dynamically register a new worker at runtime
    const result = await this.temporal.registerWorker({
      taskQueue: 'new-queue',
      workflowsPath: require.resolve('./workflows/new'),
      activityClasses: [NewActivity],
      autoStart: true,
    });

    if (result.success) {
      console.log(`Worker registered for queue: ${result.taskQueue}`);
    }
  }
}
```

## Manual Worker Creation (Advanced)

For users who need full control, you can access the native Temporal connection to create custom workers:

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';
import { Worker } from '@temporalio/worker';

@Injectable()
export class CustomWorkerService implements OnModuleInit {
  private customWorker: Worker;

  constructor(private readonly temporal: TemporalService) {}

  async onModuleInit() {
    const workerManager = this.temporal.getWorkerManager();
    const connection = workerManager.getConnection();

    if (!connection) {
      throw new Error('No connection available');
    }

    // Create your custom worker using the native Temporal SDK
    this.customWorker = await Worker.create({
      connection,
      taskQueue: 'custom-task-queue',
      namespace: 'default',
      workflowsPath: require.resolve('./workflows/custom'),
      activities: {
        myCustomActivity: async (data: string) => {
          return `Processed: ${data}`;
        },
      },
    });

    // Start the worker
    await this.customWorker.run();
  }
}
```

## Async Configuration

For dynamic configuration using environment variables or config services:

```typescript
// config/temporal.config.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TemporalOptionsFactory, TemporalOptions } from 'nestjs-temporal-core';

@Injectable()
export class TemporalConfigService implements TemporalOptionsFactory {
  constructor(private configService: ConfigService) {}

  createTemporalOptions(): TemporalOptions {
    return {
      connection: {
        address: this.configService.get('TEMPORAL_ADDRESS', 'localhost:7233'),
        namespace: this.configService.get('TEMPORAL_NAMESPACE', 'default'),
      },
      taskQueue: this.configService.get('TEMPORAL_TASK_QUEUE', 'default'),
      worker: {
        workflowsPath: require.resolve('../workflows'),
        activityClasses: [PaymentActivity, EmailActivity],
        workerOptions: {
          maxConcurrentActivityTaskExecutions: 100,
        },
      },
    };
  }
}

// app.module.ts
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TemporalModule.registerAsync({
      imports: [ConfigModule],
      useClass: TemporalConfigService,
    }),
  ],
})
export class AppModule {}
```

### Alternative Async Pattern (useFactory)

```typescript
TemporalModule.registerAsync({
  imports: [ConfigModule],
  useFactory: (configService: ConfigService) => ({
    connection: {
      address: configService.get('TEMPORAL_ADDRESS', 'localhost:7233'),
      namespace: configService.get('TEMPORAL_NAMESPACE', 'default'),
    },
    taskQueue: configService.get('TEMPORAL_TASK_QUEUE', 'default'),
    worker: {
      workflowsPath: require.resolve('./workflows'),
      activityClasses: [PaymentActivity, EmailActivity],
    },
  }),
  inject: [ConfigService],
})
```

## TLS Configuration (Temporal Cloud)

For secure connections to Temporal Cloud:

```typescript
import * as fs from 'fs';

TemporalModule.register({
  connection: {
    address: 'your-namespace.your-account.tmprl.cloud:7233',
    namespace: 'your-namespace.your-account',
    tls: {
      clientCertPair: {
        crt: fs.readFileSync('/path/to/client.crt'),
        key: fs.readFileSync('/path/to/client.key'),
      },
    },
  },
  taskQueue: 'my-task-queue',
  worker: {
    workflowsPath: require.resolve('./workflows'),
    activityClasses: [PaymentActivity],
  },
})
```

## Configuration Options Reference

Abridged; see `TemporalOptions` and `WorkerDefinition` in `src/interfaces.ts` for the full shape. Security, correlation, error mapping, runtime and bundling options are covered in their own guides ([Security](./security.md), [Observability](./observability.md), [Error Handling](./error-handling.md), [Bundling](./bundling.md)).

```typescript
interface TemporalOptions {
  // Connection settings
  connection?: {
    address: string;                    // Temporal server address, with port (required when `connection` is set)
    namespace?: string;                 // Temporal namespace (falls back to 'default')
    tls?: boolean | TLSConfig;          // TLS configuration for secure connections
    apiKey?: string;                    // API key (Temporal Cloud)
    metadata?: Record<string, string>;  // gRPC metadata
    interceptors?: ClientInterceptors;  // Client-level interceptors
    dataConverter?: DataConverter;      // Client-side data converter
    grpcCompression?: GrpcCompressionConfig;  // Worker connection compression
  };

  // Default task queue (falls back to 'default')
  taskQueue?: string;

  // Single worker. Omit both `worker` and `workers` for a client-only app.
  worker?: {
    workflowsPath?: string;             // Path to workflow definitions (use require.resolve)
    autoBundle?: boolean | AutoBundleOptions;  // Bundle workflows at startup with a content-hash cache
    workflowBundle?: WorkflowBundleOption;     // Prebuilt bundle (not with workflowsPath)
    activityClasses?: Type<object>[];   // Activity classes to register
    autoStart?: boolean;                // Start worker on module init (default: true)
    autoRestart?: boolean;              // Auto-restart on failure (inherits from global)
    maxRestarts?: number;               // Max restart attempts (inherits from global)
    workerOptions?: WorkerCreateOptions;  // Subset of the SDK WorkerOptions, e.g.
                                          // maxConcurrentActivityTaskExecutions, maxActivitiesPerSecond
  };

  // Several workers, one per task queue (same fields as `worker`, plus a required `taskQueue`)
  workers?: WorkerDefinition[];

  // Logging
  logLevel?: 'error' | 'warn' | 'info' | 'debug' | 'verbose';  // Log level (default: 'info')
  enableLogger?: boolean;               // Enable logging (default: true)

  // Auto-restart configuration (global defaults for all workers)
  autoRestart?: boolean;                // Auto-restart worker on failure (default: true)
  maxRestarts?: number;                 // Max restart attempts before giving up (default: 3)

  // Shutdown
  enableShutdownHooks?: boolean;        // Declared but currently has no effect: call app.enableShutdownHooks() in main.ts
  shutdownTimeout?: number;             // Max ms to wait for graceful worker shutdown (default: 30000)

  // Advanced
  isGlobal?: boolean;                   // Make module global
  allowConnectionFailure?: boolean;     // Keep the app running if Temporal is unreachable
  strictSecurity?: boolean;             // Turn security warnings into startup errors (default: false)
  dataConverter?: DataConverter;        // One converter for both client and worker
  correlation?: boolean | CorrelationOptions;  // Correlation id propagation (default: off)
  errorMapping?: boolean | ErrorMappingOptions; // Activity error mapping (default: off)
  runtime?: TemporalRuntimeOptions;     // Process-wide SDK runtime (logs, metrics)
}
```

Next: [Core Concepts](./core-concepts.md).
