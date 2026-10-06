import 'reflect-metadata';
import { BadRequestException, HttpException, InternalServerErrorException } from '@nestjs/common';
import { ApplicationFailure, CancelledFailure } from '@temporalio/common';
import { Activity, ActivityMethod, NonRetryable, wrapActivities } from '../../src';
import { TemporalMetadataAccessor } from '../../src/services/temporal-metadata.service';
import { TEMPORAL_NON_RETRYABLE } from '../../src/constants';

class CardError extends Error {
    name = 'CardError';
}
class NetworkError extends Error {}

const failureOf = async (fn: () => Promise<unknown>): Promise<unknown> => {
    try {
        await fn();
    } catch (e) {
        return e;
    }
    throw new Error('expected rejection');
};

const wrapOne = (
    handler: (...a: unknown[]) => unknown,
    opts: Parameters<typeof wrapActivities>[1],
) => wrapActivities({ act: handler }, opts).act as (...a: unknown[]) => Promise<unknown>;

describe('wrapActivities', () => {
    it('disabled (undefined/false): returns the same object, handlers untouched', () => {
        const handlers = { a: async () => 1 };
        expect(wrapActivities(handlers, undefined)).toBe(handlers);
        expect(wrapActivities(handlers, false)).toBe(handlers);
        expect(wrapActivities(handlers, undefined).a).toBe(handlers.a);
    });

    it('enabled: passes arguments and results through, names the wrapper', async () => {
        const wrapped = wrapActivities({ add: async (a: number, b: number) => a + b }, true);
        await expect((wrapped.add as Function)(2, 3)).resolves.toBe(5);
        expect(wrapped.add.name).toBe('add');
    });

    it('rethrows unmapped errors as the very same object', async () => {
        const error = new NetworkError('boom');
        const thrown = await failureOf(() => wrapOne(() => Promise.reject(error), true)());
        expect(thrown).toBe(error);
    });

    it.each([
        [new BadRequestException('bad'), true],
        [new HttpException('gone', 410), true],
        [new HttpException('slow', 408), false],
        [new HttpException('limited', 429), false],
        [new InternalServerErrorException('oops'), false],
    ])('default map: %p non-retryable=%p', async (error, expected) => {
        const thrown = await failureOf(() => wrapOne(() => Promise.reject(error), true)());
        if (expected) {
            expect(thrown).toBeInstanceOf(ApplicationFailure);
            expect((thrown as ApplicationFailure).nonRetryable).toBe(true);
            expect((thrown as ApplicationFailure).cause).toBe(error);
            expect((thrown as ApplicationFailure).type).toBe(error.name);
            // Stack of the original error is kept.
            expect((thrown as Error).stack).toBe(error.stack);
        } else {
            expect(thrown).toBe(error);
        }
    });

    it('defaultMap: false leaves HttpException alone', async () => {
        const error = new BadRequestException('bad');
        await expect(
            failureOf(() => wrapOne(() => Promise.reject(error), { defaultMap: false })()),
        ).resolves.toBe(error);
    });

    it('nonRetryableStatuses overrides the default set', async () => {
        const fn = wrapOne(() => Promise.reject(new HttpException('x', 503)), {
            nonRetryableStatuses: [503],
        });
        expect(((await failureOf(fn)) as ApplicationFailure).nonRetryable).toBe(true);
        const other = wrapOne(() => Promise.reject(new BadRequestException()), {
            nonRetryableStatuses: [503],
        });
        expect(await failureOf(other)).toBeInstanceOf(BadRequestException);
    });

    it('ApplicationFailure and CancelledFailure are never remapped', async () => {
        const retryable = ApplicationFailure.retryable('keep retrying');
        const cancelled = new CancelledFailure('cancelled');
        const mapper = jest.fn(() => new Error('should not run'));
        expect(await failureOf(() => wrapOne(() => Promise.reject(retryable), { mapper })())).toBe(
            retryable,
        );
        expect(await failureOf(() => wrapOne(() => Promise.reject(cancelled), { mapper })())).toBe(
            cancelled,
        );
        expect(mapper).not.toHaveBeenCalled();
    });

    it('custom mapper wins over the default map; undefined falls through', async () => {
        const custom = ApplicationFailure.nonRetryable('mapped', 'Custom');
        const mapper = jest.fn((e: unknown) => (e instanceof NetworkError ? undefined : custom));
        const http = wrapOne(() => Promise.reject(new InternalServerErrorException()), { mapper });
        expect(await failureOf(http)).toBe(custom);
        expect(mapper).toHaveBeenCalledWith(expect.any(InternalServerErrorException), {
            activityName: 'act',
        });

        // mapper declines -> default map still applies
        const declined = wrapOne(() => Promise.reject(new BadRequestException('b')), {
            mapper: () => undefined,
        });
        expect(((await failureOf(declined)) as ApplicationFailure).nonRetryable).toBe(true);
    });

    it('wraps non-Error throws', async () => {
        const nr = wrapActivities(
            { act: Object.assign(async () => Promise.reject('plain string'), {}) },
            {
                mapper: (e) =>
                    e === 'plain string' ? ApplicationFailure.nonRetryable('s') : undefined,
            },
        ).act as Function;
        expect(((await failureOf(() => nr())) as ApplicationFailure).nonRetryable).toBe(true);
    });
});

