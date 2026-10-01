import { Controller, Get, Inject, Optional } from '@nestjs/common';
import { TemporalService } from '../services/temporal.service';
import { TEMPORAL_HEALTH_OPTIONS } from '../constants';
import { HealthResponse, MinimalHealthResponse, TemporalHealthOptions } from '../interfaces';

/**
 * Health check controller for Temporal components
 *
 * Provides a single comprehensive health endpoint that returns overall system health
 * with detailed metrics for all components including client, worker, discovery, schedules, and metadata.
 */
@Controller('temporal/health')
export class TemporalHealthController {
    constructor(
        private readonly temporalService: TemporalService,
        @Optional()
        @Inject(TEMPORAL_HEALTH_OPTIONS)
        private readonly healthOptions?: TemporalHealthOptions,
    ) {}

    /**
     * Get comprehensive system health status
     *
     * Returns detailed health information for all Temporal components including:
     * - Overall system status (healthy/degraded/unhealthy)
     * - Client connection status and health
     * - Worker status, availability, and activity count
     * - Discovery service status and discovered activities
     * - Schedule service status and schedule counts
     * - Metadata statistics (classes, methods, totals)
     * - Component health summary with counts
     *
     * @returns Promise<HealthResponse> Comprehensive health status
     */
    @Get()
    async getHealth(): Promise<HealthResponse | MinimalHealthResponse> {
        const overallHealth = await this.temporalService.getOverallHealth();

        if (this.healthOptions?.detail === 'minimal') {
            return {
                status: overallHealth.status,
                timestamp: overallHealth.timestamp.toISOString(),
            };
        }

        const serviceStats = this.temporalService.getStats();
        const workerStatus = this.temporalService.getWorkerStatus();

        // Calculate component health summary
        const components = overallHealth.components;
        const healthyComponents = Object.values(components).filter(
            (component) => component.status === 'healthy',
        ).length;
        const degradedComponents = Object.values(components).filter(
            (component) => component.status === 'degraded',
        ).length;
        const unhealthyComponents = Object.values(components).filter(
            (component) => component.status === 'unhealthy',
        ).length;

        return {
            status: overallHealth.status,
            timestamp: overallHealth.timestamp.toISOString(),
            uptime: process.uptime(),
            client: {
                available: serviceStats.client.isConnected,
                healthy: serviceStats.client.isHealthy,
                connected: serviceStats.client.isConnected,
            },
            worker: {
                available: this.temporalService.hasWorker(),
                running: workerStatus?.isRunning || false,
                healthy: workerStatus?.isHealthy || false,
                activitiesCount: serviceStats.worker.activitiesCount,
            },
            discovery: {
                activities: serviceStats.discovery.discoveredCount,
                complete: serviceStats.discovery.isComplete,
                discoveredCount: serviceStats.discovery.discoveredCount,
            },
            schedules: {
                total: serviceStats.schedules.total,
                active: serviceStats.schedules.active,
                paused: serviceStats.schedules.paused,
            },
            metadata: {
                classes: serviceStats.activities.classes,
                methods: serviceStats.activities.methods,
                total: serviceStats.activities.total,
            },
            summary: {
                totalComponents: Object.keys(components).length,
                healthyComponents,
                degradedComponents,
                unhealthyComponents,
            },
        };
    }
}
