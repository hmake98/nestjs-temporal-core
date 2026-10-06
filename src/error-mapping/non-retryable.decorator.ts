import { TEMPORAL_NON_RETRYABLE } from '../constants';
import type { ErrorClass, NonRetryableOptions } from './types';

/**
 * Mark an activity (a method, or every method of a class) so that errors it throws fail the
 * activity without retries. Takes effect only when the `errorMapping` module option is on.
 *
 * ```typescript
 * @Activity()
 * export class PaymentActivities {
 *   @ActivityMethod()
 *   @NonRetryable([InvalidCardError])        // only these errors are final
 *   async charge(order: Order) { ... }
 *
 *   @ActivityMethod()
 *   @NonRetryable()                          // any error is final
 *   async validate(order: Order) { ... }
 * }
 * ```
 *
 * Metadata is written with `Reflect.defineMetadata`, on the constructor and prototype for a
 * class and on the prototype for a method, like the other decorators in this library.
 */
export function NonRetryable(
    optionsOrErrors?: NonRetryableOptions | ErrorClass[],
): MethodDecorator & ClassDecorator {
    const options: NonRetryableOptions = Array.isArray(optionsOrErrors)
        ? { errors: optionsOrErrors }
        : (optionsOrErrors ?? {});

    return ((target: object, propertyKey?: string | symbol) => {
        if (propertyKey === undefined) {
            Reflect.defineMetadata(TEMPORAL_NON_RETRYABLE, options, target);
            Reflect.defineMetadata(
                TEMPORAL_NON_RETRYABLE,
                options,
                (target as { prototype: object }).prototype,
            );
            return;
        }
        Reflect.defineMetadata(TEMPORAL_NON_RETRYABLE, options, target, propertyKey);
    }) as MethodDecorator & ClassDecorator;
}

/** Read the `@NonRetryable()` options of a method, falling back to its class. */
export function getNonRetryableOptions(
    prototype: object,
    methodName: string,
): NonRetryableOptions | undefined {
    return (
        (Reflect.getMetadata(TEMPORAL_NON_RETRYABLE, prototype, methodName) as
            NonRetryableOptions | undefined) ??
        (Reflect.getMetadata(TEMPORAL_NON_RETRYABLE, prototype) as NonRetryableOptions | undefined)
    );
}

/**
 * Bind an activity method to its instance and carry its `@NonRetryable()` options onto the
 * bound function, which is what the worker registers (a bound function loses the metadata).
 */
export function bindActivityHandler(
    prototype: Record<string, unknown>,
    methodName: string,
    instance: unknown,
): (...args: unknown[]) => unknown {
    const bound = (prototype[methodName] as Function).bind(instance);
    const options = getNonRetryableOptions(prototype, methodName);
    if (options) Reflect.defineMetadata(TEMPORAL_NON_RETRYABLE, options, bound);
    return bound;
}
