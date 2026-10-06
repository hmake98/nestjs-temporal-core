import {
    Injectable,
    OnModuleInit,
    OnModuleDestroy,
    OnApplicationBootstrap,
    BeforeApplicationShutdown,
    Inject,
    Type,
} from '@nestjs/common';
import { Worker, NativeConnection, State } from '@temporalio/worker';
import { TEMPORAL_MODULE_OPTIONS, TEMPORAL_CONNECTION } from '../constants';
import {
    TemporalOptions,
    WorkerStatus,
    WorkerConfig,
    WorkerInitResult,
    WorkerRestartResult,
    WorkerHealthStatus,
    WorkerStats,
    ActivityRegistrationResult,
    WorkerDiscoveryResult,
    WorkerDefinition,
    MultipleWorkersInfo,
    CreateWorkerResult,
    WorkerInstance,
} from '../interfaces';
import { TemporalDiscoveryService } from './temporal-discovery.service';
import { withCorrelationWorkerOptions, withDataConverter } from '../observability/apply';
import { installRuntime } from '../observability/runtime';
import { enforceConnectionSecurity } from '../security';
import { wrapActivities } from '../error-mapping';
import {
    buildWorkflowBundle,
    resolveWorkflowsPath,
    tryResolveWorkflowsPath,
    validateAutoBundle,
} from '../workflow-bundle';
import { createLogger, TemporalLogger } from '../utils/logger';

/**
 * Temporal Worker Manager Service
 *
 * Manages the lifecycle of Temporal workers including:
 * - Worker initialization and configuration (single or multiple workers)
 * - Activity discovery and registration
 * - Worker health monitoring
 * - Graceful shutdown handling with timeout protection
 * - Support for multiple task queues
 * - Proper process signal handling (SIGTERM/SIGINT)
 */
