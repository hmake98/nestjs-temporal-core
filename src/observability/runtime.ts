import { Logger } from '@nestjs/common';
import type { Logger as SdkLogger, LogLevel, LogMetadata } from '@temporalio/common';
import { Runtime } from '@temporalio/worker';
import { redact } from '../utils/redact';
import { TemporalRuntimeOptions } from './types';

/** Adapt the Nest `Logger` to the Temporal SDK `Logger` interface. */
export function createNestSdkLogger(context = 'TemporalSDK'): SdkLogger {
    const nest = new Logger(context);
    const format = (message: string, meta?: LogMetadata): string =>
        meta && Object.keys(meta).length > 0
            ? `${message} ${JSON.stringify(redact(meta))}`
            : message;

    const write = (level: LogLevel, message: string, meta?: LogMetadata): void => {
        const text = format(message, meta);
        switch (level) {
            case 'TRACE':
                return nest.verbose(text);
            case 'DEBUG':
                return nest.debug(text);
            case 'INFO':
                return nest.log(text);
            case 'WARN':
                return nest.warn(text);
            default:
                return nest.error(text);
        }
    };

    return {
        log: write,
        trace: (message, meta) => write('TRACE', message, meta),
        debug: (message, meta) => write('DEBUG', message, meta),
        info: (message, meta) => write('INFO', message, meta),
        warn: (message, meta) => write('WARN', message, meta),
        error: (message, meta) => write('ERROR', message, meta),
    };
}

export type RuntimeInstallResult =
    /** No `runtime` option was given. */
    | 'none'
    | 'installed'
    /** A previous call already handled it. */
    | 'skipped'
    /** The SDK Runtime already existed, so the options could not be applied. */
    | 'late';

let handled = false;

/** @internal Test hook: forget that the runtime option was processed. */
export function resetRuntimeInstallState(): void {
    handled = false;
}

/**
 * Install the process-wide SDK `Runtime` from the `runtime` module option. Idempotent: the
 * first call wins, later calls are no-ops. Must run before any client or worker exists; if
 * the SDK already created its default Runtime, logs a warning and leaves it untouched.
 */
export function installRuntime(
    options: TemporalRuntimeOptions | undefined,
    log: { warn(message: string): void } = new Logger('TemporalRuntime'),
): RuntimeInstallResult {
    if (!options) {
        return 'none';
    }
    if (handled) {
        return 'skipped';
    }
    handled = true;

    const logger = options.logger === 'nest' ? createNestSdkLogger() : options.logger;
    const forwardNative = options.logger === 'nest' && !options.telemetry?.logging;
    const telemetryOptions = forwardNative
        ? { ...options.telemetry, logging: { forward: {} } }
        : options.telemetry;

    try {
        Runtime.install({
            ...(logger && { logger }),
            ...(telemetryOptions && { telemetryOptions }),
        });
        return 'installed';
    } catch (error) {
        log.warn(
            'The `runtime` option was ignored: the Temporal SDK Runtime already exists. ' +
                'Install it before any client or worker is created ' +
                `(${error instanceof Error ? error.message : String(error)})`,
        );
        return 'late';
    }
}
