import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Client, Connection } from '@temporalio/client';
import { NativeConnection } from '@temporalio/worker';
import { TemporalOptions } from '../interfaces';
import { withCorrelationClientInterceptors } from '../observability/apply';
import { installRuntime } from '../observability/runtime';
import { enforceConnectionSecurity } from '../security';
import { createLogger, LoggerUtils, TemporalLogger } from '../utils/logger';

/**
 * Centralized factory for creating and managing Temporal connections
 *
 * This factory handles:
 * - Client connection creation with proper error handling
 * - Worker connection (NativeConnection) creation
 * - Connection reuse and caching
 * - Connection health monitoring
 * - Graceful connection cleanup
 */
@Injectable()
export class TemporalConnectionFactory implements OnModuleDestroy {
    private readonly logger: TemporalLogger;
    private clientConnectionCache = new Map<string, Client>();
    private workerConnectionCache = new Map<string, NativeConnection>();
    private connectionAttempts = new Map<string, number>();

    private readonly MAX_RETRY_ATTEMPTS = 3;
    private readonly RETRY_DELAY_MS = 1000;

    constructor() {
        this.logger = createLogger(TemporalConnectionFactory.name);
    }

    /**
     * Create or retrieve a cached Temporal client
     */
    async createClient(options: TemporalOptions): Promise<Client | null> {
        installRuntime(options.runtime);
        enforceConnectionSecurity(options);
        if (!options.connection) {
            this.logger.info('No connection configuration provided - running without client');
            return null;
        }

        const connectionKey = this.getConnectionKey(options.connection);

        // Return cached client if available and healthy
        const cachedClient = this.clientConnectionCache.get(connectionKey);
        if (cachedClient && this.isClientHealthy(cachedClient)) {
            this.logger.debug('Reusing cached client connection');
            return cachedClient;
        }

        // Clean up unhealthy cached client
        if (cachedClient) {
            this.clientConnectionCache.delete(connectionKey);
        }

        return this.createNewClient(options, connectionKey);
    }

    /**
     * Create or retrieve a cached worker connection (NativeConnection)
     */
    async createWorkerConnection(options: TemporalOptions): Promise<NativeConnection | null> {
        installRuntime(options.runtime);
        enforceConnectionSecurity(options);
        if (!options.connection) {
            this.logger.debug('No connection configuration provided for worker');
            return null;
        }

        const connectionKey = this.getConnectionKey(options.connection);

        // Return cached connection if available
        const cachedConnection = this.workerConnectionCache.get(connectionKey);
        if (cachedConnection && this.isWorkerConnectionHealthy(cachedConnection)) {
            this.logger.debug('Reusing cached worker connection');
            return cachedConnection;
        }

        // Clean up unhealthy cached connection
        if (cachedConnection) {
            try {
                await cachedConnection.close();
            } catch (error) {
                this.logger.warn('Failed to close unhealthy worker connection', error);
            }
            this.workerConnectionCache.delete(connectionKey);
        }

        return this.createNewWorkerConnection(options, connectionKey);
    }

    /**
     * Lifecycle hook - cleanup connections on module destroy
     */
    async onModuleDestroy(): Promise<void> {
        await this.cleanup();
    }

    /**
     * Cleanup all connections
     *
     * Note: Worker connections are NOT closed here as they may still be held by workers
     * during shutdown. Workers manage their own connection lifecycle and will close
     * connections when they are fully stopped. Attempting to close connections here
     * would result in "Cannot close connection while Workers hold a reference" errors.
     */
    async cleanup(): Promise<void> {
        this.logger.info('Cleaning up all connections...');

        // We do NOT close worker connections here because:
        // 1. Workers may still be in STOPPING/DRAINING state during onModuleDestroy
        // 2. Temporal SDK will throw if we try to close a connection with active worker references
        // 3. The worker service (TemporalWorkerManagerService) handles connection cleanup
        //    as part of its own shutdown process
        this.logger.debug(
            'Skipping worker connection cleanup - managed by worker service lifecycle',
        );

        // Clear caches (connections will be garbage collected once workers release them)
        this.clientConnectionCache.clear();
        this.workerConnectionCache.clear();
        this.connectionAttempts.clear();

        this.logger.info('Connection cleanup completed');
    }

    /**
     * Get connection health status
     */
    getConnectionHealth(): {
        clientConnections: number;
        workerConnections: number;
        totalAttempts: number;
    } {
        return {
            clientConnections: this.clientConnectionCache.size,
            workerConnections: this.workerConnectionCache.size,
            totalAttempts: Array.from(this.connectionAttempts.values()).reduce(
                (sum, attempts) => sum + attempts,
                0,
            ),
        };
    }

