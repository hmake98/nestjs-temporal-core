import { createActivityHarness } from 'nestjs-temporal-core/testing';
import { OrdersActivities, OrdersGateway, PaymentDeclinedError } from '../src/orders/orders.activities';

// Activities are tested with real Nest DI and a mock activity context: no server, no worker.
describe('OrdersActivities', () => {
  it('charges through the gateway', async () => {
    const gateway = { charge: jest.fn().mockResolvedValue('receipt-1') };
    const harness = await createActivityHarness(OrdersActivities, {
      providers: [{ provide: OrdersGateway, useValue: gateway }],
    });

    await expect(harness.run('chargeCard', 'o1', 100)).resolves.toBe('receipt-1');
    expect(gateway.charge).toHaveBeenCalledWith('o1', 100);
    await harness.close();
  });

  it('throws PaymentDeclinedError for a bad amount (errorMapping makes it non-retryable at runtime)', async () => {
    const harness = await createActivityHarness(OrdersActivities, { providers: [OrdersGateway] });
    await expect(harness.run('chargeCard', 'o1', 0)).rejects.toBeInstanceOf(PaymentDeclinedError);
    await harness.close();
  });
});
