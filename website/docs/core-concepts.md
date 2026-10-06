---
id: core-concepts
title: Core Concepts
---

## Activities

Activities are NestJS services decorated with `@Activity()` that perform actual work. They have full access to NestJS dependency injection and can interact with external systems.

**Key Points:**
- Activities are NestJS services (`@Injectable()`)
- Use `@Activity()` decorator at class level
- Use `@ActivityMethod()` decorator for methods to be registered
- Activities should be idempotent and handle retries gracefully
- Full access to NestJS DI (inject services, repositories, etc.)

```typescript
@Injectable()
@Activity({ name: 'order-activities' })
export class OrderActivity {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly emailService: EmailService,
  ) {}

  @ActivityMethod('createOrder')
  async createOrder(orderData: CreateOrderData): Promise<Order> {
    // Database operations with full DI support
    const order = await this.orderRepository.create(orderData);
    await this.emailService.sendConfirmation(order);
    return order;
  }

  @ActivityMethod('validateInventory')
  async validateInventory(items: OrderItem[]): Promise<boolean> {
    // Business logic with injected services
    return await this.orderRepository.checkInventory(items);
  }
}
```

## Workflows

Workflows are **pure Temporal functions** (NOT NestJS services) that orchestrate activities. They must be deterministic and use Temporal's workflow APIs.

**Important:** Workflows are NOT decorated with `@Injectable()` and should NOT use NestJS dependency injection.

```typescript
// order.workflow.ts
import { proxyActivities, defineSignal, defineQuery, setHandler } from '@temporalio/workflow';
import type { OrderActivity } from './order.activity';

// Create activity proxies with proper typing
const { createOrder, validateInventory } = proxyActivities<typeof OrderActivity.prototype>({
  startToCloseTimeout: '5m',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1s',
    maximumInterval: '30s',
  },
});

// Define signals and queries at module level
export const cancelOrderSignal = defineSignal<[string]>('cancelOrder');
export const getOrderStatusQuery = defineQuery<string>('getOrderStatus');

// Workflow function (exported, not a class)
export async function processOrderWorkflow(orderData: CreateOrderData): Promise<OrderResult> {
  let status = 'pending';

  // Set up signal handler
  setHandler(cancelOrderSignal, (reason: string) => {
    status = 'cancelled';
  });

  // Set up query handler
  setHandler(getOrderStatusQuery, () => status);

  try {
    // Validate inventory
    const isValid = await validateInventory(orderData.items);
    if (!isValid) {
      throw new Error('Insufficient inventory');
    }

    // Create order
    status = 'processing';
    const order = await createOrder(orderData);
    status = 'completed';

    return {
      orderId: order.id,
      status,
    };
  } catch (error) {
    status = 'failed';
    throw error;
  }
}
```

## Signals and Queries

Signals allow external systems to send events to workflows, while queries provide read-only access to workflow state.

```typescript
import { defineSignal, defineQuery, setHandler, condition } from '@temporalio/workflow';

// Define at module level
export const updateStatusSignal = defineSignal<[string]>('updateStatus');
export const addItemSignal = defineSignal<[Item]>('addItem');
export const getItemsQuery = defineQuery<Item[]>('getItems');
export const getStatusQuery = defineQuery<string>('getStatus');

export async function myWorkflow(): Promise<void> {
  let status = 'pending';
  const items: Item[] = [];

  // Set up handlers
  setHandler(updateStatusSignal, (newStatus: string) => {
    status = newStatus;
  });

  setHandler(addItemSignal, (item: Item) => {
    items.push(item);
  });

  setHandler(getItemsQuery, () => items);
  setHandler(getStatusQuery, () => status);

  // Wait for completion signal
  await condition(() => status === 'completed');
}
```

## Workflow Updates

Updates combine the strengths of Signals (can mutate workflow state) and Queries (can return a result) into a single request/response operation. Handlers are declared with `@UpdateMethod`, exactly like `@SignalMethod`/`@QueryMethod` — metadata-only, consumed by the client side.

```typescript
import { defineUpdate, setHandler } from '@temporalio/workflow';

export const depositUpdate = defineUpdate<number, [number]>('deposit');

export async function accountWorkflow(initialBalance: number): Promise<void> {
  let balance = initialBalance;

  setHandler(depositUpdate, (amount: number) => {
    balance += amount;
    return balance;
  });

  await condition(() => false); // keep running
}
```

Call it from a service via `TemporalClientService` (reachable as `temporalService.client`; the module exports `TemporalService`, not `TemporalClientService` itself):

```typescript
// Wait for the update to complete and get its result
const newBalance = await this.clientService.updateWorkflow<number>(
  'account-123',
  'deposit',
  [100],
);

// Or start it and only wait for it to be accepted, then await the result later
const updateHandle = await this.clientService.startUpdateWorkflow<number>(
  'account-123',
  'deposit',
  [100],
);
const result = await updateHandle.result();
```

