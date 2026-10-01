import { Logger } from '@nestjs/common';
import { LogLevel, LoggerConfig, GlobalLoggerConfig } from '../interfaces';
import { getCorrelationId } from '../observability/correlation';
import { redact } from './redact';

/**
 * Optimized singleton logger manager with performance improvements.
 * Uses lazy initialization and caching for better performance.
 */
export class TemporalLoggerManager {
    private static instance: TemporalLoggerManager;
    private static readonly DEFAULT_CONFIG: GlobalLoggerConfig = {
        enableLogger: true,
        logLevel: 'info',
        appName: 'NestJS-Temporal',
    };

    private globalConfig: GlobalLoggerConfig = TemporalLoggerManager.DEFAULT_CONFIG;
    private readonly loggerCache = new Map<string, TemporalLogger>();

    static getInstance(): TemporalLoggerManager {
        return (TemporalLoggerManager.instance ??= new TemporalLoggerManager());
    }

    /**
     * Configure global logger settings and clear cache if needed.
     */
    configure(config: GlobalLoggerConfig): void {
        if (!config || typeof config !== 'object') {
            return;
        }
        const hasChanges = Object.keys(config).some(
            (key) =>
                this.globalConfig[key as keyof GlobalLoggerConfig] !==
                config[key as keyof GlobalLoggerConfig],
        );

        if (hasChanges) {
            this.globalConfig = { ...this.globalConfig, ...config };
            this.loggerCache.clear(); // Clear cache when config changes
        }
    }

    /**
     * Get current global configuration (readonly).
     */
    getGlobalConfig(): Readonly<GlobalLoggerConfig> {
        return this.globalConfig;
    }

    /**
     * Create or retrieve cached logger instance.
     */
    createLogger(context: string, localConfig: LoggerConfig = {}): TemporalLogger {
        const cacheKey = this.getCacheKey(context, localConfig);

        if (this.loggerCache.has(cacheKey)) {
            return this.loggerCache.get(cacheKey)!;
        }

        const mergedConfig = { ...this.globalConfig, ...localConfig };
        const logger = new TemporalLogger(context, mergedConfig);
        this.loggerCache.set(cacheKey, logger);
        return logger;
    }

    /**
     * Generate cache key for logger instances.
     */
    private getCacheKey(context: string, localConfig: LoggerConfig): string {
        return `${context}:${localConfig?.enableLogger ?? ''}:${localConfig?.logLevel ?? ''}:${localConfig?.muteErrors ?? ''}`;
    }

    /**
     * Clear logger cache (useful for testing).
     */
    clearCache(): void {
        this.loggerCache.clear();
    }
}

/**
 * Optimized TemporalLogger with improved performance and reduced memory usage.
 * Uses static lookup tables and optimized level checking.
 */
export class TemporalLogger {
    private static readonly LOG_LEVELS: readonly LogLevel[] = [
        'error',
        'warn',
        'info',
        'debug',
        'verbose',
    ];
    private static readonly LEVEL_INDICES = new Map<LogLevel, number>(
        TemporalLogger.LOG_LEVELS.map((level, index) => [level, index]),
    );

    private readonly nestLogger: Logger;
    private readonly config: Required<Omit<LoggerConfig, 'redactKeys'>>;
    private readonly redactKeys: readonly string[];
    private readonly context: string;
    private readonly currentLevelIndex: number;

    constructor(context: string, config: LoggerConfig = {}) {
        this.context = context;
        this.nestLogger = new Logger(context);
        const logLevel =
            config.logLevel && TemporalLogger.LEVEL_INDICES.has(config.logLevel)
                ? config.logLevel
                : 'info';
        this.redactKeys = config.redactKeys ?? [];
        this.config = {
            enableLogger: config.enableLogger ?? true,
            logLevel,
            muteErrors: config.muteErrors ?? false,
        };
        this.currentLevelIndex = TemporalLogger.LEVEL_INDICES.get(this.config.logLevel) ?? 2;
    }

    /**
     * Optimized level checking with cached index lookup.
     */
    private shouldLog(level: LogLevel): boolean {
        if (!this.config.enableLogger) return false;

        const requestedLevelIndex = TemporalLogger.LEVEL_INDICES.get(level);
        return requestedLevelIndex !== undefined && requestedLevelIndex <= this.currentLevelIndex;
    }

    /**
     * Prepare a message for output: structured values are redacted, and strings are tagged
     * with the current correlation id when one is active.
     */
    private format(message: unknown): unknown {
        if (message !== null && typeof message === 'object' && !(message instanceof Error)) {
            message = redact(message, this.redactKeys);
        }
        const correlationId = getCorrelationId();
        return correlationId && typeof message === 'string'
            ? `${message} [correlationId=${correlationId}]`
            : message;
    }

