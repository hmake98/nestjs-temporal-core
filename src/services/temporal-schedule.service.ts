import { Injectable, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import {
    Client,
    ScheduleClient,
    ScheduleHandle,
    ScheduleNotFoundError,
    ScheduleOverlapPolicy,
} from '@temporalio/client';
import { Duration, SearchAttributes } from '@temporalio/common';
import { TEMPORAL_MODULE_OPTIONS, TEMPORAL_CLIENT } from '../constants';
import {
    TemporalOptions,
    ScheduleCreationOptions,
    ScheduleCreationResult,
    ScheduleUpsertResult,
    ScheduleRetrievalResult,
    SchedulePauseResult,
    ScheduleUnpauseResult,
    ScheduleTriggerResult,
    ScheduleDeletionResult,
    ScheduleUpdateResult,
    ScheduleDescribeResult,
    ScheduleListResult,
    ScheduleServiceStatus,
    ScheduleServiceHealth,
    ScheduleServiceStats,
    ScheduleDiscoveryResult,
    ScheduleRegistrationResult,
    ScheduleClientInitResult,
    ScheduleWorkflowOptions,
    ScheduleSpecBuilderResult,
    ScheduleIntervalParseResult,
    ScheduleWorkflowAction,
    ScheduleOptions,
    ScheduleSpec,
    ScheduleDescription,
    ScheduleUpdateOptions,
    ListScheduleOptions,
    TemporalOverlapPolicy,
} from '../interfaces';
import { TemporalMetadataAccessor } from './temporal-metadata.service';
import { toError } from '../errors';
import { createLogger, TemporalLogger } from '../utils/logger';

/**
 * Service for managing Temporal schedules including creating, updating, and monitoring scheduled workflows
 */
@Injectable()
export class TemporalScheduleService implements OnModuleInit, OnModuleDestroy {
    private readonly logger: TemporalLogger;
    private scheduleClient?: ScheduleClient;
    private scheduleHandles = new Map<string, ScheduleHandle>();
    private isInitialized = false;

    constructor(
        @Inject(TEMPORAL_MODULE_OPTIONS)
        private readonly options: TemporalOptions,
        @Inject(TEMPORAL_CLIENT)
        private readonly client: Client | null,
        private readonly discoveryService: DiscoveryService,
        private readonly metadataAccessor: TemporalMetadataAccessor,
    ) {
        this.logger = createLogger(TemporalScheduleService.name, {
            enableLogger: options.enableLogger,
            logLevel: options.logLevel,
        });
    }

    /**
     * Extract error message from various error types
     */
    private extractErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        if (typeof error === 'string') {
            return error;
        }
        return 'Unknown error';
    }

    /**
     * Normalize a user-facing ScheduleOptions (which may include deprecated
     * compat fields like `spec.timezones` or `action.retryPolicy`) into the
     * exact shape consumed by `ScheduleClient.create()`.
     *
     * Rules:
     * - `spec.timezones[0]` promotes to `spec.timezone` when `timezone` absent.
     * - `action.retryPolicy` promotes to `action.retry` when `retry` absent.
     * - `searchAttributes` is passed through as the deprecated-but-valid
     *   `SearchAttributes` SDK shape.
     */
    private normalizeScheduleOptions(opts: ScheduleOptions): ScheduleOptions {
        const { timezones, ...specRest } = opts.spec as ScheduleSpec;
        const sdkSpec = {
            ...specRest,
            ...(timezones && timezones.length > 0 && !specRest.timezone
                ? { timezone: timezones[0] }
                : {}),
        } as ScheduleOptions['spec'];

        const action = opts.action as ScheduleWorkflowAction;
        const { retryPolicy, ...actionRest } = action;
        const sdkAction = {
            ...actionRest,
            ...(retryPolicy && !actionRest.retry ? { retry: retryPolicy } : {}),
        } as ScheduleOptions['action'];

        return {
            ...opts,
            spec: sdkSpec,
            action: sdkAction,
        };
    }

    /**
     * Initialize the schedule service
     */
    async onModuleInit(): Promise<void> {
        try {
            this.logger.verbose('Initializing Temporal Schedule Service...');
            await this.initializeScheduleClient();
            await this.discoverAndRegisterSchedules();
            this.isInitialized = true;
            this.logger.info(
                `Schedule Service initialized (${this.scheduleHandles.size} schedules)`,
            );
        } catch (error) {
            this.logger.error(
                `Failed to initialize Temporal Schedule Service: ${this.extractErrorMessage(
                    error,
                )}`,
                error,
            );
            throw error;
        }
    }

    /**
     * Cleanup on module destroy
     */
    async onModuleDestroy(): Promise<void> {
        try {
            const count = this.scheduleHandles.size;
            this.scheduleHandles.clear();
            this.isInitialized = false;
            this.logger.info(
                `Schedule Service shut down (${count} schedule${count === 1 ? '' : 's'} cleared)`,
            );
        } catch (error) {
            this.logger.error('Error during schedule service shutdown', error);
        }
    }

    /**
     * Initialize the schedule client
     */
    private async initializeScheduleClient(): Promise<ScheduleClientInitResult> {
        try {
            // Check if the client has schedule support
            if (this.client?.schedule) {
                this.scheduleClient = this.client.schedule;
                this.logger.verbose('Schedule client initialized from existing client');
                return {
                    success: true,
                    client: this.scheduleClient,
                    source: 'existing',
                };
            } else {
                // Try to create a new schedule client if none exists
                try {
                    // Type assertion: ScheduleClient expects connection to match its internal type

                    this.scheduleClient = new ScheduleClient({
                        connection: this.client?.connection,
                        namespace: this.options.connection?.namespace || 'default',
                    });
                    this.logger.verbose('Schedule client initialized successfully');
                    return {
                        success: true,
                        client: this.scheduleClient,
                        source: 'new',
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    this.logger.warn(`Schedule client not available: ${errorMessage}`);
                    this.scheduleClient = undefined;
                    return {
                        success: false,
                        error: toError(error, errorMessage),
                        source: 'none',
                    };
                }
            }
        } catch (error) {
            this.logger.error('Failed to initialize schedule client', error);
            this.scheduleClient = undefined;
            return {
                success: false,
                error: toError(error, this.extractErrorMessage(error)),
                source: 'none',
            };
        }
    }

    /**
     * Discover and register scheduled workflows
     */
    private async discoverAndRegisterSchedules(): Promise<ScheduleDiscoveryResult> {
        const startTime = Date.now();
        const discoveredCount = 0;

        try {
            // Skip automatic discovery for now since schedule decorators are not implemented
            // This prevents the gRPC errors from trying to create schedules for every provider
            this.logger.verbose('Schedule discovery skipped - decorators not implemented');

            const duration = Date.now() - startTime;
            this.logger.verbose(`Discovered ${discoveredCount} scheduled workflows`);

            return {
                success: true,
                discoveredCount,
                errors: [],
                duration,
            };
        } catch (error) {
            this.logger.error('Failed to discover schedules', error);
            return {
                success: false,
                discoveredCount: 0,
                errors: [{ schedule: 'discovery', error: this.extractErrorMessage(error) }],
                duration: Date.now() - startTime,
            };
        }
    }

    /**
     * Register a scheduled workflow
     */
    private async registerScheduledWorkflow(
        instance: unknown,
        metatype: Function,
        scheduleMetadata: Record<string, unknown>,
    ): Promise<ScheduleRegistrationResult> {
        try {
            const scheduleId =
                (scheduleMetadata.scheduleId as string) || `${metatype.name}-schedule`;
            const workflowType = (scheduleMetadata.workflowType as string) || metatype.name;

            const scheduleSpecResult = this.buildScheduleSpec(scheduleMetadata);
            if (!scheduleSpecResult.success) {
                return {
                    success: false,
                    scheduleId,
                    error: scheduleSpecResult.error,
                };
            }

            const workflowOptions = this.buildWorkflowOptions(scheduleMetadata);

            // Create the schedule (user-facing shape, may include deprecated fields).
            // Normalized to the SDK shape by `normalizeScheduleOptions` before sending.
            const action: ScheduleWorkflowAction = {
                type: 'startWorkflow',
                workflowType,
                taskQueue: (scheduleMetadata.taskQueue as string) || 'default',
                args: (scheduleMetadata.args as unknown[]) || [],
                ...workflowOptions,
            };

            const sdkOptions = this.normalizeScheduleOptions({
                scheduleId,
                spec: scheduleSpecResult.spec as ScheduleOptions['spec'],
                action,
                memo: (scheduleMetadata.memo as Record<string, unknown>) || undefined,
                searchAttributes:
                    (scheduleMetadata.searchAttributes as SearchAttributes) || undefined,
            });

            const scheduleHandle = await this.scheduleClient!.create(sdkOptions);

            this.scheduleHandles.set(scheduleId, scheduleHandle);

            this.logger.debug(
                `Registered scheduled workflow: ${scheduleId} with type: ${workflowType}`,
            );

            return {
                success: true,
                scheduleId,
                handle: scheduleHandle,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(`Failed to register scheduled workflow: ${errorMessage}`, error);
            return {
                success: false,
                scheduleId: (scheduleMetadata.scheduleId as string) || `${metatype.name}-schedule`,
                error: toError(error, errorMessage),
            };
        }
    }

    /**
     * Build schedule specification from metadata
     */
    private buildScheduleSpec(
        scheduleMetadata: Record<string, unknown>,
    ): ScheduleSpecBuilderResult {
        try {
            const spec: Partial<ScheduleSpec> = {};

            // Handle cron schedules
            if (scheduleMetadata.cron) {
                spec.cronExpressions = (
                    Array.isArray(scheduleMetadata.cron)
                        ? scheduleMetadata.cron
                        : [scheduleMetadata.cron]
                ) as string[];
            }

            // Handle interval schedules
            if (scheduleMetadata.interval) {
                const intervals = (
                    Array.isArray(scheduleMetadata.interval)
                        ? scheduleMetadata.interval
                        : [scheduleMetadata.interval]
                ) as Array<string | number>;
                const parsedIntervals = intervals
                    .map((interval) => {
                        const result = this.parseInterval(interval);
                        return result.success ? result.interval : null;
                    })
                    .filter((interval): interval is { every: Duration } => interval !== null);

                if (parsedIntervals.length > 0) {
                    spec.intervals = parsedIntervals;
                }
            }

            // Handle calendar schedules
            if (scheduleMetadata.calendar) {
                spec.calendars = (
                    Array.isArray(scheduleMetadata.calendar)
                        ? scheduleMetadata.calendar
                        : [scheduleMetadata.calendar]
                ) as ScheduleSpec['calendars'];
            }

            // Handle timezone
            if (scheduleMetadata.timezone) {
                spec.timezone = scheduleMetadata.timezone as string;
            }

            // Handle jitter
            if (scheduleMetadata.jitter) {
                spec.jitter = scheduleMetadata.jitter as Duration;
            }

            return {
                success: true,
                spec,
            };
        } catch (error) {
            return {
                success: false,
                error: toError(error),
            };
        }
    }

    /**
     * Build workflow options from metadata
     */
    private buildWorkflowOptions(
        scheduleMetadata: Record<string, unknown>,
    ): ScheduleWorkflowOptions {
        const options: ScheduleWorkflowOptions = {};

        if (scheduleMetadata.taskQueue) {
            options.taskQueue = scheduleMetadata.taskQueue as string;
        }

        if (scheduleMetadata.workflowId) {
            options.workflowId = scheduleMetadata.workflowId as string;
        }

        if (scheduleMetadata.workflowExecutionTimeout) {
            options.workflowExecutionTimeout =
                scheduleMetadata.workflowExecutionTimeout as Duration;
        }

        if (scheduleMetadata.workflowRunTimeout) {
            options.workflowRunTimeout = scheduleMetadata.workflowRunTimeout as Duration;
        }

        if (scheduleMetadata.workflowTaskTimeout) {
            options.workflowTaskTimeout = scheduleMetadata.workflowTaskTimeout as Duration;
        }

        if (scheduleMetadata.retryPolicy) {
            options.retryPolicy =
                scheduleMetadata.retryPolicy as import('@temporalio/common').RetryPolicy;
        }

        if (scheduleMetadata.args) {
            options.args = scheduleMetadata.args as unknown[];
        }

        return options;
    }

    /**
     * Parse interval string to Temporal interval format
     */
    private parseInterval(interval: string | number): ScheduleIntervalParseResult {
        try {
            if (typeof interval === 'number') {
                return {
                    success: true,
                    interval: { every: `${interval}ms` as Duration },
                };
            }

            // Handle various interval formats
            const intervalStr = interval.toString().toLowerCase();

            if (intervalStr.includes('ms')) {
                return {
                    success: true,
                    interval: { every: intervalStr as Duration },
                };
            }

            if (intervalStr.includes('s')) {
                return {
                    success: true,
                    interval: { every: intervalStr as Duration },
                };
            }

            if (intervalStr.includes('m')) {
                return {
                    success: true,
                    interval: { every: intervalStr as Duration },
                };
            }

            if (intervalStr.includes('h')) {
                return {
                    success: true,
                    interval: { every: intervalStr as Duration },
                };
            }

            // Default to milliseconds if no unit specified
            return {
                success: true,
                interval: { every: `${interval}ms` as Duration },
            };
        } catch (error) {
            return {
                success: false,
                error: toError(error),
            };
        }
    }

    /**
     * Translate user-facing `ScheduleCreationOptions` into the SDK's native
     * `ScheduleOptions` shape, applying the same policy/state normalization
     * used by both `createSchedule` and `upsertSchedule`.
     */
    private buildScheduleOptions(options: ScheduleCreationOptions): ScheduleOptions {
        const policies: NonNullable<ScheduleOptions['policies']> = {};
        if (options.overlapPolicy) {
            policies.overlap =
                options.overlapPolicy.toUpperCase() as ScheduleOptions['policies'] extends {
                    overlap?: infer O;
                }
                    ? O
                    : never;
        }
        if (options.catchupWindow) {
            policies.catchupWindow = options.catchupWindow as Duration;
        }
        if (options.pauseOnFailure !== undefined) {
            policies.pauseOnFailure = options.pauseOnFailure;
        }

        // `state.note` carries the (previously-ignored) `description` field.
        // `limitedActions` is intentionally NOT forwarded to `state.remainingActions`
        // to preserve prior no-op behavior (was a top-level field SDK ignored).
        const state: NonNullable<ScheduleOptions['state']> = {};
        if (options.paused !== undefined) state.paused = options.paused;
        if (options.description) state.note = options.description;

        return this.normalizeScheduleOptions({
            scheduleId: options.scheduleId,
            spec: options.spec as ScheduleOptions['spec'],
            action: options.action,
            ...(options.memo && { memo: options.memo }),
            ...(options.searchAttributes && {
                searchAttributes: options.searchAttributes as SearchAttributes,
            }),
            ...(Object.keys(policies).length > 0 && { policies }),
            ...(Object.keys(state).length > 0 && { state }),
        });
    }

    /**
     * Create a new schedule
     */
    async createSchedule(options: ScheduleCreationOptions): Promise<ScheduleCreationResult> {
        this.ensureInitialized();

        try {
            const scheduleOptions = this.buildScheduleOptions(options);
            const scheduleHandle = await this.scheduleClient!.create(scheduleOptions);
            this.scheduleHandles.set(options.scheduleId, scheduleHandle);

            this.logger.info(`Created schedule '${options.scheduleId}'`);

            return {
                success: true,
                scheduleId: options.scheduleId,
                handle: scheduleHandle,
            };
        } catch (error) {
            this.logger.error(`Failed to create schedule '${options.scheduleId}'`, error);
            return {
                success: false,
                scheduleId: options.scheduleId,
                error: toError(error, this.extractErrorMessage(error)),
            };
        }
    }

    /**
     * Create a schedule, or update it in place if a schedule with the same
     * `scheduleId` already exists — avoids the SDK's `ScheduleAlreadyRunning`
     * error on repeated bootstraps (e.g. registering schedules on every app start).
     *
     * @example
     * ```typescript
     * await scheduleService.upsertSchedule({
     *   scheduleId: 'daily-report',
     *   spec: { cronExpressions: ['0 9 * * *'] },
     *   action: { type: 'startWorkflow', workflowType: 'sendDailyReport', taskQueue: 'reports' },
     * });
     * ```
     */
    async upsertSchedule(options: ScheduleCreationOptions): Promise<ScheduleUpsertResult> {
        this.ensureInitialized();

        try {
            const handle = this.resolveScheduleHandle(options.scheduleId);

            let exists = true;
            try {
                await handle.describe();
            } catch (error) {
                if (error instanceof ScheduleNotFoundError) {
                    exists = false;
                } else {
                    throw error;
                }
            }

            if (!exists) {
                const result = await this.createSchedule(options);
                return { ...result, action: 'created' };
            }

            // `ScheduleUpdateOptions` omits `scheduleId`/`memo` (memo is immutable after creation).
            const {
                scheduleId: _scheduleId,
                memo: _memo,
                ...updateOptions
            } = this.buildScheduleOptions(options);
            await handle.update(() => updateOptions as ScheduleUpdateOptions);
            this.scheduleHandles.set(options.scheduleId, handle);

            this.logger.info(`Upserted (updated) schedule '${options.scheduleId}'`);

            return {
                success: true,
                scheduleId: options.scheduleId,
                handle,
                action: 'updated',
            };
        } catch (error) {
            this.logger.error(`Failed to upsert schedule '${options.scheduleId}'`, error);
            return {
                success: false,
                scheduleId: options.scheduleId,
                error: toError(error, this.extractErrorMessage(error)),
            };
        }
    }

    /**
     * Get a schedule handle
     */
    async getSchedule(scheduleId: string): Promise<ScheduleRetrievalResult> {
        this.ensureInitialized();

        try {
            // Check local cache first
            let scheduleHandle = this.scheduleHandles.get(scheduleId);

            if (!scheduleHandle) {
                // Try to get from Temporal
                scheduleHandle = this.scheduleClient!.getHandle(scheduleId);
                this.scheduleHandles.set(scheduleId, scheduleHandle);
            }

            return {
                success: true,
                handle: scheduleHandle,
            };
        } catch (error) {
            this.logger.error(`Failed to get schedule '${scheduleId}'`, error);
            return {
                success: false,
                error: toError(error, this.extractErrorMessage(error)),
            };
        }
    }

    /**
     * Resolve a schedule handle by ID, using the local cache first and falling
     * back to `ScheduleClient.getHandle()`.
     */
    private resolveScheduleHandle(scheduleId: string): ScheduleHandle {
        let scheduleHandle = this.scheduleHandles.get(scheduleId);
        if (!scheduleHandle) {
            scheduleHandle = this.scheduleClient!.getHandle(scheduleId);
            this.scheduleHandles.set(scheduleId, scheduleHandle);
        }
        return scheduleHandle;
    }

    /**
     * Pause a schedule so it no longer takes actions.
     *
     * @example
     * ```typescript
     * await scheduleService.pauseSchedule('daily-report', 'investigating an incident');
     * ```
     */
    async pauseSchedule(scheduleId: string, note?: string): Promise<SchedulePauseResult> {
        this.ensureInitialized();

        try {
            const handle = this.resolveScheduleHandle(scheduleId);
            await handle.pause(note);

            this.logger.info(`Paused schedule '${scheduleId}'`);
            return { success: true, scheduleId };
        } catch (error) {
            this.logger.error(`Failed to pause schedule '${scheduleId}'`, error);
            return {
                success: false,
                scheduleId,
                error: toError(error, this.extractErrorMessage(error)),
            };
        }
    }

    /**
     * Unpause a schedule, resuming its actions.
     *
     * @example
     * ```typescript
     * await scheduleService.unpauseSchedule('daily-report');
     * ```
     */
    async unpauseSchedule(scheduleId: string, note?: string): Promise<ScheduleUnpauseResult> {
        this.ensureInitialized();

        try {
            const handle = this.resolveScheduleHandle(scheduleId);
            await handle.unpause(note);

            this.logger.info(`Unpaused schedule '${scheduleId}'`);
            return { success: true, scheduleId };
        } catch (error) {
            this.logger.error(`Failed to unpause schedule '${scheduleId}'`, error);
            return {
                success: false,
                scheduleId,
                error: toError(error, this.extractErrorMessage(error)),
            };
        }
    }

    /**
     * Trigger an immediate action for a schedule, outside its normal specification.
     *
     * @example
     * ```typescript
     * await scheduleService.triggerSchedule('daily-report', 'ALLOW_ALL');
     * ```
     */
    async triggerSchedule(
        scheduleId: string,
        overlapPolicy?: TemporalOverlapPolicy,
    ): Promise<ScheduleTriggerResult> {
        this.ensureInitialized();

        try {
            const handle = this.resolveScheduleHandle(scheduleId);
            await handle.trigger(overlapPolicy as ScheduleOverlapPolicy | undefined);

            this.logger.info(`Triggered schedule '${scheduleId}'`);
            return { success: true, scheduleId };
        } catch (error) {
            this.logger.error(`Failed to trigger schedule '${scheduleId}'`, error);
            return {
                success: false,
                scheduleId,
                error: toError(error, this.extractErrorMessage(error)),
            };
        }
    }

    /**
     * Delete a schedule.
     *
     * @example
     * ```typescript
     * await scheduleService.deleteSchedule('daily-report');
     * ```
     */
    async deleteSchedule(scheduleId: string): Promise<ScheduleDeletionResult> {
        this.ensureInitialized();

        try {
            const handle = this.resolveScheduleHandle(scheduleId);
            await handle.delete();
            this.scheduleHandles.delete(scheduleId);

            this.logger.info(`Deleted schedule '${scheduleId}'`);
            return { success: true, scheduleId };
        } catch (error) {
            this.logger.error(`Failed to delete schedule '${scheduleId}'`, error);
            return {
                success: false,
                scheduleId,
                error: toError(error, this.extractErrorMessage(error)),
            };
        }
    }

    /**
     * Update a schedule's definition. `updateFn` receives the current description
     * and must return the new desired schedule options — mirrors the SDK's
     * describe-then-transform `ScheduleHandle.update()` pattern.
     *
     * @example
     * ```typescript
     * await scheduleService.updateSchedule('daily-report', (previous) => ({
     *   ...previous,
     *   spec: { ...previous.spec, cronExpressions: ['0 9 * * *'] },
     * }));
     * ```
     */
    async updateSchedule(
        scheduleId: string,
        updateFn: (previous: ScheduleDescription) => ScheduleUpdateOptions,
    ): Promise<ScheduleUpdateResult> {
        this.ensureInitialized();

        try {
            const handle = this.resolveScheduleHandle(scheduleId);
            await handle.update(updateFn);

            this.logger.info(`Updated schedule '${scheduleId}'`);
            return { success: true, scheduleId };
        } catch (error) {
            this.logger.error(`Failed to update schedule '${scheduleId}'`, error);
            return {
                success: false,
                scheduleId,
                error: toError(error, this.extractErrorMessage(error)),
            };
        }
    }

    /**
     * Describe a schedule, returning its current configuration and state.
     *
     * @example
     * ```typescript
     * const { description } = await scheduleService.describeSchedule('daily-report');
     * console.log(description?.state.paused);
     * ```
     */
    async describeSchedule(scheduleId: string): Promise<ScheduleDescribeResult> {
        this.ensureInitialized();

        try {
            const handle = this.resolveScheduleHandle(scheduleId);
            const description = await handle.describe();

            return { success: true, scheduleId, description };
        } catch (error) {
            this.logger.error(`Failed to describe schedule '${scheduleId}'`, error);
            return {
                success: false,
                scheduleId,
                error: toError(error, this.extractErrorMessage(error)),
            };
        }
    }

    /**
     * List schedules in the namespace, wrapped in a result envelope so callers
     * can distinguish "schedule client unavailable" from "no schedules found".
     *
     * @example
     * ```typescript
     * const { schedules } = scheduleService.listSchedules();
     * for await (const schedule of schedules ?? []) {
     *   console.log(schedule.scheduleId);
     * }
     * ```
     */
    listSchedules(options?: ListScheduleOptions): ScheduleListResult {
        if (!this.scheduleClient) {
            return {
                success: false,
                error: new Error('Schedule client is not available'),
            };
        }

        try {
            return { success: true, schedules: this.scheduleClient.list(options) };
        } catch (error) {
            this.logger.error('Failed to list schedules', error);
            return {
                success: false,
                error: toError(error, this.extractErrorMessage(error)),
            };
        }
    }

    /**
     * Check if service is healthy
     */
    isHealthy(): boolean {
        return this.isInitialized;
    }

    /**
     * Get schedule statistics
     */
    getScheduleStats(): ScheduleServiceStats {
        return {
            total: this.scheduleHandles.size,
            active: this.scheduleHandles.size,
            inactive: 0,
            errors: 0,
            lastUpdated: new Date(),
        };
    }

    /**
     * Get service status
     */
    getStatus(): ScheduleServiceStatus {
        return {
            available: this.isInitialized,
            healthy: this.isHealthy(),
            schedulesSupported: !!this.scheduleClient,
            initialized: this.isInitialized,
        };
    }

    /**
     * Get service health status
     */
    getHealth(): ScheduleServiceHealth {
        return {
            status: this.isInitialized ? 'healthy' : 'unhealthy',
            schedulesCount: this.scheduleHandles.size,
            isInitialized: this.isInitialized,
            details: {
                scheduleIds: Array.from(this.scheduleHandles.keys()),
                hasScheduleClient: !!this.scheduleClient,
            },
        };
    }

    /**
     * Ensure service is initialized
     */
    private ensureInitialized(): void {
        if (!this.isInitialized) {
            throw new Error('Temporal Schedule Service is not initialized');
        }
    }
}
