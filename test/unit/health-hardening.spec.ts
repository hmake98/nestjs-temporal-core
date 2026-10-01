import { Test } from '@nestjs/testing';
import { HealthCheckError } from '@nestjs/terminus';
import { TEMPORAL_HEALTH_OPTIONS } from '../../src/constants';
import { TemporalHealthController } from '../../src/health/temporal-health.controller';
import { TemporalHealthModule } from '../../src/health/temporal-health.module';
import { TemporalService } from '../../src/services/temporal.service';
import { TemporalHealthIndicator } from '../../src/terminus';

const makeService = (overrides: Record<string, unknown> = {}) => ({
    getOverallHealth: jest.fn().mockResolvedValue({
        status: 'healthy',
        timestamp: new Date('2026-01-01T00:00:00Z'),
        components: { client: { status: 'healthy' }, worker: { status: 'degraded' } },
    }),
    getStats: jest.fn().mockReturnValue({
        client: { isConnected: true, isHealthy: true },
        worker: { activitiesCount: 3 },
        discovery: { discoveredCount: 3, isComplete: true },
        schedules: { total: 1, active: 1, paused: 0 },
        activities: { classes: 1, methods: 3, total: 3 },
    }),
    getWorkerStatus: jest.fn().mockReturnValue({ isRunning: true, isHealthy: true }),
    hasWorker: jest.fn().mockReturnValue(true),
    isWorkerRunning: jest.fn().mockReturnValue(true),
    ...overrides,
});

async function controllerWith(options: unknown, service = makeService()) {
    const providers: any[] = [{ provide: TemporalService, useValue: service }];
    if (options !== undefined)
        providers.push({ provide: TEMPORAL_HEALTH_OPTIONS, useValue: options });
    const ref = await Test.createTestingModule({
        controllers: [TemporalHealthController],
        providers,
    }).compile();
    return ref.get(TemporalHealthController);
}

describe('TemporalHealthController detail levels', () => {
    it('returns the full response by default, with or without options', async () => {
        for (const options of [undefined, {}, { detail: 'full' }]) {
            const body: any = await (await controllerWith(options)).getHealth();
            expect(body.client).toEqual({ available: true, healthy: true, connected: true });
            expect(body.summary.totalComponents).toBe(2);
            expect(body.uptime).toEqual(expect.any(Number));
        }
    });

    it("'minimal' returns only status and timestamp", async () => {
        const body = await (await controllerWith({ detail: 'minimal' })).getHealth();

        expect(body).toEqual({ status: 'healthy', timestamp: '2026-01-01T00:00:00.000Z' });
    });

    it("'minimal' does not even gather detailed stats", async () => {
        const service = makeService();

        await (await controllerWith({ detail: 'minimal' }, service)).getHealth();

        expect(service.getStats).not.toHaveBeenCalled();
    });
});

describe('TemporalHealthModule.register', () => {
    it('provides the options to the controller', () => {
        const dynamic = TemporalHealthModule.register({ detail: 'minimal' });

        expect(dynamic.module).toBe(TemporalHealthModule);
        expect(dynamic.providers).toEqual([
            { provide: TEMPORAL_HEALTH_OPTIONS, useValue: { detail: 'minimal' } },
        ]);
    });

    it('defaults to empty options', () => {
        expect((TemporalHealthModule.register().providers as any[])[0].useValue).toEqual({});
    });
});

describe('TemporalHealthIndicator (Terminus)', () => {
    async function indicatorWith(service: unknown) {
        const ref = await Test.createTestingModule({
            providers: [TemporalHealthIndicator, { provide: TemporalService, useValue: service }],
        }).compile();
        return ref.get(TemporalHealthIndicator);
    }

    it('reports up when healthy, exposing only the status', async () => {
        const indicator = await indicatorWith(makeService());

        await expect(indicator.isHealthy()).resolves.toEqual({
            temporal: { status: 'up', state: 'healthy' },
        });
    });

    it('uses a custom key', async () => {
        const indicator = await indicatorWith(makeService());

        expect(Object.keys(await indicator.isHealthy('workflows'))).toEqual(['workflows']);
    });

    it.each(['degraded', 'unhealthy'])('throws HealthCheckError when %s', async (status) => {
        const indicator = await indicatorWith(
            makeService({
                getOverallHealth: jest.fn().mockResolvedValue({ status, timestamp: new Date() }),
            }),
        );

        const error: any = await indicator.isHealthy().catch((e) => e);

        expect(error).toBeInstanceOf(HealthCheckError);
        expect(error.causes.temporal).toEqual({ status: 'down', state: status });
    });

    it('treats a failing health lookup as down without leaking the error', async () => {
        const indicator = await indicatorWith(
            makeService({
                getOverallHealth: jest.fn().mockRejectedValue(new Error('db password=x')),
            }),
        );

        const error: any = await indicator.isHealthy().catch((e) => e);

        expect(error).toBeInstanceOf(HealthCheckError);
        expect(JSON.stringify(error.causes)).not.toContain('password');
    });

    it('requireWorker fails when no worker is running', async () => {
        const indicator = await indicatorWith(
            makeService({ isWorkerRunning: jest.fn().mockReturnValue(false) }),
        );

        await expect(indicator.isHealthy('temporal')).resolves.toBeDefined();
        await expect(
            indicator.isHealthy('temporal', { requireWorker: true }),
        ).rejects.toBeInstanceOf(HealthCheckError);
    });
});
