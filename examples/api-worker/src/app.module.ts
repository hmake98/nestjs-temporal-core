import { Module } from '@nestjs/common';
import { TemporalModule } from 'nestjs-temporal-core';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { temporalOptions } from './temporal.config';

/** The HTTP API process: a Temporal client only, no worker. */
@Module({
  imports: [TemporalModule.register(temporalOptions('api'))],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class AppModule {}
