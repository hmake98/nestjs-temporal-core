import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { TemporalService } from './services/temporal.service';
import {
    ACTIVITY_MODULE_OPTIONS,
    TEMPORAL_CLIENT,
    TEMPORAL_CONNECTION,
    TEMPORAL_MODULE_OPTIONS,
} from './constants';
import { TemporalDiscoveryService } from './services/temporal-discovery.service';
import { TemporalClientService } from './services/temporal-client.service';
import { TemporalScheduleService } from './services/temporal-schedule.service';
import { TemporalWorkerManagerService } from './services/temporal-worker.service';
import { TemporalMetadataAccessor } from './services/temporal-metadata.service';
import { TemporalLoggerManager } from './utils/logger';
import { TemporalOptions } from './interfaces';
import { TemporalAsyncOptions, TemporalOptionsFactory } from './interfaces';
import { TemporalConnectionFactory } from './providers/temporal-connection.factory';
import { WorkflowProxyFactory } from './workflow-proxy/workflow-proxy.factory';

/**
 * Main Temporal module for NestJS applications.
 *
 * This module provides:
 * - Temporal client connection management with connection pooling
 * - Worker creation and lifecycle management
 * - Activity and workflow discovery
 * - Schedule management
 * - Comprehensive logging and error handling
 * - Graceful degradation and fault tolerance
 * - Automatic shutdown hook registration for graceful termination (call app.enableShutdownHooks())
 *
 * IMPORTANT: To ensure graceful worker shutdown, you must call app.enableShutdownHooks()
 * in your main.ts file after creating the NestJS application:
 *
 * @example
 * ```typescript
 * async function bootstrap() {
 *   const app = await NestFactory.create(AppModule);
 *   app.enableShutdownHooks(); // Required for graceful worker shutdown
 *   await app.listen(3000);
 * }
 * ```
 */
@Module({})
export class TemporalModule {
    static register(options: Partial<TemporalOptions> = {}): DynamicModule {
        this.validateOptions(options);

        const providers: Provider[] = this.createCoreProviders(options);

        return {
            module: TemporalModule,
            imports: [DiscoveryModule],
            providers,
            exports: [
                TemporalService,
                TemporalLoggerManager,
                TEMPORAL_MODULE_OPTIONS,
                WorkflowProxyFactory,
            ],
            global: options.isGlobal,
        };
    }

    static registerAsync(options: TemporalAsyncOptions): DynamicModule {
        this.validateAsyncOptions(options);

        const imports: (DynamicModule | typeof DiscoveryModule | Type<unknown>)[] = [
            DiscoveryModule,
        ];
        const providers: Provider[] = [];

        // Add imports from options
        if (options.imports) {
            for (const importModule of options.imports) {
                if (typeof importModule === 'function') {
                    // It's a class/module
                    imports.push(importModule);
                } else if (typeof importModule === 'object' && importModule !== null) {
                    // It's likely a DynamicModule
                    imports.push(importModule as DynamicModule);
                }
            }
        }

        // Add the factory class as a provider when using useClass
        if (options.useClass) {
            providers.push(options.useClass);
        }

        // Create async options provider
        providers.push(this.createAsyncOptionsProvider(options));

        // Add core providers that depend on async options
        providers.push(...this.createCoreAsyncProviders());

        return {
            module: TemporalModule,
            imports,
            providers,
            exports: [
                TemporalService,
                TemporalLoggerManager,
                TEMPORAL_MODULE_OPTIONS,
                WorkflowProxyFactory,
            ],
            global: options.isGlobal,
        };
    }

    private static createCoreProviders(options: Partial<TemporalOptions>): Provider[] {
        return [
            // Module options
            {
                provide: TEMPORAL_MODULE_OPTIONS,
                useValue: options,
            },

            // Connection factory (centralized connection management)
            TemporalConnectionFactory,

            // Client provider using connection factory
            {
                provide: TEMPORAL_CLIENT,
                useFactory: async (
                    connectionFactory: TemporalConnectionFactory,
                    temporalOptions: Partial<TemporalOptions>,
                ) => {
                    return connectionFactory.createClient(temporalOptions as TemporalOptions);
                },
                inject: [TemporalConnectionFactory, TEMPORAL_MODULE_OPTIONS],
            },

            // Worker connection provider using connection factory
            {
                provide: TEMPORAL_CONNECTION,
                useFactory: async (
                    connectionFactory: TemporalConnectionFactory,
                    temporalOptions: Partial<TemporalOptions>,
                ) => {
                    return connectionFactory.createWorkerConnection(
                        temporalOptions as TemporalOptions,
                    );
                },
                inject: [TemporalConnectionFactory, TEMPORAL_MODULE_OPTIONS],
            },

            // Activity module options
            {
                provide: ACTIVITY_MODULE_OPTIONS,
                useValue: {
                    activityClasses: options.worker?.activityClasses || [],
                },
            },

            // Logger manager
            {
                provide: TemporalLoggerManager,
                useFactory: (temporalOptions: Partial<TemporalOptions>) => {
                    const manager = TemporalLoggerManager.getInstance();
                    manager.configure({
                        enableLogger: temporalOptions.enableLogger,
                        logLevel: temporalOptions.logLevel,
                        muteErrors: temporalOptions.muteErrors,
                        redactKeys: temporalOptions.redactKeys,
                        appName: 'NestJS-Temporal-Core',
                    });
                    return manager;
                },
                inject: [TEMPORAL_MODULE_OPTIONS],
            },

            // Core services
            TemporalClientService,
            TemporalScheduleService,
            TemporalDiscoveryService,
            TemporalWorkerManagerService,
            TemporalMetadataAccessor,
            TemporalService,
            WorkflowProxyFactory,
        ];
    }