@Injectable()
export class TemporalWorkerManagerService
    implements OnModuleInit, OnModuleDestroy, OnApplicationBootstrap, BeforeApplicationShutdown
{
    private readonly logger: TemporalLogger;

    // Legacy single worker support (for backward compatibility)
    private worker: Worker | null = null;
    private restartCount = 0;
    private isInitialized = false;
    private isRunning = false;
    private lastError: string | null = null;
    private startedAt: Date | null = null;
    private readonly activities = new Map<string, Function>();

    // Multiple workers support
    private readonly workers = new Map<string, WorkerInstance>();

    // Shared resources
    private connection: NativeConnection | null = null;
    private shutdownPromise: Promise<void> | null = null;

    constructor(
        private readonly discoveryService: TemporalDiscoveryService,
        @Inject(TEMPORAL_MODULE_OPTIONS)
        private readonly options: TemporalOptions,
        @Inject(TEMPORAL_CONNECTION)
        private readonly injectedConnection: NativeConnection | null,
    ) {
        this.logger = createLogger(TemporalWorkerManagerService.name, {
            enableLogger: options.enableLogger,
            logLevel: options.logLevel,
        });
    }

    /**
     * Get the maximum restart attempts for legacy single worker mode.
     * Priority: worker.maxRestarts > global maxRestarts > default (3)
     */
    private get maxRestarts(): number {
        return this.options.worker?.maxRestarts ?? this.options.maxRestarts ?? 3;
    }

    /**
     * Check if auto-restart is enabled for legacy single worker mode.
     * Priority: worker.autoRestart > global autoRestart > default (true)
     */
    private get autoRestartEnabled(): boolean {
        const workerAutoRestart = this.options.worker?.autoRestart;
        if (workerAutoRestart !== undefined) {
            return workerAutoRestart;
        }
        return this.options.autoRestart !== false;
    }

    async onModuleInit(): Promise<void> {
        try {
            this.logger.verbose('Initializing Temporal worker manager...');

            // Check if we should use multiple workers mode
            if (this.options.workers && this.options.workers.length > 0) {
                await this.initializeMultipleWorkers();
                return;
            }

            // Legacy single worker initialization
            if (!this.shouldInitializeWorker()) {
                this.logger.info('Worker initialization skipped - no configuration provided');
                return;
            }

            const initResult = await this.initializeWorker();
            this.isInitialized = initResult.success;

            if (initResult.success) {
                this.logger.info('Temporal worker manager initialized successfully');
            } else {
                this.lastError = initResult.error?.message || 'Unknown initialization error';
                this.logger.error('Failed to initialize worker manager', initResult.error);

                // Don't throw if connection failures are allowed
                if (this.options.allowConnectionFailure === true) {
                    this.logger.warn('Continuing without worker (connection failures allowed)');
                    return;
                }

                throw initResult.error || new Error('Worker initialization failed');
            }
        } catch (error) {
            this.lastError = this.extractErrorMessage(error);
            this.logger.error('Failed to initialize worker manager', error);

            // Don't throw if connection failures are allowed
            if (this.options.allowConnectionFailure === true) {
                this.logger.warn('Continuing without worker (connection failures allowed)');
                return;
            }

            throw error;
        }
    }

    async onApplicationBootstrap(): Promise<void> {
        try {
            // Start multiple workers if configured
            if (this.options.workers && this.options.workers.length > 0) {
                this.logger.info('Starting configured workers...');
                const startPromises: Promise<void>[] = [];

                for (const [taskQueue] of this.workers.entries()) {
                    const workerDef = this.options.workers.find((w) => w.taskQueue === taskQueue);
                    if (workerDef?.autoStart !== false) {
                        startPromises.push(
                            this.startWorkerByTaskQueue(taskQueue).catch((error) => {
                                this.logger.error(`Failed to start worker '${taskQueue}'`, error);
                                if (this.options.allowConnectionFailure !== true) {
                                    throw error;
                                }
                            }),
                        );
                    }
                }

                await Promise.all(startPromises);
                this.logger.info(`Started ${startPromises.length} workers successfully`);
                return;
            }

            // Legacy single worker auto-start
            if (this.worker && this.options.worker?.autoStart !== false) {
                this.logger.info('Starting worker...');
                await this.startWorker();
                this.logger.info('Worker started successfully');
            }
        } catch (error) {
            this.logger.error('Error during worker startup', error);
            if (this.options.allowConnectionFailure !== true) {
                throw error;
            }
        }
    }

    /**
     * BeforeApplicationShutdown lifecycle hook
     * Initiates graceful shutdown before the application fully shuts down
     * This ensures workers have time to complete in-flight tasks
     */
    async beforeApplicationShutdown(signal?: string): Promise<void> {
        if (signal) {
            this.logger.info(`Received shutdown signal: ${signal}`);
        }

        this.logger.info('Initiating graceful worker shutdown...');

        // Start the shutdown process with timeout protection
        // This is the same as shutdownWorker but with an explicit timeout
        const shutdownTimeout = this.options.shutdownTimeout || 30000;
        const shutdownPromise = this.shutdownWorker();
        const timeoutPromise = new Promise<void>((resolve) => {
            setTimeout(() => {
                this.logger.warn(`Shutdown timeout (${shutdownTimeout}ms) reached`);
                resolve();
            }, shutdownTimeout);
        });

        try {
            await Promise.race([shutdownPromise, timeoutPromise]);
        } catch (error) {
            this.logger.error('Error during graceful shutdown', error);
        }
    }

    async onModuleDestroy(): Promise<void> {
        // If shutdown was already initiated by beforeApplicationShutdown, this will be a no-op
        await this.shutdownWorker();
    }

    // ==========================================
    // Multiple Workers Support
    // ==========================================

    /**
     * Initialize multiple workers from configuration
     */
    private async initializeMultipleWorkers(): Promise<void> {
        this.logger.info(`Initializing ${this.options.workers!.length} workers...`);

        // Ensure connection is established first
        await this.createConnection();

        if (!this.connection && this.options.allowConnectionFailure !== false) {
            this.logger.warn('Connection failed, skipping worker initialization');
            return;
        }

        for (const workerDef of this.options.workers!) {
            try {
                await this.createWorkerFromDefinition(workerDef);
            } catch (error) {
                this.logger.error(
                    `Failed to initialize worker for task queue '${workerDef.taskQueue}'`,
                    error,
                );
                if (this.options.allowConnectionFailure !== true) {
                    throw error;
                }
            }
        }

        this.logger.info(`Successfully initialized ${this.workers.size} workers`);
    }

    /**
     * Create a worker from a worker definition
     */
    private async createWorkerFromDefinition(workerDef: WorkerDefinition): Promise<WorkerInstance> {
        this.logger.verbose(`Creating worker for task queue '${workerDef.taskQueue}'`);

        // Check if worker already exists
        if (this.workers.has(workerDef.taskQueue)) {
            throw new Error(`Worker for task queue '${workerDef.taskQueue}' already exists`);
        }

        // Load activities for this worker
        const activities = new Map<string, Function>();

        // Get activities from discovery service
        if (workerDef.activityClasses && workerDef.activityClasses.length > 0) {
            await this.loadActivitiesForWorker(activities, workerDef.activityClasses);
        } else {
            // Use all discovered activities
            const allActivities = this.discoveryService.getAllActivities();
            for (const [name, handler] of Object.entries(allActivities)) {
                activities.set(name, handler);
            }
        }

        // Create worker config
        const workerConfig: WorkerConfig = {
            ...withDataConverter(
                withCorrelationWorkerOptions(workerDef.workerOptions, this.options.correlation),
                this.options.dataConverter,
            ),
            taskQueue: workerDef.taskQueue,
            namespace: this.options.connection?.namespace || 'default',
            connection: this.connection!,
            activities: wrapActivities(Object.fromEntries(activities), this.options.errorMapping),
        };

        // Add workflow configuration
        await this.applyWorkflowSource(workerConfig, workerDef);

        // Create the worker
        const { Worker } = await import('@temporalio/worker');
        const worker = await Worker.create(workerConfig);

        // Create worker instance
        const workerInstance: WorkerInstance = {
            worker,
            taskQueue: workerDef.taskQueue,
            namespace: this.options.connection?.namespace || 'default',
            isRunning: false,
            isInitialized: true,
            lastError: null,
            startedAt: null,
            restartCount: 0,
            activities,
            workflowSource: this.getWorkflowSource(workerDef),
        };

        // Store worker instance
        this.workers.set(workerDef.taskQueue, workerInstance);

        this.logger.info(`Created worker '${workerDef.taskQueue}' (${activities.size} activities)`);

        return workerInstance;
    }

    /**
     * Register and create a new worker dynamically at runtime
     */
    async registerWorker(workerDef: WorkerDefinition): Promise<CreateWorkerResult> {
        try {
            // Validate task queue
            if (!workerDef.taskQueue || workerDef.taskQueue.trim().length === 0) {
                throw new Error('Task queue is required');
            }

            // Ensure connection exists
            if (!this.connection) {
                await this.createConnection();
            }

            const workerInstance = await this.createWorkerFromDefinition(workerDef);

            // Auto-start if requested
            if (workerDef.autoStart !== false) {
                await this.startWorkerByTaskQueue(workerDef.taskQueue);
            }

            return {
                success: true,
                taskQueue: workerDef.taskQueue,
                worker: workerInstance.worker,
            };
        } catch (error) {
            this.logger.error(`Failed to register worker '${workerDef.taskQueue}'`, error);
            return {
                success: false,
                taskQueue: workerDef.taskQueue,
                error: error instanceof Error ? error : new Error(this.extractErrorMessage(error)),
            };
        }
    }

    /**
     * Get a specific worker by task queue
     */
    getWorker(taskQueue: string): Worker | null {
        const workerInstance = this.workers.get(taskQueue);
        return workerInstance ? workerInstance.worker : null;
    }

    /**
     * Get all workers information
     */
    getAllWorkers(): MultipleWorkersInfo {
        const workersStatus = new Map<string, WorkerStatus>();

        for (const [taskQueue, workerInstance] of this.workers.entries()) {
            workersStatus.set(taskQueue, this.getWorkerStatusFromInstance(workerInstance));
        }

        return {
            workers: workersStatus,
            totalWorkers: this.workers.size,
            runningWorkers: Array.from(this.workers.values()).filter((w) => w.isRunning).length,
            healthyWorkers: Array.from(this.workers.values()).filter(
                (w) => w.isInitialized && !w.lastError && w.isRunning,
            ).length,
        };
    }

    /**
     * Get worker status for a specific task queue
     */
    getWorkerStatusByTaskQueue(taskQueue: string): WorkerStatus | null {
        const workerInstance = this.workers.get(taskQueue);
        return workerInstance ? this.getWorkerStatusFromInstance(workerInstance) : null;
    }

    /**
     * Start a specific worker by task queue
     */
    async startWorkerByTaskQueue(taskQueue: string): Promise<void> {
        const workerInstance = this.workers.get(taskQueue);

        if (!workerInstance) {
            throw new Error(`Worker for task queue '${taskQueue}' not found`);
        }

        if (workerInstance.isRunning) {
            this.logger.warn(`Worker for '${taskQueue}' is already running`);
            return;
        }

        try {
            this.logger.verbose(`Starting worker '${taskQueue}'...`);
            workerInstance.isRunning = true;
            workerInstance.startedAt = new Date();
            workerInstance.lastError = null;
            workerInstance.restartCount = 0; // Reset restart count on fresh start

            // Start the worker with auto-restart capability
            this.runWorkerWithAutoRestartByTaskQueue(taskQueue);

            this.logger.info(
                `Worker '${taskQueue}' started (${workerInstance.activities.size} activities, ${workerInstance.workflowSource})`,
            );
        } catch (error) {
            workerInstance.lastError = this.extractErrorMessage(error);
            workerInstance.isRunning = false;
            this.logger.error(`Failed to start worker '${taskQueue}'`, error);
            throw error;
        }
    }

    /**
     * Stop a specific worker by task queue
     */
    async stopWorkerByTaskQueue(taskQueue: string): Promise<void> {
        const workerInstance = this.workers.get(taskQueue);

        if (!workerInstance) {
            throw new Error(`Worker for task queue '${taskQueue}' not found`);
        }

        if (!workerInstance.isRunning) {
            this.logger.verbose(`Worker '${taskQueue}' is not running`);
            return;
        }

        try {
            this.logger.verbose(`Stopping worker '${taskQueue}'...`);
            this.safeShutdownWorker(workerInstance.worker, taskQueue, workerInstance.startedAt);
            workerInstance.isRunning = false;
            workerInstance.startedAt = null;
        } catch (error) {
            workerInstance.lastError = this.extractErrorMessage(error);
            this.logger.warn(`Error stopping worker '${taskQueue}'`, error);
            // Mark as not running even if shutdown failed
            workerInstance.isRunning = false;
        }
    }

    /**
     * Run worker with auto-restart capability for multiple workers mode.
     * Similar to runWorkerWithAutoRestart() but for a specific task queue.
     */
    private runWorkerWithAutoRestartByTaskQueue(taskQueue: string): void {
        const workerInstance = this.workers.get(taskQueue);
        if (!workerInstance) return;

        const workerDef = this.options.workers?.find((w) => w.taskQueue === taskQueue);
        const maxRestarts = workerDef?.maxRestarts ?? this.options.maxRestarts ?? 3;

        workerInstance.worker.run().catch((error) => {
            workerInstance.lastError = this.extractErrorMessage(error);
            workerInstance.isRunning = false;

            const autoRestartEnabled = workerDef?.autoRestart ?? this.options.autoRestart;

            if (autoRestartEnabled !== false && workerInstance.restartCount < maxRestarts) {
                workerInstance.restartCount++;
                this.logger.warn(
                    `Worker '${taskQueue}' failed, auto-restarting in 1s (attempt ${workerInstance.restartCount}/${maxRestarts})`,
                    error,
                );
                setTimeout(() => {
                    this.autoRestartWorkerByTaskQueue(taskQueue).catch((restartError) => {
                        this.logger.error(`Auto-restart failed for '${taskQueue}'`, restartError);
                    });
                }, 1000);
            } else if (workerInstance.restartCount >= maxRestarts) {
                this.logger.error(
                    `Worker '${taskQueue}' failed after ${maxRestarts} restart attempts, giving up`,
                    error,
                );
            } else {
                this.logger.error(`Worker '${taskQueue}' run failed`, error);
            }
        });
    }

    /**
     * Auto-restart a specific worker by task queue after a failure.
     *
     * The Temporal SDK's Worker.run() method is one-shot - once it completes,
     * the worker's state becomes STOPPED with no way to reset. Therefore,
     * we must create a NEW Worker instance to restart.
     */
    private async autoRestartWorkerByTaskQueue(taskQueue: string): Promise<void> {
        this.logger.info(`Auto-restarting worker '${taskQueue}'...`);

        try {
            const workerDef = this.options.workers?.find((w) => w.taskQueue === taskQueue);
            if (!workerDef) {
                throw new Error(`Worker definition for '${taskQueue}' not found`);
            }

            // Save restart count before cleanup
            const oldInstance = this.workers.get(taskQueue);
            const restartCount = oldInstance?.restartCount ?? 0;

            // Cleanup existing worker
            await this.cleanupWorkerForRestartByTaskQueue(taskQueue);

            // Brief delay before reconnection attempt
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Remove old instance and create fresh worker
            this.workers.delete(taskQueue);
            const newInstance = await this.createWorkerFromDefinition(workerDef);

            // Preserve restart count from old instance
            newInstance.restartCount = restartCount;

            // Start the new worker
            newInstance.isRunning = true;
            newInstance.startedAt = new Date();
            newInstance.lastError = null;
            this.runWorkerWithAutoRestartByTaskQueue(taskQueue);

            this.logger.info(`Worker '${taskQueue}' auto-restarted successfully`);
        } catch (error) {
            const workerInstance = this.workers.get(taskQueue);
            if (workerInstance) {
                workerInstance.lastError = this.extractErrorMessage(error);
                workerInstance.isRunning = false;
            }
            this.logger.error(`Auto-restart failed for '${taskQueue}'`, error);
            throw error;
        }
    }

    /**
     * Cleanup a worker before restart.
     * Attempts graceful shutdown but continues even if it fails.
     */
    private async cleanupWorkerForRestartByTaskQueue(taskQueue: string): Promise<void> {
        const workerInstance = this.workers.get(taskQueue);
        if (!workerInstance?.worker) return;

        try {
            this.safeShutdownWorker(workerInstance.worker, taskQueue);
        } catch (error) {
            this.logger.warn(
                `Error during worker '${taskQueue}' cleanup (continuing with restart)`,
                error,
            );
        }

        workerInstance.isRunning = false;
        workerInstance.startedAt = null;
        // Note: Keep restartCount - it's preserved and passed to the new instance
    }

    /**
     * Get the native connection for creating custom workers
     * @returns NativeConnection instance or null
     */
    getConnection(): NativeConnection | null {
        return this.connection;
    }

    /**
     * Helper method to get worker status from worker instance
     */
    private getWorkerStatusFromInstance(workerInstance: WorkerInstance): WorkerStatus {
        const uptime = workerInstance.startedAt
            ? Date.now() - workerInstance.startedAt.getTime()
            : undefined;

        const isHealthy = this.calculateWorkerHealth(workerInstance);

        return {
            isInitialized: workerInstance.isInitialized,
            isRunning: workerInstance.isRunning,
            isHealthy,
            taskQueue: workerInstance.taskQueue,
            namespace: workerInstance.namespace,
            workflowSource: workerInstance.workflowSource,
            activitiesCount: workerInstance.activities.size,
            lastError: workerInstance.lastError || undefined,
            startedAt: workerInstance.startedAt || undefined,
            uptime,
        };
    }

    /**
     * Helper to load activities for a specific worker
     */
    private async loadActivitiesForWorker(
        activities: Map<string, Function>,
        activityClasses?: Array<Type<object>>,
    ): Promise<void> {
        // Wait for discovery service to complete
        await this.waitForDiscoveryCompletion();

        // If no activity classes specified, load all activities
        if (!activityClasses || activityClasses.length === 0) {
            const allActivities = this.discoveryService.getAllActivities();
            for (const [activityName, handler] of Object.entries(allActivities)) {
                activities.set(activityName, handler);
            }
            return;
        }

        // Filter activities by the specified classes
        const discoveredActivities = this.discoveryService.getDiscoveredActivities();
        const allowedClasses = new Set(activityClasses);
        const allowedClassNames = new Set(activityClasses.map((cls) => cls.name));

        for (const [activityName, activityInfo] of discoveredActivities.entries()) {
            // Match by constructor (robust) or class name (fallback)
            const activityInstance = activityInfo.instance;
            const activityConstructor =
                activityInstance &&
                typeof activityInstance === 'object' &&
                'constructor' in activityInstance
                    ? (activityInstance.constructor as Type<object>)
                    : null;

            const matchesByConstructor =
                activityConstructor && allowedClasses.has(activityConstructor);
            const matchesByName = allowedClassNames.has(activityInfo.className);

            if (matchesByConstructor || matchesByName) {
                activities.set(activityName, activityInfo.handler);
            }
        }
    }

    // ==========================================
    // Legacy Single Worker Support (Backward Compatibility)
    // ==========================================

    /**
     * Start the worker
     */
    async startWorker(): Promise<void> {
        if (!this.worker) {
            throw new Error('Worker not initialized. Cannot start worker.');
        }

        if (this.isRunning) {
            this.logger.warn('Worker is already running');
            return;
        }

        try {
            this.logger.info('Starting Temporal worker...');
            this.isRunning = true;
            this.startedAt = new Date();
            this.lastError = null;
            this.restartCount = 0; // Reset restart count on successful start

            // Start the worker and wait for it to be ready
            await this.runWorkerWithAutoRestart();

            this.logger.info('Temporal worker started successfully');
        } catch (error) {
            this.lastError = this.extractErrorMessage(error);
            this.logger.error('Failed to start worker', error);
            this.isRunning = false;
            throw error;
        }
    }

    private async runWorkerWithAutoRestart(): Promise<void> {
        if (!this.worker) return;

        // Start the worker and wait for it to be ready
        try {
            // Use setImmediate to ensure non-blocking execution
            await new Promise<void>((resolve, reject) => {
                setImmediate(async () => {
                    try {
                        // Start the worker in the background
                        this.worker!.run().catch((error) => {
                            this.lastError = this.extractErrorMessage(error);
                            this.isRunning = false;

                            // Auto-restart if enabled and within restart limits
                            if (this.autoRestartEnabled && this.restartCount < this.maxRestarts) {
                                this.restartCount++;
                                this.logger.warn(
                                    `Worker failed, auto-restarting in 1s (attempt ${this.restartCount}/${this.maxRestarts})`,
                                    error,
                                );
                                setTimeout(async () => {
                                    try {
                                        await this.autoRestartWorker();
                                    } catch (restartError) {
                                        this.logger.error('Auto-restart failed', restartError);
                                    }
                                }, 1000);
                            } else if (this.restartCount >= this.maxRestarts) {
                                this.logger.error(
                                    `Worker failed after ${this.maxRestarts} restart attempts, giving up`,
                                    error,
                                );
                            } else {
                                this.logger.error('Worker run failed', error);
                            }
                        });

                        // Give the worker a moment to start up and be ready
                        setTimeout(() => resolve(), 500);
                    } catch (error) {
                        reject(error);
                    }
                });
            });
        } catch (error) {
            throw error;
        }
    }

    /**
     * Auto-restart the worker after a failure.
     *
     * The Temporal SDK's Worker.run() method checks `if (this.state !== 'INITIALIZED')`
     * and throws "IllegalStateError: Poller was already started" if called again.
     * Once run() executes, state changes INITIALIZED → RUNNING → ... → STOPPED,
     * with no code path to reset back to INITIALIZED. Therefore, we must create
     * a NEW Worker instance to restart.
     *
     * @see https://github.com/temporalio/sdk-typescript/blob/main/packages/worker/src/worker.ts
     */
    private async autoRestartWorker(): Promise<void> {
        this.logger.info('Auto-restarting Temporal worker...');

        try {
            // Cleanup existing worker - it cannot be reused after run() completes
            await this.cleanupWorkerForRestart();

            // Brief delay before reconnection attempt
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Create a fresh worker instance
            const initResult = await this.initializeWorker();
            if (!initResult.success) {
                throw initResult.error || new Error('Failed to reinitialize worker');
            }

            // Start the new worker - clear error only after successful restart
            this.isInitialized = true;
            this.isRunning = true;
            this.startedAt = new Date();
            this.lastError = null;
            await this.runWorkerWithAutoRestart();

            this.logger.info('Temporal worker auto-restarted successfully');
        } catch (error) {
            this.lastError = this.extractErrorMessage(error);
            this.logger.error('Auto-restart failed', error);
            this.isRunning = false;
            throw error;
        }
    }

    /**
     * Cleanup the current worker before restart.
     * Attempts graceful shutdown but continues even if it fails.
     * Note: Does NOT reset lastError - that's done after successful restart.
     */
    private async cleanupWorkerForRestart(): Promise<void> {
        if (!this.worker) {
            return;
        }

        try {
            this.safeShutdownWorker(this.worker, 'legacy');
        } catch (error) {
            this.logger.warn('Error during worker cleanup (continuing with restart)', error);
        }

        // Clear references - worker cannot be reused
        // Note: Keep lastError until restart succeeds for debugging
        this.worker = null;
        this.isRunning = false;
        this.startedAt = null;
    }

    /**
     * Stop the worker gracefully
     */
    async stopWorker(): Promise<void> {
        if (!this.worker || !this.isRunning) {
            this.logger.debug('Worker is not running or not initialized');
            return;
        }

        try {
            this.logger.verbose('Stopping Temporal worker...');
            const taskQueue = this.options.taskQueue || 'default';
            this.safeShutdownWorker(this.worker, taskQueue, this.startedAt);
            this.isRunning = false;
            this.startedAt = null;
        } catch (error) {
            this.lastError = this.extractErrorMessage(error);
            this.logger.warn('Error stopping worker gracefully', error);
            // Mark as not running even if shutdown failed
            this.isRunning = false;
        }
    }

    /**
     * Shutdown the worker (alias for shutdownWorker)
     */
    async shutdown(): Promise<void> {
        await this.shutdownWorker();
    }

    /**
     * Restart the worker
     */
    async restartWorker(): Promise<WorkerRestartResult> {
        this.logger.info('Restarting Temporal worker...');

        try {
            await this.stopWorker();

            // Wait a bit before restarting
            await new Promise((resolve) => setTimeout(resolve, 1000));

            await this.startWorker();

            return {
                success: true,
                restartCount: this.restartCount,
                maxRestarts: this.maxRestarts,
            };
        } catch (error) {
            this.lastError = this.extractErrorMessage(error);
            this.logger.error('Failed to restart worker', error);
            return {
                success: false,
                error: error instanceof Error ? error : new Error(this.lastError),
                restartCount: this.restartCount,
                maxRestarts: this.maxRestarts,
            };
        }
    }

    /**
     * Get worker status
     */
    getWorkerStatus(): WorkerStatus {
        const uptime = this.startedAt ? Date.now() - this.startedAt.getTime() : undefined;
        const isHealthy = this.calculateWorkerHealth();

        return {
            isInitialized: this.isInitialized,
            isRunning: this.isRunning,
            isHealthy,
            taskQueue: this.options.taskQueue || 'default',
            namespace: this.options.connection?.namespace || 'default',
            workflowSource: this.getWorkflowSource(),
            activitiesCount: this.activities.size,
            lastError: this.lastError || undefined,
            startedAt: this.startedAt || undefined,
            uptime,
        };
    }

    /**
     * Get registered activities
     */
    getRegisteredActivities(): Record<string, Function> {
        const result: Record<string, Function> = {};
        for (const [name, func] of this.activities.entries()) {
            result[name] = func;
        }
        return result;
    }

    /**
     * Register activities from discovery service
     */
    async registerActivitiesFromDiscovery(): Promise<ActivityRegistrationResult> {
        const errors: Array<{ activityName: string; error: string }> = [];
        let registeredCount = 0;

        try {
            // Wait for discovery service to complete discovery
            await this.waitForDiscoveryCompletion();

            // Load all discovered activities
            const allActivities = this.discoveryService.getAllActivities();

            for (const [activityName, handler] of Object.entries(allActivities)) {
                try {
                    this.activities.set(activityName, handler);
                    registeredCount++;
                    this.logger.verbose(`Registered activity: ${activityName}`);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    errors.push({ activityName, error: errorMessage });
                    this.logger.warn(
                        `Failed to register activity '${activityName}': ${errorMessage}`,
                    );
                }
            }

            this.logger.info(`Registered ${registeredCount} activities from discovery service`);

            return {
                success: errors.length === 0,
                registeredCount,
                errors,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to register activities from discovery', error);
            return {
                success: false,
                registeredCount,
                errors: [{ activityName: 'discovery', error: errorMessage }],
            };
        }
    }

    /**
     * Check if worker is available
     */
    isWorkerAvailable(): boolean {
        return this.worker !== null;
    }

    /**
     * Check if worker is running
     */
    isWorkerRunning(): boolean {
        return this.isRunning;
    }

    /**
     * Get worker health status
     */
    getHealthStatus(): WorkerHealthStatus {
        const uptime = this.startedAt ? Date.now() - this.startedAt.getTime() : undefined;
        const isHealthy = this.calculateWorkerHealth();

        return {
            isHealthy,
            isRunning: this.isRunning,
            isInitialized: this.isInitialized,
            lastError: this.lastError || undefined,
            uptime,
            activitiesCount: this.activities.size,
            restartCount: this.restartCount,
            maxRestarts: this.maxRestarts,
        };
    }

    /**
     * Get worker statistics
     */
    getStats(): WorkerStats {
        const uptime = this.startedAt ? Date.now() - this.startedAt.getTime() : undefined;

        return {
            isInitialized: this.isInitialized,
            isRunning: this.isRunning,
            activitiesCount: this.activities.size,
            restartCount: this.restartCount,
            maxRestarts: this.maxRestarts,
            uptime,
            startedAt: this.startedAt || undefined,
            lastError: this.lastError || undefined,
            taskQueue: this.options.taskQueue || 'default',
            namespace: this.options.connection?.namespace || 'default',
            workflowSource: this.getWorkflowSource(),
        };
    }

    /**
     * Validate worker configuration
     */
    private validateConfiguration(): void {
        if (!this.options.taskQueue) {
            throw new Error('Task queue is required');
        }
        if (!this.options.connection?.address) {
            throw new Error('Connection address is required');
        }

        // Check for conflicting workflow configurations
        if (this.options.worker?.workflowsPath && this.options.worker?.workflowBundle) {
            throw new Error('Cannot specify both workflowsPath and workflowBundle');
        }
        validateAutoBundle(this.options.worker, 'worker');
    }

    /**
     * Create connection to Temporal server
     */
    private async createConnection(): Promise<void> {
        installRuntime(this.options.runtime);
        enforceConnectionSecurity(this.options);

        // If a valid connection was injected, use it
        if (this.injectedConnection) {
            this.connection = this.injectedConnection;
            this.logger.debug('Using injected connection');
            return;
        }

        if (!this.options.connection?.address) {
            throw new Error('Connection address is required');
        }

        try {
            const address = this.options.connection.address;
            const connectOptions: Record<string, unknown> = {
                address,
                tls: this.options.connection.tls,
            };

            if (this.options.connection.apiKey) {
                connectOptions.metadata = {
                    ...(this.options.connection.metadata || {}),
                    authorization: `Bearer ${this.options.connection.apiKey}`,
                };
            }

            this.logger.verbose(`Connecting to Temporal server at ${address}...`);
            this.connection = await NativeConnection.connect(connectOptions);
            const ns = this.options.connection?.namespace || 'default';
            this.logger.info(`Connected to ${address} (namespace: ${ns})`);
        } catch (error) {
            this.logger.error('Failed to create connection', error);

            // In development or when connection failures are allowed, don't throw
            if (this.options.allowConnectionFailure !== false) {
                this.logger.warn('Connection failed, continuing without worker');
                this.connection = null;
                return;
            }

            throw error;
        }
    }

    private shouldInitializeWorker(): boolean {
        return Boolean(
            this.options.worker &&
            (this.options.worker.workflowsPath ||
                this.options.worker.workflowBundle ||
                this.options.worker.activityClasses?.length),
        );
    }

    private async initializeWorker(): Promise<WorkerInitResult> {
        if (!this.options.worker) {
            return {
                success: false,
                error: new Error('Worker configuration is required'),
                activitiesCount: 0,
                taskQueue: this.options.taskQueue || 'default',
                namespace: this.options.connection?.namespace || 'default',
            };
        }

        try {
            // Validate configuration first
            this.validateConfiguration();

            // Ensure connection is established
            await this.createConnection();

            // If connection failed and we're allowing connection failures, return gracefully
            if (!this.connection && this.options.allowConnectionFailure !== false) {
                this.logger.info('Worker initialization skipped due to connection failure');
                return {
                    success: false,
                    error: new Error('No worker connection available'),
                    activitiesCount: 0,
                    taskQueue: this.options.taskQueue || 'default',
                    namespace: this.options.connection?.namespace || 'default',
                };
            }

            // Get activities from discovery service
            await this.loadActivitiesFromDiscovery();

            // Create worker configuration
            const workerConfig = await this.createWorkerConfig();

            // Create the worker
            const { Worker } = await import('@temporalio/worker');
            this.worker = await Worker.create(workerConfig);

            this.logger.verbose(
                `Worker created: queue='${workerConfig.taskQueue}', activities=${this.activities.size}, workflows=${this.getWorkflowSource()}`,
            );

            return {
                success: true,
                worker: this.worker,
                activitiesCount: this.activities.size,
                taskQueue: workerConfig.taskQueue,
                namespace:
                    workerConfig.namespace ?? this.options.connection?.namespace ?? 'default',
            };
        } catch (error) {
            this.lastError = this.extractErrorMessage(error);
            this.logger.error('Failed to initialize worker', error);
            return {
                success: false,
                error: error instanceof Error ? error : new Error(this.lastError),
                activitiesCount: this.activities.size,
                taskQueue: this.options.taskQueue || 'default',
                namespace: this.options.connection?.namespace || 'default',
            };
        }
    }

    private async loadActivitiesFromDiscovery(): Promise<WorkerDiscoveryResult> {
        const startTime = Date.now();
        const errors: Array<{ name: string; error: string }> = [];
        let discoveredActivities = 0;
        let loadedActivities = 0;

        try {
            // Wait for discovery service to complete discovery
            await this.waitForDiscoveryCompletion();

            // Load all discovered activities
            const allActivities = this.discoveryService.getAllActivities();
            discoveredActivities = Object.keys(allActivities).length;

            for (const [activityName, handler] of Object.entries(allActivities)) {
                try {
                    this.activities.set(activityName, handler);
                    loadedActivities++;
                    this.logger.verbose(`Loaded activity: ${activityName}`);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    errors.push({ name: activityName, error: errorMessage });
                    this.logger.warn(`Failed to load activity '${activityName}': ${errorMessage}`);
                }
            }

            const duration = Date.now() - startTime;
            this.logger.info(
                `Loaded ${loadedActivities} ${loadedActivities === 1 ? 'activity' : 'activities'} from discovery in ${duration}ms`,
            );

            return {
                success: errors.length === 0,
                discoveredActivities,
                loadedActivities,
                errors,
                duration: Date.now() - startTime,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to load activities from discovery', error);
            return {
                success: false,
                discoveredActivities,
                loadedActivities,
                errors: [{ name: 'discovery', error: errorMessage }],
                duration: Date.now() - startTime,
            };
        }
    }

    private async createWorkerConfig(): Promise<WorkerConfig> {
        const taskQueue = this.options.taskQueue || 'default';
        const namespace = this.options.connection?.namespace || 'default';

        if (!this.connection) {
            throw new Error('Connection not established');
        }

        const config: WorkerConfig = {
            ...withDataConverter(
                withCorrelationWorkerOptions(
                    this.options.worker?.workerOptions,
                    this.options.correlation,
                ),
                this.options.dataConverter,
            ),
            taskQueue,
            namespace,
            connection: this.connection,
            activities: wrapActivities(
                Object.fromEntries(this.activities),
                this.options.errorMapping,
            ),
        };

        // Add workflow configuration
        const hasWorkflows = await this.applyWorkflowSource(config, this.options.worker ?? {});
        if (!hasWorkflows) {
            this.logger.warn('No workflow configuration - worker will only handle activities');
        }

        return config;
    }

    private async shutdownWorker(): Promise<void> {
        if (this.shutdownPromise) {
            return this.shutdownPromise;
        }

        this.shutdownPromise = this.performShutdown();
        return this.shutdownPromise;
    }

    private async performShutdown(): Promise<void> {
        try {
            this.logger.info('Shutting down Temporal worker manager...');

            // Shutdown multiple workers if they exist
            if (this.workers.size > 0) {
                this.logger.info(`Shutting down ${this.workers.size} workers...`);
                const shutdownPromises: Promise<void>[] = [];

                for (const [taskQueue, workerInstance] of this.workers.entries()) {
                    const shutdownPromise = (async () => {
                        try {
                            if (workerInstance.isRunning && workerInstance.worker) {
                                this.logger.debug(`Stopping worker for '${taskQueue}'...`);
                                this.safeShutdownWorker(workerInstance.worker, taskQueue);
                                workerInstance.isRunning = false;
                            }
                        } catch (error) {
                            this.logger.warn(`Error shutting down worker '${taskQueue}'`, error);
                        }
                    })();

                    shutdownPromises.push(shutdownPromise);
                }

                // Wait for all workers to shutdown in parallel
                await Promise.allSettled(shutdownPromises);
                this.workers.clear();
                this.logger.info('All workers shut down successfully');
            }

            // Shutdown legacy single worker if it exists
            if (this.worker) {
                await this.stopWorker();
                this.worker = null;
            }

            // Close connection
            if (this.connection && !this.injectedConnection) {
                try {
                    await this.connection.close();
                    this.logger.info('Connection closed successfully');
                } catch (error) {
                    this.logger.warn('Error closing connection', error);
                }
                this.connection = null;
            }

            this.isInitialized = false;
            this.logger.info('Worker manager shutdown completed');
        } catch (error) {
            this.logger.error('Error during worker shutdown', error);
        } finally {
            this.shutdownPromise = null;
        }
    }

    // ==========================================
    // Shared Helpers
    // ==========================================

    /**
     * Set the workflow source on a worker config: a path (validated, then bundled when
     * `autoBundle` is on), or a prebuilt bundle. Returns false when neither is configured.
     */
    private async applyWorkflowSource(
        config: WorkerConfig,
        source: Pick<WorkerDefinition, 'workflowsPath' | 'workflowBundle' | 'autoBundle'>,
    ): Promise<boolean> {
        if (source.workflowsPath) {
            let workflowsPath = source.workflowsPath;
            if (source.autoBundle) {
                workflowsPath = resolveWorkflowsPath(source.workflowsPath);
                const given = source.autoBundle === true ? {} : source.autoBundle;
                // The SDK ignores `interceptors.workflowModules` once a prebuilt bundle is set,
                // so modules added for the worker (for example correlation) are baked into the
                // bundle here instead.
                const workflowModules = config.interceptors?.workflowModules ?? [];
                const autoBundleOptions = {
                    ...given,
                    bundlerOptions: {
                        ...given.bundlerOptions,
                        workflowInterceptorModules: [
                            ...new Set([
                                ...(given.bundlerOptions?.workflowInterceptorModules ?? []),
                                ...workflowModules,
                            ]),
                        ],
                    },
                };
                if (config.interceptors?.workflowModules) {
                    config.interceptors = { ...config.interceptors, workflowModules: undefined };
                }
                const bundle = await buildWorkflowBundle(workflowsPath, autoBundleOptions);
                config.workflowBundle = { code: bundle.code };
                this.logger.info(
                    `Workflow bundle ${bundle.cached ? 'loaded from cache' : 'built'} ` +
                        `(${bundle.hash.slice(0, 12)}) from ${workflowsPath}`,
                );
            } else {
                const resolved = tryResolveWorkflowsPath(source.workflowsPath);
                if (resolved.error) {
                    // Not fatal here: keep the path as given and let the SDK report it.
                    this.logger.warn(resolved.error.message);
                } else {
                    workflowsPath = resolved.path as string;
                }
                config.workflowsPath = workflowsPath;
                this.logger.verbose(`Using workflows from: ${workflowsPath}`);
            }
            return true;
        }
        if (source.workflowBundle) {
            // `workflowBundle` is intentionally loose for back-compat; the Temporal SDK
            // validates the shape at runtime.
            config.workflowBundle = source.workflowBundle as WorkerConfig['workflowBundle'];
            this.logger.verbose('Using workflow bundle');
            return true;
        }
        return false;
    }

    private getWorkflowSource(config?: {
        workflowBundle?: unknown;
        workflowsPath?: string;
        autoBundle?: unknown;
    }): 'bundle' | 'filesystem' | 'registered' | 'none' {
        const source = config ?? this.options.worker;
        if (source?.workflowBundle) return 'bundle';
        if (source?.workflowsPath && source?.autoBundle) return 'bundle';
        if (source?.workflowsPath) return 'filesystem';
        return 'none';
    }

    private getNativeState(): State | null {
        if (!this.worker) {
            return null;
        }
        try {
            return this.worker.getState() as State;
        } catch {
            return null;
        }
    }

    /**
     * Calculate if a worker is healthy based on its current state.
     * @param workerInstance - WorkerInstance for multiple workers mode, omit for legacy single worker mode
     */
    private calculateWorkerHealth(workerInstance: WorkerInstance | null = null): boolean {
        if (workerInstance) {
            let nativeState: State | null = null;
            try {
                nativeState = workerInstance.worker?.getState() ?? null;
            } catch {
                nativeState = null;
            }
            return (
                workerInstance.isInitialized &&
                !workerInstance.lastError &&
                workerInstance.isRunning &&
                nativeState === 'RUNNING'
            );
        }

        // Legacy single worker mode
        const nativeState = this.getNativeState();
        return this.isInitialized && !this.lastError && this.isRunning && nativeState === 'RUNNING';
    }

    /**
     * Wait for discovery service to complete activity discovery.
     * @param maxWaitMs Maximum time to wait (default: 3000ms)
     * @returns true if discovery completed, false if timed out
     */
    private async waitForDiscoveryCompletion(maxWaitMs: number = 3000): Promise<boolean> {
        const pollInterval = 100;
        const maxAttempts = Math.ceil(maxWaitMs / pollInterval);
        let attempts = 0;

        while (attempts < maxAttempts) {
            const healthStatus = this.discoveryService.getHealthStatus();
            if (healthStatus.isComplete) {
                return true;
            }
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
            attempts++;
        }

        return false;
    }

    /**
     * Safely shutdown a worker, handling all state transitions.
     * @param worker The worker instance to shutdown
     * @param identifier Task queue name or identifier for logging
     * @param startedAt Optional start time for uptime calculation
     * @returns true if shutdown was initiated, false if already stopped/stopping
     */
    private safeShutdownWorker(
        worker: Worker,
        identifier: string,
        startedAt?: Date | null,
    ): boolean {
        try {
            const workerState = worker.getState();

            if (
                workerState === 'INITIALIZED' ||
                workerState === 'RUNNING' ||
                workerState === 'FAILED'
            ) {
                worker.shutdown();
                if (startedAt) {
                    const uptime = Math.round((Date.now() - startedAt.getTime()) / 1000);
                    this.logger.info(`Worker '${identifier}' stopped (uptime: ${uptime}s)`);
                } else {
                    this.logger.verbose(`Worker '${identifier}' shut down`);
                }
                return true;
            }

            if (
                workerState === 'STOPPING' ||
                workerState === 'DRAINING' ||
                workerState === 'DRAINED'
            ) {
                this.logger.verbose(
                    `Worker '${identifier}' already shutting down (${workerState})`,
                );
                return false;
            }

            if (workerState === 'STOPPED') {
                this.logger.verbose(`Worker '${identifier}' already stopped`);
                return false;
            }

            return false;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (
                msg.includes('Not running') ||
                msg.includes('DRAINING') ||
                msg.includes('STOPPING')
            ) {
                this.logger.verbose(`Worker '${identifier}' already shutting down`);
                return false;
            }
            throw error;
        }
    }

    private extractErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        if (typeof error === 'string') {
            return error;
        }
        return 'Unknown error';
    }
}
