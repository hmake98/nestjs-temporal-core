import { Injectable } from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';

export const ORDERS_TASK_QUEUE = 'orders';

@Injectable()
export class OrdersService {
  constructor(private readonly temporal: TemporalService) {}

  async place(orderId: string, cents: number): Promise<{ workflowId: string }> {
    // A business key as workflow id: a retried HTTP request cannot start the order twice.
    const workflowId = `order-${orderId}`;
    await this.temporal.startWorkflow('orderWorkflow', [orderId, cents], {
      taskQueue: ORDERS_TASK_QUEUE,
      workflowId,
    });
    return { workflowId };
  }

  async approve(orderId: string): Promise<void> {
    await this.temporal.signalWorkflow(`order-${orderId}`, 'approve');
  }

  async cancel(orderId: string): Promise<void> {
    await this.temporal.signalWorkflow(`order-${orderId}`, 'cancel');
  }

  async status(orderId: string): Promise<string> {
    const result = await this.temporal.queryWorkflow<string>(`order-${orderId}`, 'status');
    return result.result as string;
  }
}
