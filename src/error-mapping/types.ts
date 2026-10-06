/** Any error class (constructor), used to match thrown errors. */
export type ErrorClass = new (...args: never[]) => Error;

export interface NonRetryableOptions {
    /**
     * Only errors that are an `instanceof` one of these are made non-retryable.
     * Omit to make every error thrown by the activity non-retryable.
     */
    errors?: ErrorClass[];
    /** `ApplicationFailure.type` to report. Default: the original error's `name`. */
    type?: string;
}

export interface ActivityErrorContext {
    /** Registered activity name. */
    activityName: string;
}

/**
 * Custom mapping. Return the error to throw instead (an `ApplicationFailure`, usually from
 * `ApplicationFailure.nonRetryable(...)`), or `undefined` to let the next rule decide.
 */
export type ActivityErrorMapper = (error: unknown, context: ActivityErrorContext) => unknown;

export interface ErrorMappingOptions {
    /** Runs after `@NonRetryable()` and before the default map. */
    mapper?: ActivityErrorMapper;
    /** Apply the built-in HTTP status map. Default: `true`. */
    defaultMap?: boolean;
    /**
     * Statuses that make a thrown Nest `HttpException` non-retryable.
     * Default: every 4xx except 408 (timeout) and 429 (rate limited), which are worth retrying.
     */
    nonRetryableStatuses?: number[];
}
