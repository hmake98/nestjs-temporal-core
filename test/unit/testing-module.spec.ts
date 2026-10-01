import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TemporalClientService } from '../../src/services/temporal-client.service';
import { TemporalService } from '../../src/services/temporal.service';
import {
    FakeTemporalClientService,
    FakeTemporalService,
    TemporalTestingModule,
    TemporalTestingRecorder,
} from '../../src/testing';

@Injectable()
class OrderService {
    constructor(private readonly temporal: TemporalService) {}

    place(id: string) {
        return this.temporal.startWorkflow('processOrder', [id], { workflowId: `order-${id}` });
    }
}

describe('TemporalTestingModule', () => {
    let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
    let temporal: TemporalService;
    let client: TemporalClientService;
    let recorder: TemporalTestingRecorder;

    beforeEach(async () => {
        moduleRef = await Test.createTestingModule({
            imports: [TemporalTestingModule.register()],
            providers: [OrderService],
        }).compile();
        temporal = moduleRef.get(TemporalService);
        client = moduleRef.get(TemporalClientService);
        recorder = moduleRef.get(TemporalTestingRecorder);
    });

    it('injects fakes in place of the real services', () => {
        expect(temporal).toBeInstanceOf(FakeTemporalService);
        expect(client).toBeInstanceOf(FakeTemporalClientService);
    });

    it('lets a service that starts a workflow be tested with no server', async () => {
        await moduleRef.get(OrderService).place('42');

        expect(recorder.callsTo('startWorkflow')).toEqual([
            {
                method: 'startWorkflow',
                args: ['processOrder', ['42'], { workflowId: 'order-42' }],
            },
        ]);
    });

    describe('facade defaults', () => {
        const table: Array<[string, () => Promise<unknown> | unknown, unknown]> = [
            [
                'startWorkflow',
                () => temporal.startWorkflow('wf', [], { workflowId: 'w1' }),
                expect.objectContaining({ success: true, workflowId: 'w1' }),
            ],
            [
                'signalWorkflow',
                () => temporal.signalWorkflow('w1', 'sig'),
                { success: true, workflowId: 'w1', signalName: 'sig' },
            ],
            [
                'signalWithStart',
                () => temporal.signalWithStart('wf', 'sig', [], [], { workflowId: 'w1' }),
                { success: true, workflowId: 'w1', signalName: 'sig' },
            ],
            [
                'queryWorkflow',
                () => temporal.queryWorkflow('w1', 'q'),
                { success: true, result: undefined, workflowId: 'w1', queryName: 'q' },
            ],
            [
                'getWorkflowHandle',
                () => temporal.getWorkflowHandle('w1'),
                expect.objectContaining({ workflowId: 'w1' }),
            ],
            [
                'terminateWorkflow',
                () => temporal.terminateWorkflow('w1', 'why'),
                { success: true, workflowId: 'w1', reason: 'why' },
            ],
            [
                'cancelWorkflow',
                () => temporal.cancelWorkflow('w1'),
                { success: true, workflowId: 'w1' },
            ],
            [
                'upsertSchedule',
                () => temporal.upsertSchedule({ scheduleId: 's1' } as never),
                { success: true, scheduleId: 's1', action: 'created' },
            ],
            [
                'updateSchedule',
                () => temporal.updateSchedule('s1', (p) => p as never),
                { success: true, scheduleId: 's1' },
            ],
            [
                'deleteSchedule',
                () => temporal.deleteSchedule('s1'),
                { success: true, scheduleId: 's1' },
            ],
            ['startWorker', () => temporal.startWorker(), undefined],
            ['stopWorker', () => temporal.stopWorker(), undefined],
            ['isWorkerRunning', () => temporal.isWorkerRunning(), true],
            ['hasWorker', () => temporal.hasWorker(), true],
        ];

        it.each(table)('%s returns a default and is recorded', async (method, call, expected) => {
            await expect(Promise.resolve(call())).resolves.toEqual(expected);
            expect(recorder.callsTo(method)).toHaveLength(1);
        });

        it('generates unique workflow ids when none is given', async () => {
            const a = await temporal.startWorkflow('wf');
            const b = await temporal.startWorkflow('wf');
            expect(a.workflowId).toBeDefined();
            expect(a.workflowId).not.toBe(b.workflowId);
            const c = await temporal.signalWithStart('wf', 'sig', [], []);
            expect(c.workflowId).toMatch(/^fake-wf-/);
        });

        it('returns handles whose operations all resolve', async () => {
            const started = await temporal.startWorkflow<any>('wf');
            const handle = started.result;
            await expect(handle.result()).resolves.toBeUndefined();
            await expect(handle.describe()).resolves.toEqual({ workflowId: started.workflowId });
        });
    });

    describe('client defaults', () => {
        it('records and defaults each client method', async () => {
            const started: any = await client.startWorkflow('wf', [], { workflowId: 'w1' });
            expect(started.workflowId).toBe('w1');
            expect(started.handle.workflowId).toBe('w1');
            await client.signalWorkflow('w1', 'sig', [1], 'run');
            await expect(client.queryWorkflow('w1', 'q')).resolves.toBeUndefined();
            await expect(client.updateWorkflow('w1', 'u')).resolves.toBeUndefined();
            await expect(client.getWorkflowHandle('w1')).resolves.toMatchObject({
                workflowId: 'w1',
            });
            await client.terminateWorkflow('w1', 'r');
            await client.cancelWorkflow('w1');
            const sws: any = await client.signalWithStart('wf', 'sig', [], [], {
                workflowId: 'w2',
            });
            expect(sws.workflowId).toBe('w2');
            expect(client.isHealthy()).toBe(true);

            expect(recorder.calls.map((c) => c.method)).toEqual([
                'client.startWorkflow',
                'client.signalWorkflow',
                'client.queryWorkflow',
                'client.updateWorkflow',
                'client.getWorkflowHandle',
                'client.terminateWorkflow',
                'client.cancelWorkflow',
                'client.signalWithStart',
                'client.isHealthy',
            ]);
        });

        it('generates ids for client starts without one', async () => {
            const started: any = await client.startWorkflow('wf', []);
            expect(started.workflowId).toMatch(/^fake-wf-/);
            const sws: any = await client.signalWithStart('wf', 'sig', [], []);
            expect(sws.workflowId).toMatch(/^fake-wf-/);
        });
    });

    describe('configuration', () => {
        it('respondWith returns a fixed value', async () => {
            recorder.respondWith('queryWorkflow', { success: true, result: 7 });
            await expect(temporal.queryWorkflow('w1', 'q')).resolves.toEqual({
                success: true,
                result: 7,
            });
        });

        it('respondWith computes from arguments when given a function', async () => {
            recorder.respondWith('signalWorkflow', (id: string, name: string) => ({
                success: true,
                workflowId: id.toUpperCase(),
                signalName: name,
            }));
            await expect(temporal.signalWorkflow('abc', 'go')).resolves.toMatchObject({
                workflowId: 'ABC',
            });
        });

        it('failWith rejects with the given error, for facade and client', async () => {
            const boom = new Error('down');
            recorder.failWith('startWorkflow', boom).failWith('client.cancelWorkflow', boom);

            await expect(temporal.startWorkflow('wf')).rejects.toBe(boom);
            await expect(client.cancelWorkflow('w1')).rejects.toBe(boom);
            expect(recorder.callsTo('startWorkflow')).toHaveLength(1);
        });

        it('failWith throws synchronously from sync methods', () => {
            recorder.failWith('isWorkerRunning', new Error('x'));
            expect(() => temporal.isWorkerRunning()).toThrow('x');
        });

        it('a later respondWith replaces an earlier failWith, and vice versa', async () => {
            recorder.failWith('cancelWorkflow', new Error('x'));
            recorder.respondWith('cancelWorkflow', { success: true, workflowId: 'z' });
            await expect(temporal.cancelWorkflow('w1')).resolves.toEqual({
                success: true,
                workflowId: 'z',
            });

            recorder.failWith('cancelWorkflow', new Error('y'));
            await expect(temporal.cancelWorkflow('w1')).rejects.toThrow('y');
        });

        it('reset clears calls, responses and failures', async () => {
            recorder.failWith('startWorkflow', new Error('x'));
            await temporal.startWorkflow('wf').catch(() => undefined);
            recorder.reset();

            expect(recorder.calls).toHaveLength(0);
            await expect(temporal.startWorkflow('wf')).resolves.toMatchObject({ success: true });
        });
    });

    it('is global: a module that does not import it still gets the fakes', async () => {
        @Injectable()
        class Consumer {
            constructor(readonly temporal: TemporalService) {}
        }
        const ref = await Test.createTestingModule({
            imports: [TemporalTestingModule.register()],
            providers: [Consumer],
        }).compile();
        expect(ref.get(Consumer).temporal).toBeInstanceOf(FakeTemporalService);
    });
});
