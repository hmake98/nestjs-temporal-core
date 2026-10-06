import { Test } from '@nestjs/testing';
import { TemporalService } from 'nestjs-temporal-core';
import { TemporalTestingModule, TemporalTestingRecorder } from 'nestjs-temporal-core/testing';
import { OrdersService } from '../src/orders/orders.service';

// A unit test with no Temporal server: TemporalTestingModule swaps TemporalService for a fake
// that records calls.
describe('OrdersService', () => {
  let orders: OrdersService;
  let recorder: TemporalTestingRecorder;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TemporalTestingModule.register()],
      providers: [OrdersService],
    }).compile();
    orders = moduleRef.get(OrdersService);
    recorder = moduleRef.get(TemporalTestingRecorder);
  });

  it('starts the order workflow with a business-key workflow id', async () => {
    await expect(orders.place('o1', 4200)).resolves.toEqual({ workflowId: 'order-o1' });

    const [call] = recorder.callsTo('startWorkflow');
    expect(call.args[0]).toBe('orderWorkflow');
    expect(call.args[1]).toEqual(['o1', 4200]);
    expect(call.args[2]).toMatchObject({ taskQueue: 'orders', workflowId: 'order-o1' });
  });

  it('signals approve and cancel on the same workflow id', async () => {
    await orders.approve('o1');
    await orders.cancel('o1');
    expect(recorder.callsTo('signalWorkflow').map((c) => c.args.slice(0, 2))).toEqual([
      ['order-o1', 'approve'],
      ['order-o1', 'cancel'],
    ]);
  });

  it('is wired to the facade, not the real client', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TemporalTestingModule.register()],
    }).compile();
    expect(moduleRef.get(TemporalService)).toBeDefined();
  });
});
