// Workflow code runs in a deterministic sandbox: import ONLY from '@temporalio/workflow'
// (plus types). No Nest, no services, no Date.now()/Math.random()/fetch.
import { condition, defineQuery, defineSignal, proxyActivities, setHandler } from '@temporalio/workflow';
import type { OrdersActivities } from './orders.activities';

const { reserveStock, releaseStock, chargeCard } = proxyActivities<OrdersActivities>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 3 },
});

export const approveSignal = defineSignal('approve');
export const cancelSignal = defineSignal('cancel');
export const statusQuery = defineQuery<string>('status');

export type OrderOutcome = 'completed' | 'cancelled';

/** Reserve stock, wait up to an hour for approval, then charge. No approval means cancel. */
export async function orderWorkflow(orderId: string, cents: number): Promise<OrderOutcome> {
  let status = 'reserving';
  let approved = false;
  let cancelled = false;
  setHandler(approveSignal, () => void (approved = true));
  setHandler(cancelSignal, () => void (cancelled = true));
  setHandler(statusQuery, () => status);

  await reserveStock(orderId);

  status = 'awaiting-approval';
  await condition(() => approved || cancelled, '1 hour'); // a timer: skipped in tests

  if (!approved) {
    await releaseStock(orderId);
    status = 'cancelled';
    return 'cancelled';
  }

  status = 'charging';
  await chargeCard(orderId, cents);
  status = 'completed';
  return 'completed';
}