    private static createCoreAsyncProviders(): Provider[] {
        return [
            // Connection factory (centralized connection management)
            TemporalConnectionFactory,

            // Client provider using connection factory
            {
                provide: TEMPORAL_CLIENT,
                useFactory: async (
                    connectionFactory: TemporalConnectionFactory,
                    temporalOptions: Partial<TemporalOptions>,
                ) => {
                    return connectionFactory.createClient(temporalOptions as TemporalOptions);
                },
                inject: [TemporalConnectionFactory, TEMPORAL_MODULE_OPTIONS],
            },

            // Worker connection provider using connection factory
            {
                provide: TEMPORAL_CONNECTION,
                useFactory: async (
                    connectionFactory: TemporalConnectionFactory,
                    temporalOptions: Partial<TemporalOptions>,
                ) => {
                    return connectionFactory.createWorkerConnection(
                        temporalOptions as TemporalOptions,
                    );
                },
                inject: [TemporalConnectionFactory, TEMPORAL_MODULE_OPTIONS],
            },

            // Activity module options
            {
                provide: ACTIVITY_MODULE_OPTIONS,
                useFactory: (temporalOptions: Partial<TemporalOptions>) => {
                    return {
                        activityClasses: temporalOptions.worker?.activityClasses || [],
                    };
                },
                inject: [TEMPORAL_MODULE_OPTIONS],
            },

            // Logger manager
            {
                provide: TemporalLoggerManager,
                useFactory: (temporalOptions: Partial<TemporalOptions>) => {
                    const manager = TemporalLoggerManager.getInstance();
                    manager.configure({
                        enableLogger: temporalOptions.enableLogger,
                        logLevel: temporalOptions.logLevel,
                        muteErrors: temporalOptions.muteErrors,
                        redactKeys: temporalOptions.redactKeys,
                        appName: 'NestJS-Temporal-Core',
                    });
                    return manager;
                },
                inject: [TEMPORAL_MODULE_OPTIONS],
            },

            // Core services
            TemporalClientService,
            TemporalScheduleService,
            TemporalDiscoveryService,
            TemporalWorkerManagerService,
            TemporalMetadataAccessor,
            TemporalService,
            WorkflowProxyFactory,
        ];
    }

    private static createAsyncOptionsProvider(options: TemporalAsyncOptions): Provider {
        if (options.useFactory) {
            return {
                provide: TEMPORAL_MODULE_OPTIONS,
                useFactory: options.useFactory,
                inject:
                    (options.inject as (
                        | import('@nestjs/common').InjectionToken
                        | import('@nestjs/common').OptionalFactoryDependency
                    )[]) || [],
            };
        } else if (options.useClass) {
            return {
                provide: TEMPORAL_MODULE_OPTIONS,
                useFactory: async (optionsFactory: TemporalOptionsFactory) =>
                    optionsFactory.createTemporalOptions(),
                inject: [options.useClass],
            };
        } else if (options.useExisting) {
            return {
                provide: TEMPORAL_MODULE_OPTIONS,
                useFactory: async (optionsFactory: TemporalOptionsFactory) =>
                    optionsFactory.createTemporalOptions(),
                inject: [options.useExisting],
            };
        } else {
            throw new Error('Invalid async options configuration');
        }
    }

    /**
     * Validate synchronous options
     */
    private static validateOptions(options: Partial<TemporalOptions>): void {
        if (!options) {
            return; // Allow empty options for minimal configuration
        }

        // Validate connection configuration if provided
        if (options.connection) {
            if (!options.connection.address || !options.connection.address.trim()) {
                throw new Error('Connection address is required when connection is configured');
            }

            // Validate address format (basic check)
            if (!options.connection.address.includes(':')) {
                throw new Error('Connection address must include port (e.g., localhost:7233)');
            }
        }

        // Validate worker configuration if provided
        if (options.worker) {
            const hasWorkflowsPath = Boolean(options.worker.workflowsPath);
            const hasWorkflowBundle = Boolean(options.worker.workflowBundle);

            if (hasWorkflowsPath && hasWorkflowBundle) {
                throw new Error('Worker cannot have both workflowsPath and workflowBundle');
            }

            // Validate task queue if provided
            if (options.taskQueue && options.taskQueue.trim().length === 0) {
                throw new Error('Task queue cannot be empty string');
            }
        }

        // Validate logger configuration
        if (
            options.logLevel &&
            !['error', 'warn', 'info', 'debug', 'verbose'].includes(options.logLevel)
        ) {
            throw new Error(`Invalid log level: ${options.logLevel}`);
        }
    }

    /**
     * Validate asynchronous options
     */
    private static validateAsyncOptions(options: TemporalAsyncOptions): void {
        const hasFactory = Boolean(options.useFactory);
        const hasClass = Boolean(options.useClass);
        const hasExisting = Boolean(options.useExisting);

        const configMethods = [hasFactory, hasClass, hasExisting].filter(Boolean).length;

        if (configMethods === 0) {
            throw new Error(
                'Invalid Temporal module options: Must provide useFactory, useClass, or useExisting',
            );
        }

        if (configMethods > 1) {
            throw new Error(
                'Invalid Temporal module options: Cannot provide multiple configuration methods',
            );
        }

        // Additional validation for factory options
        if (options.useFactory && options.inject && !Array.isArray(options.inject)) {
            throw new Error('inject option must be an array when using useFactory');
        }
    }
}
