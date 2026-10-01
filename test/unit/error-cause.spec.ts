import { Test } from '@nestjs/testing';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { TEMPORAL_CLIENT, TEMPORAL_MODULE_OPTIONS } from '../../src/constants';
import { TemporalClientError } from '../../src/errors';
import { TemporalClientService } from '../../src/services/temporal-client.service';

/**
 * Every client-service wrap site keeps its message text and now attaches the
 * original SDK error as `cause`.
 */
describe('TemporalClientService error causes', () => {
    const boom = Object.assign(new Error('boom'), { code: 14, details: 'unavailable' });
    let service: TemporalClientService;
    let handle: Record<string, jest.Mock>;
    let client: any;

    beforeEach(async () => {
        handle = {
            signal: jest.fn().mockRejectedValue(boom),
            query: jest.fn().mockRejectedValue(boom),
            terminate: jest.fn().mockRejectedValue(boom),
            cancel: jest.fn().mockRejectedValue(boom),
            executeUpdate: jest.fn().mockRejectedValue(boom),
            startUpdate: jest.fn().mockRejectedValue(boom),
        };
        client = {
            workflow: {
                start: jest.fn().mockRejectedValue(boom),
                getHandle: jest.fn().mockReturnValue(handle),
                signalWithStart: jest.fn().mockRejectedValue(boom),
            },
            activity: {
                complete: jest.fn().mockRejectedValue(boom),
                fail: jest.fn().mockRejectedValue(boom),
                heartbeat: jest.fn().mockRejectedValue(boom),
                reportCancellation: jest.fn().mockRejectedValue(boom),
                start: jest.fn().mockRejectedValue(boom),
                execute: jest.fn().mockRejectedValue(boom),
                count: jest.fn().mockRejectedValue(boom),
            },
        };

        const module = await Test.createTestingModule({
            providers: [
                TemporalClientService,
                { provide: TEMPORAL_CLIENT, useValue: client },
                {
                    provide: TEMPORAL_MODULE_OPTIONS,
                    useValue: {
                        taskQueue: 'q',
                        connection: { address: 'localhost:7233', namespace: 'default' },
                        enableLogger: false,
                    },
                },
            ],
        }).compile();
        service = module.get(TemporalClientService);
        await service.onModuleInit();
    });

    const rows: Array<[string, () => Promise<unknown>, string]> = [
        [
            'startWorkflow',
            (s) => s.startWorkflow('wf', [], { taskQueue: 'q', workflowId: 'w1' }),
            "Failed to start workflow 'wf': boom",
        ],
        [
            'terminateWorkflow',
            (s) => s.terminateWorkflow('w1', 'r'),
            'Failed to terminate workflow w1: boom',
        ],
        ['cancelWorkflow', (s) => s.cancelWorkflow('w1'), 'Failed to cancel workflow w1: boom'],
        [
            'signalWorkflow',
            (s) => s.signalWorkflow('w1', 'sig'),
            "Failed to send signal 'sig' to workflow w1: boom",
        ],
        [
            'signalWithStart',
            (s) => s.signalWithStart('wf', [], 'sig', [], { taskQueue: 'q', workflowId: 'w1' }),
            "Failed to signalWithStart workflow 'wf': boom",
        ],
        [
            'queryWorkflow',
            (s) => s.queryWorkflow('w1', 'qry'),
            "Failed to query 'qry' on workflow w1: boom",
        ],
        [
            'updateWorkflow',
            (s) => s.updateWorkflow('w1', 'upd'),
            "Failed to execute update 'upd' on workflow w1: boom",
        ],
        [
            'startUpdateWorkflow',
            (s) => s.startUpdateWorkflow('w1', 'upd'),
            "Failed to start update 'upd' on workflow w1: boom",
        ],
        [
            'completeActivity',
            (s) => s.completeActivity(new Uint8Array([1]), 'r'),
            'Failed to complete activity: boom',
        ],
        [
            'failActivity',
            (s) => s.failActivity(new Uint8Array([1]), new Error('x')),
            'Failed to report activity failure: boom',
        ],
        [
            'heartbeatActivity',
            (s) => s.heartbeatActivity(new Uint8Array([1])),
            'Failed to send activity heartbeat: boom',
        ],
        [
            'reportActivityCancellation',
            (s) => s.reportActivityCancellation(new Uint8Array([1])),
            'Failed to report activity cancellation: boom',
        ],
        [
            'startStandaloneActivity',
            (s) => s.startStandaloneActivity('act', { id: 'a1', taskQueue: 'q' } as any),
            "Failed to start standalone activity 'act': boom",
        ],
        [
            'executeStandaloneActivity',
            (s) => s.executeStandaloneActivity('act', { id: 'a1', taskQueue: 'q' } as any),
            "Failed to execute standalone activity 'act': boom",
        ],
        [
            'countStandaloneActivities',
            (s) => s.countStandaloneActivities('q'),
            'Failed to count standalone activities: boom',
        ],
    ] as any;

    it.each(rows)('%s keeps message and attaches cause', async (_name, call, message) => {
        const error = await (call as any)(service).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(TemporalClientError);
        expect(error.message).toBe(message);
        expect(error.cause).toBe(boom);
        expect(error.grpcCode).toBe(14);
        expect(error.grpcDetails).toBe('unavailable');
    });

    it('getWorkflowHandle keeps message and attaches cause', async () => {
        client.workflow.getHandle.mockImplementation(() => {
            throw boom;
        });

        const error = await service.getWorkflowHandle('w1').catch((e) => e);

        expect(error).toBeInstanceOf(TemporalClientError);
        expect(error.message).toBe('Failed to get workflow handle for w1: boom');
        expect(error.cause).toBe(boom);
    });

    it('rethrows WorkflowExecutionAlreadyStartedError as-is', async () => {
        const already = new WorkflowExecutionAlreadyStartedError('exists', 'w1', 'wf');
        client.workflow.start.mockRejectedValue(already);

        const error = await service
            .startWorkflow('wf', [], { taskQueue: 'q', workflowId: 'w1' })
            .catch((e) => e);

        expect(error).toBe(already);
        expect(error).toBeInstanceOf(WorkflowExecutionAlreadyStartedError);
    });
});
