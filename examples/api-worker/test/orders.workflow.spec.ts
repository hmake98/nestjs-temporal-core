import { INestApplicationContext } from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';
import { assertReplays, TemporalTestEnvironment } from 'nestjs-temporal-core/testing';
import * as path from 'path';
import { OrdersActivities, OrdersGateway } from '../src/orders/orders.activities';

const workflowsPath = path.join(__dirname, '../src/orders/orders.workflows');

// The real workflow on a time-skipping test server. The 1-hour approval timer finishes at once.
describe('orderWorkflow', () => {
  let testEnv: TemporalTestEnvironment;
  let app: INestApplicationContext;
  let taskQueue: string;
  let temporal: TemporalService;

  beforeAll(async () => {
    testEnv = await TemporalTestEnvironment.create({ timeSkipping: true });
    ({ app, taskQueue } = await testEnv.createApp({
      options: { errorMapping: true, worker: { workflowsPath, autoStart: true } },
      activityClasses: [OrdersActivities],
      providers: [OrdersGateway],
    }));
    temporal = app.get(TemporalService);
  }, 120_000);

  afterAll(() => testEnv.teardown());

  const start = async (workflowId: string, cents = 500) => {
    const started = await temporal.startWorkflow<{ result(): Promise<string> }>(
      'orderWorkflow',
      [workflowId, cents],
      { taskQueue, workflowId },
    );
    return started.result!;
  };

  it('cancels itself when nobody approves within the hour', async () => {
    const handle = await start('no-approval');
    await expect(handle.result()).resolves.toBe('cancelled');
  });

  it('completes after an approval signal', async () => {
    const handle = await start('approved');
    await temporal.signalWorkflow('approved', 'approve');
    await expect(handle.result()).resolves.toBe('completed');
  });

  it('fails without retrying a declined card (errorMapping + @NonRetryable)', async () => {
    const handle = await start('declined', 0);
    await temporal.signalWorkflow('declined', 'approve');
    await expect(handle.result()).rejects.toThrow();
  });

  it('still replays a recorded history against the current workflow code', async () => {
    const handle = await start('replay-me');
    await temporal.signalWorkflow('replay-me', 'approve');
    await handle.result();

    const history = await testEnv.client.workflow.getHandle('replay-me').fetchHistory();
    await assertReplays({ workflowsPath }, [{ workflowId: 'replay-me', history }]);
  });
});
