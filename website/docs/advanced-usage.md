---
id: advanced-usage
title: Advanced Usage
---

## Activity Retry Configuration

```typescript
// workflow.ts
const paymentActivities = proxyActivities<typeof PaymentActivity.prototype>({
  startToCloseTimeout: '5m',
  retry: {
    maximumAttempts: 5,
    initialInterval: '1s',
    maximumInterval: '1m',
    backoffCoefficient: 2,
    nonRetryableErrorTypes: ['InvalidPaymentMethod', 'InsufficientFunds'],
  },
});
```

## Workflow Testing

This example uses the Temporal SDK's own test environment directly. For testing NestJS services that depend on `TemporalService`, the `nestjs-temporal-core/testing` entry point provides `TemporalTestingModule`, `FakeTemporalService` and related helpers.

```typescript
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { processOrderWorkflow } from './order.workflow';

describe('Order Workflow', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await testEnv?.teardown();
  });

  it('should process order successfully', async () => {
    const { client, nativeConnection } = testEnv;

    // Mock activities
    const mockOrderActivity = {
      validatePayment: async () => ({ valid: true }),
      reserveInventory: async () => ({ reservationId: 'res-123' }),
      chargePayment: async () => ({ transactionId: 'txn-123' }),
      sendConfirmationEmail: async () => {},
    };

    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue: 'test',
      workflowsPath: require.resolve('./order.workflow'),
      activities: mockOrderActivity,
    });

    await worker.runUntil(async () => {
      const result = await client.workflow.execute(processOrderWorkflow, {
        workflowId: 'test-order-1',
        taskQueue: 'test',
        args: [{
          orderId: 'order-123',
          payment: { amount: 100, currency: 'USD' },
          items: [{ id: '1', quantity: 1 }],
        }],
      });

      expect(result.status).toBe('completed');
      expect(result.transactionId).toBe('txn-123');
    });
  });
});
```

Next: [Best Practices](./best-practices.md).