The typed workflow proxy exposes the same operations with full type inference:

```typescript
const newBalance = await this.accountProxy.update('account-123', depositUpdate, 100);
```

## Using Workflows in Services

Inject `TemporalService` in your NestJS services to interact with workflows:

```typescript
@Injectable()
export class OrderService {
  constructor(private readonly temporal: TemporalService) {}

  async createOrder(orderData: CreateOrderData) {
    // Start workflow - note the method signature
    const result = await this.temporal.startWorkflow(
      'processOrderWorkflow',           // Workflow function name
      [orderData],                      // Arguments array
      {                                 // Options
        workflowId: `order-${Date.now()}`,
        taskQueue: 'order-queue',
      }
    );

    return {
      workflowId: result.result.workflowId,
      runId: result.result.runId,
    };
  }

  async queryOrderStatus(workflowId: string) {
    const result = await this.temporal.queryWorkflow(
      workflowId,
      'getOrderStatus'
    );

    return result.result;
  }

  async cancelOrder(workflowId: string, reason: string) {
    await this.temporal.signalWorkflow(
      workflowId,
      'cancelOrder',
      [reason]
    );
  }
}
```

## Typed Workflow Proxy

The typed workflow proxy gives you end-to-end type safety when interacting with a specific workflow. Instead of passing workflow names and args as strings/`unknown[]`, you get a generic `IWorkflowProxy<T>` where `T` is your workflow function type — all method signatures are inferred from `T`.

**What it solves:**

```typescript
// Before: string names, unknown args, manual casts on query results
const handle = await this.temporal.startWorkflow('orderWorkflow', [orderId, customerId]);
const status = await this.temporal.queryWorkflow<OrderStatus>(workflowId, 'getStatus');
```

```typescript
// After: fully typed against the workflow signature
const handle = await this.orderProxy.start([orderId, customerId]);   // args typed as Parameters<typeof orderWorkflow>
const status = await this.orderProxy.query(workflowId, statusQuery); // return type inferred from QueryDefinition
```

If you rename a workflow parameter or change its return type, every call site becomes a compile error until fixed.

### 1. Define signal/query definitions in your workflow file

```typescript
// workflows/order.workflow.ts
import { defineSignal, defineQuery, setHandler, condition } from '@temporalio/workflow';

export interface OrderStatus {
  orderId: string;
  state: 'pending' | 'approved' | 'shipped' | 'cancelled';
}

export const approveSignal = defineSignal<[string]>('approve');             // signal takes one string arg
export const cancelSignal = defineSignal<[string]>('cancel');
export const statusQuery = defineQuery<OrderStatus>('getStatus');           // query returns OrderStatus

export async function orderWorkflow(orderId: string, customerId: number): Promise<OrderStatus> {
  let status: OrderStatus = { orderId, state: 'pending' };

  setHandler(approveSignal, (approver) => {
    status = { ...status, state: 'approved' };
  });
  setHandler(cancelSignal, (reason) => {
    status = { ...status, state: 'cancelled' };
  });
  setHandler(statusQuery, () => status);

  await condition(() => status.state !== 'pending');
  return status;
}
```

### 2. Register a typed proxy as a NestJS provider

```typescript
// order.module.ts
import { Module } from '@nestjs/common';
import { createWorkflowToken, createWorkflowProvider } from 'nestjs-temporal-core';
import { orderWorkflow } from './workflows/order.workflow';
import { OrderService } from './order.service';

export const ORDER_WORKFLOW = createWorkflowToken('orderWorkflow');

@Module({
  providers: [
    OrderService,
    createWorkflowProvider<typeof orderWorkflow>(ORDER_WORKFLOW, {
      workflowType: 'orderWorkflow',
      taskQueue: 'orders',
    }),
  ],
  exports: [ORDER_WORKFLOW],
})
export class OrderModule {}
```

### 3. Inject and use — fully typed

