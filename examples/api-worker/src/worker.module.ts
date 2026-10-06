import { Module } from '@nestjs/common';
import { TemporalModule } from 'nestjs-temporal-core';
import { OrdersActivities, OrdersGateway } from './orders/orders.activities';
import { temporalOptions } from './temporal.config';

/** The worker process: runs workflows and activities. Activities are ordinary providers. */
@Module({
  imports: [TemporalModule.register(temporalOptions('worker'))],
  providers: [OrdersActivities, OrdersGateway],
})
export class WorkerModule {}
