import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod, NonRetryable } from 'nestjs-temporal-core';

export class PaymentDeclinedError extends Error {
  name = 'PaymentDeclinedError';
}

/** Stand-in for a real payment/inventory backend; swap for your own providers. */
@Injectable()
export class OrdersGateway {
  async reserve(orderId: string): Promise<void> {
    void orderId;
  }
  async release(orderId: string): Promise<void> {
    void orderId;
  }
  async charge(orderId: string, cents: number): Promise<string> {
    if (cents <= 0) throw new PaymentDeclinedError(`invalid amount for ${orderId}`);
    return `receipt-${orderId}`;
  }
}

/**
 * Activities do all the I/O. They are normal Nest providers, so they can inject anything.
 * The workflow refers to them only through `import type`.
 */
@Injectable()
@Activity()
export class OrdersActivities {
  constructor(private readonly gateway: OrdersGateway) {}

  @ActivityMethod('reserveStock')
  async reserveStock(orderId: string): Promise<void> {
    await this.gateway.reserve(orderId);
  }

  @ActivityMethod('releaseStock')
  async releaseStock(orderId: string): Promise<void> {
    await this.gateway.release(orderId);
  }

  // A declined card will not succeed on retry: fail the activity at once (needs `errorMapping`).
  @ActivityMethod('chargeCard')
  @NonRetryable([PaymentDeclinedError])
  async chargeCard(orderId: string, cents: number): Promise<string> {
    return this.gateway.charge(orderId, cents);
  }
}