```typescript
// order.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { IWorkflowProxy } from 'nestjs-temporal-core';
import {
  orderWorkflow,
  approveSignal,
  cancelSignal,
  statusQuery,
  OrderStatus,
} from './workflows/order.workflow';
import { ORDER_WORKFLOW } from './order.module';

@Injectable()
export class OrderService {
  constructor(
    @Inject(ORDER_WORKFLOW)
    private readonly orderProxy: IWorkflowProxy<typeof orderWorkflow>,
  ) {}

  async createOrder(orderId: string, customerId: number) {
    // start() args are typed as Parameters<typeof orderWorkflow> = [string, number]
    const handle = await this.orderProxy.start([orderId, customerId], {
      workflowId: `order-${orderId}`,
    });
    return { workflowId: handle.workflowId };
  }

  async approve(workflowId: string, approver: string) {
    // signal() infers TArgs from approveSignal — passing a number here is a compile error
    await this.orderProxy.signal(workflowId, approveSignal, approver);
  }

  async getStatus(workflowId: string): Promise<OrderStatus> {
    // query() return type is inferred from statusQuery
    return this.orderProxy.query(workflowId, statusQuery);
  }

  async waitForCompletion(workflowId: string): Promise<OrderStatus> {
    const handle = await this.orderProxy.getHandle(workflowId);
    // handle.result() is Promise<OrderStatus>, not Promise<unknown>
    return handle.result();
  }

  async cancelOrder(orderId: string, reason: string) {
    // signalWithStart: atomically starts the workflow and signals it
    await this.orderProxy.signalWithStart(
      cancelSignal,
      [reason],                  // signal args — typed
      [orderId, 0],              // workflow args — typed as Parameters<typeof orderWorkflow>
      { workflowId: `order-${orderId}` },
    );
  }
}
```

### Alternative: use `WorkflowProxyFactory` directly

If you don't want a token-bound provider, inject the factory and create proxies on demand:

```typescript
import { Injectable } from '@nestjs/common';
import { WorkflowProxyFactory, IWorkflowProxy } from 'nestjs-temporal-core';
import { orderWorkflow } from './workflows/order.workflow';

@Injectable()
export class OrderService {
  private readonly orderProxy: IWorkflowProxy<typeof orderWorkflow>;

  constructor(factory: WorkflowProxyFactory) {
    this.orderProxy = factory.createProxy<typeof orderWorkflow>({
      workflowType: 'orderWorkflow',
      taskQueue: 'orders',
    });
  }
}
```

`TemporalModule` exports `WorkflowProxyFactory`. It is available in feature modules without importing `TemporalModule` again only when you registered it with `isGlobal: true`; otherwise import `TemporalModule` in the feature module.

### Proxy method reference

| Method | Purpose | Typing |
|---|---|---|
| `start(args, options?)` | Start a new workflow execution | `args` typed as `Parameters<T>`; returns `WorkflowHandleWithMetadata<T>` |
| `getHandle(workflowId, runId?)` | Get a handle to an existing execution | Returns `WorkflowHandle<T>`; `result()` returns `Promise<WorkflowResultType<T>>` |
| `signal(workflowId, signalDef, ...args)` | Send a typed signal | `args` typed from `SignalDefinition<TArgs>` |
| `signalByName(workflowId, signalName, args?)` | Send a signal by string name | Fallback when no `SignalDefinition` is available |
| `query(workflowId, queryDef, ...args)` | Query with a typed definition | Return type inferred from `QueryDefinition<TResult, TArgs>` |
| `queryByName<TResult>(workflowId, queryName, args?)` | Query by string name | Caller specifies `TResult` |
| `signalWithStart(signalDef, signalArgs, workflowArgs, options?)` | Atomic start + signal | Both arg lists fully typed |

## Signal-with-Start

`signalWithStart` atomically starts a workflow and sends it a signal in one operation. If the workflow is already running, only the signal is delivered — no duplicate start, no race condition.

Use it for **idempotent "ensure running + signal"** patterns, e.g. a cart that should be started on the first item-add and signaled on every subsequent one.

### Via the typed proxy (recommended)

```typescript
// in workflows/cart.workflow.ts:
// export const addItemSignal = defineSignal<[CartItem]>('addItem');
// export async function cartWorkflow(userId: string) { ... }

await this.cartProxy.signalWithStart(
  addItemSignal,
  [{ sku: 'SKU-123', qty: 2 }],   // signal args — typed from SignalDefinition
  [userId],                        // workflow args — typed as Parameters<typeof cartWorkflow>
  { workflowId: `cart-${userId}`, taskQueue: 'carts' },
);
```

### Via `TemporalService` (structured result)

```typescript
const result = await this.temporal.signalWithStart(
  'cartWorkflow',
  'addItem',
  [{ sku: 'SKU-123', qty: 2 }],
  [userId],
  { workflowId: `cart-${userId}`, taskQueue: 'carts' },
);

if (result.success) {
  this.logger.log(`Signal '${result.signalName}' delivered to ${result.workflowId}`);
}
```

### Via `TemporalClientService` (raw handle)

```typescript
const handle = await this.clientService.signalWithStart(
  'orderWorkflow',
  'approve',
  ['manager-approval'],
  [orderId, customerId],
  {
    workflowId: `order-${orderId}`,
    taskQueue: 'orders',
    workflowIdReusePolicy: 'ALLOW_DUPLICATE',
    workflowExecutionTimeout: '1h',
    memo: { source: 'api' },
  },
);
```

Next: [Advanced Configuration](./advanced-configuration.md).
