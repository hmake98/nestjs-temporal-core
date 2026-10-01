import { Test } from '@nestjs/testing';
import { DiscoveryService } from '@nestjs/core';
import { ScheduleNotFoundError } from '@temporalio/client';
import { TEMPORAL_CLIENT, TEMPORAL_MODULE_OPTIONS } from '../../src/constants';
import { TemporalClientError } from '../../src/errors';
import { TemporalService } from '../../src/services/temporal.service';
import { TemporalClientService } from '../../src/services/temporal-client.service';
import { TemporalWorkerManagerService } from '../../src/services/temporal-worker.service';
import { TemporalScheduleService } from '../../src/services/temporal-schedule.service';
import { TemporalDiscoveryService } from '../../src/services/temporal-discovery.service';
import { TemporalMetadataAccessor } from '../../src/services/temporal-metadata.service';

const options = {
    taskQueue: 'q',
    connection: { address: 'localhost:7233', namespace: 'default' },
    enableLogger: false,
};

describe('TemporalScheduleService result envelopes keep the cause', () => {
    const boom = new Error('boom');
    const thrown = 'plain string';
    let service: TemporalScheduleService;
    let handle: Record<string, jest.Mock>;
    let scheduleClient: Record<string, jest.Mock>;

    beforeEach(async () => {
        handle = {
            pause: jest.fn(),
            unpause: jest.fn(),
            trigger: jest.fn(),
            delete: jest.fn(),
            update: jest.fn(),
            describe: jest.fn(),
        };
        scheduleClient = {
            create: jest.fn().mockResolvedValue(handle),
            getHandle: jest.fn().mockReturnValue(handle),
            list: jest.fn(),
        };
        const module = await Test.createTestingModule({
            providers: [
                TemporalScheduleService,
                { provide: TEMPORAL_MODULE_OPTIONS, useValue: options },
                {
                    provide: TEMPORAL_CLIENT,
                    useValue: { schedule: scheduleClient, connection: {} },
                },
                {
                    provide: DiscoveryService,
                    useValue: { getProviders: () => [], getControllers: () => [] },
                },
                { provide: TemporalMetadataAccessor, useValue: { isActivity: () => false } },
            ],
        }).compile();
        service = module.get(TemporalScheduleService);
        await service.onModuleInit();
    });

    const scheduleOptions = {
        scheduleId: 's1',
        spec: { cronExpressions: ['* * * * *'] },
        action: { type: 'startWorkflow' as const, workflowType: 'wf', taskQueue: 'q' },
    };

    const rows: Array<
        [
            string,
            (s: TemporalScheduleService) => Promise<{ success: boolean; error?: Error }>,
            () => void,
        ]
    > = [
        [
            'createSchedule',
            (s) => s.createSchedule(scheduleOptions),
            (v) => scheduleClient.create.mockRejectedValue(v) as any,
        ],
        [
            'upsertSchedule',
            (s) => s.upsertSchedule(scheduleOptions),
            (v) => handle.describe.mockRejectedValue(v) as any,
        ],
        [
            'pauseSchedule',
            (s) => s.pauseSchedule('s1'),
            (v) => handle.pause.mockRejectedValue(v) as any,
        ],
        [
            'triggerSchedule',
            (s) => s.triggerSchedule('s1'),
            (v) => handle.trigger.mockRejectedValue(v) as any,
        ],
        [
            'deleteSchedule',
            (s) => s.deleteSchedule('s1'),
            (v) => handle.delete.mockRejectedValue(v) as any,
        ],
        [
            'updateSchedule',
            (s) => s.updateSchedule('s1', (p) => p as any),
            (v) => handle.update.mockRejectedValue(v) as any,
        ],
        [
            'describeSchedule',
            (s) => s.describeSchedule('s1'),
            (v) => handle.describe.mockRejectedValue(v) as any,
        ],
    ] as any;

    it.each(rows)('%s returns the original Error unchanged', async (_n, call, arm) => {
        (arm as any)(boom);
        const result = await call(service);
        expect(result.success).toBe(false);
        expect(result.error).toBe(boom);
    });

    it.each(rows)('%s wraps a non-Error throw with cause', async (_n, call, arm) => {
        (arm as any)(thrown);
        const result = await call(service);
        expect(result.success).toBe(false);
        expect(result.error).toBeInstanceOf(TemporalClientError);
        expect((result.error as TemporalClientError).cause).toBe(thrown);
    });

    describe('upsert / update / delete lifecycle', () => {
        it('creates when the schedule is missing, then updates on repeat without error', async () => {
            handle.describe.mockRejectedValueOnce(new ScheduleNotFoundError('nf', 's1'));
            const first = await service.upsertSchedule(scheduleOptions);
            expect(first).toMatchObject({ success: true, action: 'created' });

            handle.describe.mockResolvedValue({});
            const second = await service.upsertSchedule(scheduleOptions);
            expect(second).toMatchObject({ success: true, action: 'updated' });
            expect(scheduleClient.create).toHaveBeenCalledTimes(1);
            expect(handle.update).toHaveBeenCalledTimes(1);
        });

        it('delete of a missing id reports the original ScheduleNotFoundError', async () => {
            const missing = new ScheduleNotFoundError('nf', 'nope');
            handle.delete.mockRejectedValue(missing);
            const result = await service.deleteSchedule('nope');
            expect(result.success).toBe(false);
            expect(result.error).toBe(missing);
        });
    });
});