describe('@NonRetryable', () => {
    @Activity()
    class PaymentActivities {
        @ActivityMethod()
        @NonRetryable([CardError])
        async charge(): Promise<void> {
            throw new this.errors.card('declined');
        }

        @ActivityMethod()
        @NonRetryable({ type: 'ValidationFailed' })
        async validate(): Promise<void> {
            throw new NetworkError('any error is final');
        }

        @ActivityMethod()
        async plain(): Promise<void> {
            throw new CardError('retry me');
        }

        errors = { card: CardError };
    }

    @Activity()
    @NonRetryable()
    class StrictActivities {
        @ActivityMethod()
        async run(): Promise<void> {
            throw new NetworkError('class-level');
        }
    }

    const handlersFor = (cls: new () => object) => {
        const accessor = new TemporalMetadataAccessor();
        const { methods } = accessor.extractActivityMethods(new cls());
        return Object.fromEntries([...methods].map(([name, info]) => [name, info.handler]));
    };

    it('writes metadata on the method, and on constructor + prototype for a class', () => {
        expect(
            Reflect.getMetadata(TEMPORAL_NON_RETRYABLE, PaymentActivities.prototype, 'charge'),
        ).toEqual({ errors: [CardError] });
        expect(Reflect.getMetadata(TEMPORAL_NON_RETRYABLE, StrictActivities)).toEqual({});
        expect(Reflect.getMetadata(TEMPORAL_NON_RETRYABLE, StrictActivities.prototype)).toEqual({});
    });

    it('survives binding: discovered handlers carry the options', () => {
        const handlers = handlersFor(PaymentActivities);
        expect(Reflect.getMetadata(TEMPORAL_NON_RETRYABLE, handlers.charge)).toEqual({
            errors: [CardError],
        });
        expect(Reflect.getMetadata(TEMPORAL_NON_RETRYABLE, handlers.plain)).toBeUndefined();
    });

    it('listed errors are final, other errors are not; `this` is kept', async () => {
        const wrapped = wrapActivities(handlersFor(PaymentActivities) as never, true) as Record<
            string,
            () => Promise<void>
        >;
        const charge = (await failureOf(wrapped.charge)) as ApplicationFailure;
        expect(charge).toBeInstanceOf(ApplicationFailure);
        expect(charge.nonRetryable).toBe(true);
        expect(charge.type).toBe('CardError');
        expect(charge.cause).toBeInstanceOf(CardError);

        // Same error class, no decorator -> untouched.
        expect(await failureOf(wrapped.plain)).toBeInstanceOf(CardError);
    });

    it('no `errors` list: any error is final, with a custom type', async () => {
        const wrapped = wrapActivities(handlersFor(PaymentActivities) as never, true) as Record<
            string,
            () => Promise<void>
        >;
        const failure = (await failureOf(wrapped.validate)) as ApplicationFailure;
        expect(failure.nonRetryable).toBe(true);
        expect(failure.type).toBe('ValidationFailed');
    });

    it('class-level @NonRetryable applies to every method', async () => {
        const wrapped = wrapActivities(handlersFor(StrictActivities) as never, true) as Record<
            string,
            () => Promise<void>
        >;
        expect(((await failureOf(wrapped.run)) as ApplicationFailure).nonRetryable).toBe(true);
    });

    it('does nothing when errorMapping is off (guard: handler identity)', () => {
        const handlers = handlersFor(PaymentActivities);
        expect(wrapActivities(handlers as never, undefined)).toBe(handlers);
    });
});
