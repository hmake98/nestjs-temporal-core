import { DynamicModule, Module } from '@nestjs/common';
import { TEMPORAL_HEALTH_OPTIONS } from '../constants';
import { TemporalHealthOptions } from '../interfaces';
import { TemporalHealthController } from './temporal-health.controller';

/**
 * Temporal Health Module
 *
 * Provides health check endpoints for Temporal components.
 * Import this module to add health check endpoints to your application.
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [
 *     TemporalModule.register({
 *       connection: { address: 'localhost:7233' },
 *       taskQueue: 'default'
 *     }),
 *     TemporalHealthModule // Add health check endpoints
 *   ]
 * })
 * export class AppModule {}
 * ```
 *
 * This will add the following endpoints:
 * - GET /temporal/health - Overall system health
 */
@Module({
    controllers: [TemporalHealthController],
})
export class TemporalHealthModule {
    /**
     * Configure the endpoint. `detail: 'minimal'` exposes only `{ status, timestamp }`.
     *
     * @example
     * ```typescript
     * TemporalHealthModule.register({ detail: 'minimal' })
     * ```
     */
    static register(options: TemporalHealthOptions = {}): DynamicModule {
        return {
            module: TemporalHealthModule,
            providers: [{ provide: TEMPORAL_HEALTH_OPTIONS, useValue: options }],
        };
    }
}