describe('TemporalService facade', () => {
    const thrown = { weird: true };
    let service: TemporalService;
    let clientService: Record<string, jest.Mock>;
    let scheduleService: Record<string, jest.Mock>;

    beforeEach(async () => {
        clientService = {
            isHealthy: jest.fn().mockReturnValue(true),
            startWorkflow: jest.fn().mockRejectedValue(thrown),
            signalWorkflow: jest.fn().mockRejectedValue(thrown),
            queryWorkflow: jest.fn().mockRejectedValue(thrown),
            terminateWorkflow: jest.fn().mockRejectedValue(thrown),
            cancelWorkflow: jest.fn().mockRejectedValue(thrown),
        };
        scheduleService = {
            isHealthy: jest.fn().mockReturnValue(true),
            getScheduleStats: jest.fn().mockReturnValue({ total: 0, active: 0, paused: 0 }),
            upsertSchedule: jest.fn().mockResolvedValue({ success: true, action: 'created' }),
            updateSchedule: jest.fn().mockResolvedValue({ success: true }),
            deleteSchedule: jest.fn().mockResolvedValue({ success: true }),
        };
        const module = await Test.createTestingModule({
            providers: [
                TemporalService,
                { provide: TEMPORAL_MODULE_OPTIONS, useValue: options },
                { provide: TemporalClientService, useValue: clientService },
                {
                    provide: TemporalWorkerManagerService,
                    useValue: {
                        isWorkerAvailable: () => true,
                        getWorkerStatus: () => ({ isInitialized: true, isRunning: true }),
                    },
                },
                { provide: TemporalScheduleService, useValue: scheduleService },
                {
                    provide: TemporalDiscoveryService,
                    useValue: {
                        getHealthStatus: () => ({ isComplete: true, status: 'healthy' }),
                        getStats: () => ({ classes: 0, methods: 0, total: 0 }),
                        getActivityNames: () => [],
                    },
                },
                { provide: TemporalMetadataAccessor, useValue: {} },
            ],
        }).compile();
        service = module.get(TemporalService);
    });

    it('wraps non-Error client failures with cause in result envelopes', async () => {
        await service.onModuleInit();
        const results = await Promise.all([
            service.terminateWorkflow('w1'),
            service.cancelWorkflow('w1'),
        ]);
        for (const r of results) {
            expect(r.success).toBe(false);
            expect(r.error).toBeInstanceOf(TemporalClientError);
            expect((r.error as TemporalClientError).cause).toBe(thrown);
        }
    });

    it('throws a TemporalClientError with cause from start, signal and query', async () => {
        await service.onModuleInit();
        for (const call of [
            () => service.startWorkflow('wf', [], { taskQueue: 'q' } as any),
            () => service.signalWorkflow('w1', 'sig'),
            () => service.queryWorkflow('w1', 'qry'),
        ]) {
            const error = await call().catch((e) => e);
            expect(error).toBeInstanceOf(TemporalClientError);
            expect(error.cause).toBe(thrown);
        }
    });

    describe('schedule methods', () => {
        it('delegate to the schedule service once initialized', async () => {
            await service.onModuleInit();
            const fn = (p: any) => p;
            const opts: any = { scheduleId: 's1' };

            await expect(service.upsertSchedule(opts)).resolves.toMatchObject({ success: true });
            await expect(service.updateSchedule('s1', fn)).resolves.toMatchObject({
                success: true,
            });
            await expect(service.deleteSchedule('s1')).resolves.toMatchObject({ success: true });

            expect(scheduleService.upsertSchedule).toHaveBeenCalledWith(opts);
            expect(scheduleService.updateSchedule).toHaveBeenCalledWith('s1', fn);
            expect(scheduleService.deleteSchedule).toHaveBeenCalledWith('s1');
        });

        it('throw before initialization', async () => {
            await expect(service.upsertSchedule({} as any)).rejects.toThrow('not initialized');
            await expect(service.updateSchedule('s1', (p) => p as any)).rejects.toThrow(
                'not initialized',
            );
            await expect(service.deleteSchedule('s1')).rejects.toThrow('not initialized');
        });
    });
});
