import type { Logger as SdkLogger } from '@temporalio/common';
import type { TelemetryOptions } from '@temporalio/worker';

/**
 * Process-wide Temporal SDK runtime settings. The SDK allows exactly one `Runtime` per
 * process and it must be installed before the first client or worker is created.
 */
export interface TemporalRuntimeOptions {
    /**
     * Where SDK logs go. `'nest'` forwards them (including native Core logs) to the Nest
     * `Logger`; or pass any Temporal SDK `Logger`.
     */
    logger?: 'nest' | SdkLogger;
    /** Core telemetry: log filtering and metrics (e.g. a Prometheus endpoint). */
    telemetry?: TelemetryOptions;
}

/** Options for end-to-end correlation ids. */
export interface CorrelationOptions {
    /** Create an id when the caller has none. Default: a random UUID. */
    generate?: () => string;
}
