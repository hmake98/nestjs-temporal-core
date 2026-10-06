---
id: getting-started
title: Getting Started
---

## Installation

```bash
npm install nestjs-temporal-core @temporalio/client @temporalio/worker @temporalio/workflow @temporalio/common
```

### Peer Dependencies

```bash
npm install @nestjs/common @nestjs/core reflect-metadata rxjs
```

Supported ranges: NestJS 9 to 12, and `@temporalio/*` `^1.15.0 || ^1.19.0`. Node.js >= 20.3.0 is required.

## Quick Start

### 1. Enable Shutdown Hooks

Enable shutdown hooks in your `main.ts` for proper Temporal resource cleanup:

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Required for graceful Temporal connection cleanup
  app.enableShutdownHooks();

  await app.listen(3000);
}
bootstrap();
```

### 2. Configure the Module

Import and configure `TemporalModule` in your app module:

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { TemporalModule } from 'nestjs-temporal-core';
import { PaymentActivity } from './activities/payment.activity';
import { EmailActivity } from './activities/email.activity';

@Module({
  imports: [
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
      },
    }),
  ],
  providers: [PaymentActivity, EmailActivity],
})
export class AppModule {}
```

### 3. Define Activities

Create activities using `@Activity()` and `@ActivityMethod()` decorators:

```typescript
// payment.activity.ts
import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';

export interface PaymentData {
  amount: number;
  currency: string;
  customerId: string;
}

@Injectable()
@Activity({ name: 'payment-activities' })
export class PaymentActivity {

  @ActivityMethod('processPayment')
  async processPayment(data: PaymentData): Promise<{ transactionId: string }> {
    // Payment processing logic with full NestJS DI support
    console.log(`Processing payment: $${data.amount} ${data.currency}`);

    // Simulate payment processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    return { transactionId: `txn_${Date.now()}` };
  }

  @ActivityMethod('refundPayment')
  async refundPayment(transactionId: string): Promise<{ refundId: string }> {
    // Refund logic
    console.log(`Refunding transaction: ${transactionId}`);
    return { refundId: `ref_${Date.now()}` };
  }
}
```

### 4. Define Workflows

Create workflows as pure Temporal functions (NOT NestJS services):

```typescript
// payment.workflow.ts
import { proxyActivities, defineSignal, defineQuery, setHandler } from '@temporalio/workflow';
import type { PaymentActivity } from './payment.activity';

// Create activity proxies
const { processPayment, refundPayment } = proxyActivities<typeof PaymentActivity.prototype>({
  startToCloseTimeout: '5m',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1s',
  },
});

// Define signals and queries
export const cancelPaymentSignal = defineSignal<[string]>('cancelPayment');
export const getPaymentStatusQuery = defineQuery<string>('getPaymentStatus');

export async function processPaymentWorkflow(data: PaymentData): Promise<any> {
  let status = 'processing';
  let transactionId: string | undefined;

  // Set up signal and query handlers
  setHandler(cancelPaymentSignal, (reason: string) => {
    status = 'cancelled';
  });

  setHandler(getPaymentStatusQuery, () => status);

  try {
    // Execute payment activity
    const result = await processPayment(data);
    transactionId = result.transactionId;
    status = 'completed';

    return {
      success: true,
      transactionId,
      status,
    };
  } catch (error) {
    status = 'failed';

    // Compensate if needed
    if (transactionId) {
      await refundPayment(transactionId);
    }

    throw error;
  }
}
```

### 5. Use in Services

Inject `TemporalService` to start and manage workflows:

```typescript
// payment.service.ts
import { Injectable } from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';

@Injectable()
export class PaymentService {
  constructor(private readonly temporal: TemporalService) {}

  async processPayment(paymentData: any) {
    // Start workflow
    const result = await this.temporal.startWorkflow(
      'processPaymentWorkflow',
      [paymentData],
      {
        workflowId: `payment-${Date.now()}`,
        taskQueue: 'my-task-queue',
      }
    );

    return {
      workflowId: result.result.workflowId,
      runId: result.result.runId,
    };
  }

  async checkPaymentStatus(workflowId: string) {
    // Query workflow
    const statusResult = await this.temporal.queryWorkflow(
      workflowId,
      'getPaymentStatus'
    );

    return { status: statusResult.result };
  }

  async cancelPayment(workflowId: string, reason: string) {
    // Send signal
    await this.temporal.signalWorkflow(
      workflowId,
      'cancelPayment',
      [reason]
    );
  }
}
```

## Module Variants

There is one module, `TemporalModule`. What it sets up depends on the options you pass.

### 1. Client and Worker (Recommended)

Complete integration with both client and worker capabilities:

```typescript
import { TemporalModule } from 'nestjs-temporal-core';

TemporalModule.register({
  connection: { address: 'localhost:7233' },
  taskQueue: 'my-queue',
  worker: {
    workflowsPath: require.resolve('./workflows'),
    activityClasses: [PaymentActivity, EmailActivity],
  },
})
```

### 2. Client-Only

For services that only need to start/query workflows. Omit `worker` (and `workers`) and no worker is created:

```typescript
TemporalModule.register({
  connection: { address: 'localhost:7233', namespace: 'default' },
  taskQueue: 'my-queue',
  isGlobal: true,
})
```

### 3. Worker-Only

For dedicated worker processes without an HTTP server, see [Worker-Only Apps](./worker-only-apps.md).

### 4. Several Task Queues

Use `workers: []` instead of `worker` to run one worker per task queue in the same process. See [Configuration](./configuration.md#multiple-workers-configuration).

Next: [Configuration](./configuration.md).
