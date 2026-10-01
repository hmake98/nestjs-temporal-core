import { Inject, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Context } from '@temporalio/activity';
import { createActivityHarness, overrideActivity } from '../../src/testing';
import { Activity, ActivityMethod } from '../../src';

const GATEWAY = 'GATEWAY';

@Injectable()
@Activity()
class PaymentActivities {
    constructor(
        @Inject(GATEWAY) private readonly gateway: { charge(n: number): Promise<string> },
    ) {}

    @ActivityMethod()
    async charge(amount: number): Promise<string> {
        return this.gateway.charge(amount);
    }

    @ActivityMethod()
    async longJob(steps: number): Promise<number> {
        for (let i = 1; i <= steps; i++) {
            Context.current().heartbeat({ step: i });
        }
        return steps;
    }

    @ActivityMethod()
    async waitForCancel(): Promise<string> {
        const signal = Context.current().cancellationSignal;
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
        return 'cancelled';
    }

    @ActivityMethod()
    attempt(): number {
        return Context.current().info.attempt;
    }
}

const gateway = { provide: GATEWAY, useValue: { charge: async (n: number) => `charged-${n}` } };

describe('createActivityHarness', () => {
    it('runs a DI-injected activity method', async () => {
        const harness = await createActivityHarness(PaymentActivities, { providers: [gateway] });

        await expect(harness.run('charge', 5)).resolves.toBe('charged-5');
        expect(harness.instance).toBeInstanceOf(PaymentActivities);
        await harness.close();
    });

    it('records heartbeat details in order', async () => {
        const harness = await createActivityHarness(PaymentActivities, { providers: [gateway] });

        await expect(harness.run('longJob', 3)).resolves.toBe(3);
        expect(harness.heartbeats).toEqual([{ step: 1 }, { step: 2 }, { step: 3 }]);
        await harness.close();
    });

    it('cancels the activity context', async () => {
        const harness = await createActivityHarness(PaymentActivities, { providers: [gateway] });

        const running = harness.run('waitForCancel');
        harness.cancel('CANCELLED');

        await expect(running).resolves.toBe('cancelled');
        await harness.close();
    });

    it('passes activity info overrides', async () => {
        const harness = await createActivityHarness(PaymentActivities, {
            providers: [gateway],
            info: { attempt: 3 },
        });

        await expect(harness.run('attempt')).resolves.toBe(3);
        await harness.close();
    });

    it('propagates activity errors', async () => {
        const harness = await createActivityHarness(PaymentActivities, {
            providers: [
                {
                    provide: GATEWAY,
                    useValue: { charge: () => Promise.reject(new Error('declined')) },
                },
            ],
        });

        await expect(harness.run('charge', 1)).rejects.toThrow('declined');
        await harness.close();
    });

    it('throws a clear error when @temporalio/testing is missing', async () => {
        jest.resetModules();
        jest.doMock('@temporalio/testing', () => {
            throw new Error("Cannot find module '@temporalio/testing'");
        });
        const { createActivityHarness: create } = await import('../../src/testing');

        const error: any = await create(PaymentActivities, { providers: [gateway] }).catch(
            (e) => e,
        );

        expect(error.message).toContain("optional peer dependency '@temporalio/testing'");
        expect(error.cause).toBeInstanceOf(Error);
        jest.dontMock('@temporalio/testing');
    });
});

describe('createActivityHarness without options', () => {
    @Injectable()
    class Plain {
        async ping(): Promise<string> {
            return 'pong';
        }
    }

    it('works with defaults for an activity that has no dependencies', async () => {
        const harness = await createActivityHarness(Plain);

        await expect(harness.run('ping')).resolves.toBe('pong');
        await harness.close();
    });
});

describe('overrideActivity', () => {
    @Injectable()
    class Checkout {
        constructor(private readonly payments: PaymentActivities) {}
        pay() {
            return this.payments.charge(10);
        }
    }

    it('swaps the real activity for a mock in a testing module', async () => {
        const builder = Test.createTestingModule({
            providers: [Checkout, PaymentActivities, gateway],
        });
        const mock = { charge: jest.fn().mockResolvedValue('mocked') };

        const moduleRef = await overrideActivity(builder, PaymentActivities, mock).compile();

        await expect(moduleRef.get(Checkout).pay()).resolves.toBe('mocked');
        expect(mock.charge).toHaveBeenCalledWith(10);
    });
});
