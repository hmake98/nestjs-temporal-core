import * as path from 'path';
import { TemporalOptions } from 'nestjs-temporal-core';
import { OrdersActivities } from './orders/orders.activities';
import { ORDERS_TASK_QUEUE } from './orders/orders.service';
import { setupTelemetry } from './telemetry';

/**
 * One config shared by both processes. The API only needs a client; the worker adds `worker`.
 * Run them separately so HTTP traffic and workflow execution scale independently.
 */
export function temporalOptions(role: 'api' | 'worker'): TemporalOptions {
  const otel = setupTelemetry(`orders-${role}`);

  return {
    connection: {
      address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
      namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
      interceptors: otel?.client,
    },
    taskQueue: ORDERS_TASK_QUEUE,
    runtime: { logger: 'nest' }, // SDK logs go through the Nest logger
    correlation: true, // one correlation id from the HTTP request to every activity log
    errorMapping: true, // @NonRetryable() and 4xx HttpException stop retrying
    ...(role === 'worker' && {
      worker: {
        // Works from src/ (ts-node) and dist/ (compiled): .ts and .js are swapped for you.
        workflowsPath: path.join(__dirname, 'orders/orders.workflows'),
        autoBundle: true, // bundle once, cache by content hash
        activityClasses: [OrdersActivities],
        autoStart: true,
        workerOptions: { ...otel?.worker },
      },
    }),
  };
}
