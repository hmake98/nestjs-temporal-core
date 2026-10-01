/**
 * Terminus integration for nestjs-temporal-core. Import from `nestjs-temporal-core/terminus`.
 * Requires the optional peer `@nestjs/terminus`; the main entry never loads it.
 */
import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, type HealthIndicatorResult } from '@nestjs/terminus';
import { TemporalService } from '../services/temporal.service';

/**
 * Terminus health indicator for Temporal. Reports `up`/`down` and exposes no internal
 * detail beyond a status string, so it is safe on a public `/health` route.
 *
 * Register it as a provider and call it from a `HealthCheckService.check([...])`:
 *
 * @example
 * ```typescript
 * @Module({ imports: [TerminusModule], providers: [TemporalHealthIndicator] })
 * class HealthModule {}
 *
 * @Get() @HealthCheck()
 * check() { return this.health.check([() => this.temporal.isHealthy('temporal')]); }
 * ```
 */
@Injectable()
export class TemporalHealthIndicator extends HealthIndicator {
    constructor(private readonly temporalService: TemporalService) {
        super();
    }

    /**
     * @param key result key (default `temporal`)
     * @param options `requireWorker`: also fail when no worker is running
     * @throws HealthCheckError when Temporal is unhealthy, as Terminus expects
     */
    async isHealthy(
        key = 'temporal',
        options: { requireWorker?: boolean } = {},
    ): Promise<HealthIndicatorResult> {
        let status: 'healthy' | 'degraded' | 'unhealthy' = 'unhealthy';
        try {
            status = (await this.temporalService.getOverallHealth()).status;
        } catch {
            // Treated as unhealthy; no internal error text is exposed.
        }

        const workerOk = !options.requireWorker || this.temporalService.isWorkerRunning();
        const healthy = status === 'healthy' && workerOk;
        const result = this.getStatus(key, healthy, { state: status });

        if (!healthy) {
            throw new HealthCheckError('Temporal health check failed', result);
        }
        return result;
    }
}
