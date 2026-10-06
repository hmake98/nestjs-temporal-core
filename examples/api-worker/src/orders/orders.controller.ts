import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  place(@Body() body: { orderId: string; cents: number }) {
    return this.orders.place(body.orderId, body.cents);
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string) {
    await this.orders.approve(id);
    return { ok: true };
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string) {
    await this.orders.cancel(id);
    return { ok: true };
  }

  @Get(':id')
  async status(@Param('id') id: string) {
    return { status: await this.orders.status(id) };
  }
}
