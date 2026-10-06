import { HttpException } from '@nestjs/common';
import { ApplicationFailure, TemporalFailure } from '@temporalio/common';
import { TEMPORAL_NON_RETRYABLE } from '../constants';
import type { ErrorMappingOptions, NonRetryableOptions } from './types';

type ActivityFn = (...args: unknown[]) => unknown;

const DEFAULT_NON_RETRYABLE = (status: number): boolean =>
    status >= 400 && status < 500 && status !== 408 && status !== 429;

/** An `ApplicationFailure` that is not retried, keeping the original error as `cause` and stack. */
export function toNonRetryable(error: unknown, type?: string): ApplicationFailure {
    const original = error instanceof Error ? error : undefined;
    const failure = ApplicationFailure.create({
        message: original?.message ?? String(error),
        type: type ?? original?.name ?? 'Error',
        nonRetryable: true,
        cause: original,
    });
    if (original?.stack) failure.stack = original.stack;
    return failure;
}

function matchesNonRetryable(error: unknown, options: NonRetryableOptions): boolean {
    if (!options.errors || options.errors.length === 0) return true;
    return options.errors.some((ErrorType) => error instanceof ErrorType);
}

function mapError(
    error: unknown,
    activityName: string,
    nonRetryable: NonRetryableOptions | undefined,
    options: ErrorMappingOptions,
): unknown {
    // Failures the SDK already understands (ApplicationFailure, CancelledFailure, ...) are final
    // as written: the author chose their retry behavior.
    if (error instanceof TemporalFailure) return error;

    if (nonRetryable && matchesNonRetryable(error, nonRetryable)) {
        return toNonRetryable(error, nonRetryable.type);
    }

    if (options.mapper) {
        const mapped = options.mapper(error, { activityName });
        if (mapped !== undefined) return mapped;
    }

    if (options.defaultMap !== false && error instanceof HttpException) {
        const status = error.getStatus();
        const isFinal = options.nonRetryableStatuses
            ? options.nonRetryableStatuses.includes(status)
            : DEFAULT_NON_RETRYABLE(status);
        if (isFinal) return toNonRetryable(error);
    }

    return error;
}

/**
 * Wrap activity handlers so thrown errors are mapped to retryable or non-retryable failures.
 * With mapping off (`undefined` / `false`) the SAME object is returned and no handler is
 * touched. Handlers are already bound to their instances, so `this` is unaffected.
 */
export function wrapActivities<T extends Record<string, Function>>(
    activities: T,
    errorMapping: boolean | ErrorMappingOptions | undefined,
): T {
    if (!errorMapping) return activities;
    const options: ErrorMappingOptions = errorMapping === true ? {} : errorMapping;

    const wrapped: Record<string, ActivityFn> = {};
    for (const [name, handler] of Object.entries(activities)) {
        const nonRetryable = Reflect.getMetadata(TEMPORAL_NON_RETRYABLE, handler) as
            NonRetryableOptions | undefined;
        const wrapper = async (...args: unknown[]) => {
            try {
                return await (handler as ActivityFn)(...args);
            } catch (error) {
                throw mapError(error, name, nonRetryable, options);
            }
        };
        Object.defineProperty(wrapper, 'name', { value: name });
        wrapped[name] = wrapper;
    }
    return wrapped as unknown as T;
}