    private async createNewClient(
        options: TemporalOptions,
        connectionKey: string,
    ): Promise<Client | null> {
        const attempts = this.connectionAttempts.get(connectionKey) || 0;

        if (attempts >= this.MAX_RETRY_ATTEMPTS) {
            if (options.allowConnectionFailure !== false) {
                this.logger.warn(
                    `Max retry attempts exceeded for ${options.connection!.address} - running without client`,
                );
                return null;
            } else {
                throw new Error(
                    `Failed to connect to ${options.connection!.address} after ${this.MAX_RETRY_ATTEMPTS} attempts`,
                );
            }
        }

        try {
            this.logger.info(
                `Creating new client connection to ${options.connection!.address} (attempt ${attempts + 1})`,
            );

            // Create connection using Connection.lazy() which is more reliable
            const connection = await Connection.lazy({
                address: options.connection!.address,
                tls: options.connection!.tls,
                metadata: options.connection!.metadata,
                ...(options.connection!.apiKey && {
                    metadata: {
                        ...(options.connection!.metadata || {}),
                        authorization: `Bearer ${options.connection!.apiKey}`,
                    },
                }),
            });

            // Create client with the connection
            const client = new Client({
                connection,
                namespace: options.connection!.namespace || 'default',
                ...((options.connection!.interceptors || options.correlation) && {
                    interceptors: withCorrelationClientInterceptors(
                        options.connection!.interceptors,
                        options.correlation,
                    ),
                }),
                ...((options.connection!.dataConverter ?? options.dataConverter) && {
                    dataConverter: options.connection!.dataConverter ?? options.dataConverter,
                }),
            });

            // Cache the successful connection
            this.clientConnectionCache.set(connectionKey, client);
            this.connectionAttempts.delete(connectionKey); // Reset attempts on success

            LoggerUtils.logConnection(this.logger, options.connection!.address, true);
            return client;
        } catch (error) {
            this.connectionAttempts.set(connectionKey, attempts + 1);
            LoggerUtils.logConnection(
                this.logger,
                options.connection!.address,
                false,
                error as Error,
            );

            if (attempts + 1 < this.MAX_RETRY_ATTEMPTS) {
                this.logger.info(`Retrying connection in ${this.RETRY_DELAY_MS}ms...`);
                await this.delay(this.RETRY_DELAY_MS);
                return this.createNewClient(options, connectionKey);
            }

            if (options.allowConnectionFailure !== false) {
                this.logger.warn('Client connection failed - continuing without client');
                return null;
            }

            throw error;
        }
    }

    private async createNewWorkerConnection(
        options: TemporalOptions,
        connectionKey: string,
    ): Promise<NativeConnection | null> {
        try {
            this.logger.debug(`Creating new worker connection to ${options.connection!.address}`);

            const { NativeConnection } = await import('@temporalio/worker');
            const address = options.connection!.address;

            const connectOptions: {
                address: string;
                tls?: boolean | null;
                metadata?: Record<string, string>;
                grpcCompression?: NonNullable<TemporalOptions['connection']>['grpcCompression'];
            } = {
                address,
                tls: options.connection!.tls as boolean | null,
            };

            if (options.connection!.apiKey) {
                connectOptions.metadata = {
                    ...(options.connection!.metadata || {}),
                    authorization: `Bearer ${options.connection!.apiKey}`,
                };
            }

            if (options.connection!.grpcCompression) {
                connectOptions.grpcCompression = options.connection!.grpcCompression;
            }

            const connection = await NativeConnection.connect(connectOptions);
            this.workerConnectionCache.set(connectionKey, connection);

            this.logger.info(`Worker connection established to ${address}`);
            return connection;
        } catch (error) {
            this.logger.warn('Failed to create worker connection, returning null', error);
            return null;
        }
    }

    private getConnectionKey(connection: NonNullable<TemporalOptions['connection']>): string {
        return `${connection.address}:${connection.namespace || 'default'}:${connection.apiKey ? 'auth' : 'noauth'}`;
    }

    private isClientHealthy(client: Client): boolean {
        try {
            // Simple health check - verify the client has the workflow property
            return Boolean(client.workflow);
        } catch {
            return false;
        }
    }

    private isWorkerConnectionHealthy(connection: NativeConnection): boolean {
        try {
            // Basic health check - verify the connection object has expected structure
            // This could throw if the connection object is malformed
            return (
                connection !== null &&
                connection !== undefined &&
                typeof connection === 'object' &&
                connection.constructor !== undefined
            );
        } catch {
            return false;
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