    /**
     * Optimized error logging with improved trace handling.
     * When `muteErrors` is enabled, error messages are downgraded to debug level.
     */
    error(message: unknown, trace?: string | Error, context?: string): void {
        if (this.config.muteErrors) {
            if (this.shouldLog('debug')) {
                this.nestLogger.debug(
                    `[muted error] ${this.format(message)}`,
                    context ?? this.context,
                );
            }
            return;
        }
        if (this.shouldLog('error')) {
            const stackTrace = trace instanceof Error ? trace.stack : trace;
            this.nestLogger.error(this.format(message), stackTrace, context ?? this.context);
        }
    }

    /**
     * Optimized warning logging.
     */
    warn(message: unknown, context?: string): void {
        if (this.shouldLog('warn')) {
            this.nestLogger.warn(this.format(message), context ?? this.context);
        }
    }

    /**
     * Optimized info logging.
     */
    log(message: unknown, context?: string): void {
        if (this.shouldLog('info')) {
            this.nestLogger.log(this.format(message), context ?? this.context);
        }
    }

    /**
     * Alias for log method.
     */
    info(message: unknown, context?: string): void {
        this.log(message, context);
    }

    /**
     * Optimized debug logging.
     */
    debug(message: unknown, context?: string): void {
        if (this.shouldLog('debug')) {
            this.nestLogger.debug(this.format(message), context ?? this.context);
        }
    }

    /**
     * Optimized verbose logging.
     */
    verbose(message: unknown, context?: string): void {
        if (this.shouldLog('verbose')) {
            this.nestLogger.verbose(this.format(message), context ?? this.context);
        }
    }

    /**
     * Optimized execution time logging.
     */
    logExecutionTime(methodName: string, startTime: number, context?: string): void {
        if (this.shouldLog('debug')) {
            const executionTime = Date.now() - startTime;
            this.nestLogger.debug(
                `${methodName} executed in ${executionTime}ms`,
                context ?? this.context,
            );
        }
    }

    /**
     * Optimized level-based logging with method lookup.
     */
    logWithLevel(level: LogLevel, message: unknown, context?: string): void {
        if (!this.shouldLog(level)) return;

        const methods = {
            error: () => this.error(message, undefined, context ?? this.context),
            warn: () => this.warn(message, context ?? this.context),
            info: () => this.log(message, context ?? this.context),
            debug: () => this.debug(message, context ?? this.context),
            verbose: () => this.verbose(message, context ?? this.context),
        } as const;

        methods[level]();
    }

    /**
     * Create optimized child logger with combined context.
     */
    createChildLogger(childContext: string, config?: LoggerConfig): TemporalLogger {
        const combinedContext = `${this.context}:${childContext}`;
        const childConfig = config ? { ...this.config, ...config } : this.config;
        return new TemporalLogger(combinedContext, childConfig);
    }

    /**
     * Get readonly logger configuration.
     */
    getConfig(): Readonly<Required<Omit<LoggerConfig, 'redactKeys'>>> {
        return this.config;
    }

    /**
     * Check if logging is enabled.
     */
    isEnabled(): boolean {
        return this.config.enableLogger;
    }

    /**
     * Get current log level.
     */
    getLogLevel(): LogLevel {
        return this.config.logLevel;
    }

    /**
     * Get logger context.
     */
    getContext(): string {
        return this.context;
    }

    /**
     * Check if specific level is enabled.
     */
    isLevelEnabled(level: LogLevel): boolean {
        return this.shouldLog(level);
    }

    /**
     * Check if error muting is enabled.
     */
    isMuted(): boolean {
        return this.config.muteErrors;
    }
}

/**
 * Optimized factory function for creating centrally managed loggers.
 * Uses singleton pattern with caching for better performance.
 */
export function createLogger(context: string, config?: LoggerConfig): TemporalLogger {
    return TemporalLoggerManager.getInstance().createLogger(context, config);
}

/**
 * Utility functions for commonly used logging patterns
 */
export class LoggerUtils {
    /**
     * Log service initialization
     */
    static logServiceInit(logger: TemporalLogger, serviceName: string, config?: unknown): void {
        logger.log(`Initializing ${serviceName}...`);
        if (config && logger.getLogLevel() === 'debug') {
            logger.debug(`${serviceName} configuration:`, JSON.stringify(redact(config), null, 2));
        }
    }

    /**
     * Log service shutdown
     */
    static logServiceShutdown(logger: TemporalLogger, serviceName: string): void {
        logger.log(`Shutting down ${serviceName}...`);
    }

    /**
     * Log connection establishment
     */
    static logConnection(
        logger: TemporalLogger,
        target: string,
        success: boolean,
        error?: Error,
    ): void {
        if (success) {
            logger.log(`Successfully connected to ${target}`);
        } else {
            logger.error(`Failed to connect to ${target}`, error);
        }
    }

    /**
     * Log operation result
     */
    static logOperation(
        logger: TemporalLogger,
        operation: string,
        success: boolean,
        details?: string,
        error?: Error,
    ): void {
        if (success) {
            logger.log(`${operation} completed successfully${details ? `: ${details}` : ''}`);
        } else {
            logger.error(`${operation} failed${details ? `: ${details}` : ''}`, error);
        }
    }
}
