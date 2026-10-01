/**
 * Error thrown by the client, facade and schedule services when an underlying
 * Temporal SDK call fails. Message text is unchanged from earlier releases;
 * the original error is now preserved on `cause` so details are not lost.
 */
export class TemporalClientError extends Error {
    /** The original error (or thrown value) that triggered this error. */
    readonly cause?: unknown;
    /** Constructor name of the original error, e.g. `ServiceError`. */
    readonly originalName?: string;
    /** gRPC status code of the original error, when it carried one. */
    readonly grpcCode?: number;
    /** gRPC details string of the original error, when it carried one. */
    readonly grpcDetails?: string;

    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = 'TemporalClientError';
        Object.setPrototypeOf(this, new.target.prototype);

        if (cause !== undefined) {
            this.cause = cause;
            if (cause instanceof Error) {
                this.originalName = cause.constructor?.name || cause.name;
            }
            if (cause !== null && typeof cause === 'object') {
                const { code, details } = cause as { code?: unknown; details?: unknown };
                if (typeof code === 'number') this.grpcCode = code;
                if (typeof details === 'string') this.grpcDetails = details;
            }
        }
    }
}

/** Build a {@link TemporalClientError} that keeps `cause` attached. */
export function wrapError(message: string, cause?: unknown): TemporalClientError {
    return new TemporalClientError(message, cause);
}

/**
 * Normalize a thrown value to an `Error`. Errors pass through untouched;
 * anything else is wrapped with `message` and the original value as `cause`.
 */
export function toError(error: unknown, message = 'Unknown error'): Error {
    return error instanceof Error ? error : wrapError(message, error);
}
