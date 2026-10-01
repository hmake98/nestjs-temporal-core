import { Injectable } from '@nestjs/common';
import {
    ScheduleCreationOptions,
    ScheduleDeletionResult,
    ScheduleUpdateResult,
    ScheduleUpsertResult,
    WorkflowCancellationResult,
    WorkflowExecutionResult,
    WorkflowQueryResult,
    WorkflowSignalResult,
    WorkflowStartOptions,
    WorkflowTerminationResult,
} from '../interfaces';
import { TemporalClientService } from '../services/temporal-client.service';
import { TemporalService } from '../services/temporal.service';
import { TemporalTestingRecorder } from './temporal-testing-recorder';

let counter = 0;
const nextId = (workflowType: string): string => `fake-${workflowType}-${++counter}`;

/** A workflow handle whose operations all succeed and return `undefined`. */
function fakeHandle(workflowId: string): Record<string, unknown> {
    const noop = async (): Promise<undefined> => undefined;
    return {
        workflowId,
        firstExecutionRunId: 'fake-run-id',
        result: noop,
        signal: noop,
        query: noop,
        cancel: noop,
        terminate: noop,
        describe: async () => ({ workflowId }),
    };
}

type FakedFacade = Pick<
    TemporalService,
    | 'startWorkflow'
    | 'signalWorkflow'
    | 'signalWithStart'
    | 'queryWorkflow'
    | 'getWorkflowHandle'
    | 'terminateWorkflow'
    | 'cancelWorkflow'
    | 'upsertSchedule'
    | 'updateSchedule'
    | 'deleteSchedule'
    | 'startWorker'
    | 'stopWorker'
    | 'isWorkerRunning'
    | 'hasWorker'
>;

/**
 * Drop-in replacement for {@link TemporalService} in unit tests. No server, no
 * worker: every call is recorded on the {@link TemporalTestingRecorder} and returns
 * a successful default unless the test configured something else.
 */
@Injectable()
export class FakeTemporalService implements FakedFacade {
    constructor(private readonly recorder: TemporalTestingRecorder) {}

    async startWorkflow<T = unknown>(
        workflowType: string,
        args?: unknown[],
        options?: WorkflowStartOptions,
    ): Promise<WorkflowExecutionResult<T>> {
        return (await this.recorder.run('startWorkflow', [workflowType, args, options], () => {
            const workflowId = options?.workflowId ?? nextId(workflowType);
            return {
                success: true,
                result: fakeHandle(workflowId),
                workflowId,
                runId: 'fake-run-id',
                executionTime: 0,
            };
        })) as WorkflowExecutionResult<T>;
    }

    async signalWorkflow(
        workflowId: string,
        signalName: string,
        args?: unknown[],
    ): Promise<WorkflowSignalResult> {
        return (await this.recorder.run('signalWorkflow', [workflowId, signalName, args], () => ({
            success: true,
            workflowId,
            signalName,
        }))) as WorkflowSignalResult;
    }

    async signalWithStart(
        workflowType: string,
        signalName: string,
        signalArgs: unknown[],
        workflowArgs: unknown[],
        options?: WorkflowStartOptions,
    ): Promise<WorkflowSignalResult> {
        return (await this.recorder.run(
            'signalWithStart',
            [workflowType, signalName, signalArgs, workflowArgs, options],
            () => ({
                success: true,
                workflowId: options?.workflowId ?? nextId(workflowType),
                signalName,
            }),
        )) as WorkflowSignalResult;
    }

    async queryWorkflow<T = unknown>(
        workflowId: string,
        queryName: string,
        args?: unknown[],
    ): Promise<WorkflowQueryResult<T>> {
        return (await this.recorder.run('queryWorkflow', [workflowId, queryName, args], () => ({
            success: true,
            result: undefined,
            workflowId,
            queryName,
        }))) as WorkflowQueryResult<T>;
    }

    async getWorkflowHandle<T = unknown>(workflowId: string, runId?: string): Promise<T> {
        return (await this.recorder.run('getWorkflowHandle', [workflowId, runId], () =>
            fakeHandle(workflowId),
        )) as T;
    }

    async terminateWorkflow(
        workflowId: string,
        reason?: string,
    ): Promise<WorkflowTerminationResult> {
        return (await this.recorder.run('terminateWorkflow', [workflowId, reason], () => ({
            success: true,
            workflowId,
            reason,
        }))) as WorkflowTerminationResult;
    }

    async cancelWorkflow(workflowId: string): Promise<WorkflowCancellationResult> {
        return (await this.recorder.run('cancelWorkflow', [workflowId], () => ({
            success: true,
            workflowId,
        }))) as WorkflowCancellationResult;
    }

    async upsertSchedule(options: ScheduleCreationOptions): Promise<ScheduleUpsertResult> {
        return (await this.recorder.run('upsertSchedule', [options], () => ({
            success: true,
            scheduleId: options.scheduleId,
            action: 'created',
        }))) as ScheduleUpsertResult;
    }

    async updateSchedule(scheduleId: string, updateFn: unknown): Promise<ScheduleUpdateResult> {
        return (await this.recorder.run('updateSchedule', [scheduleId, updateFn], () => ({
            success: true,
            scheduleId,
        }))) as ScheduleUpdateResult;
    }

    async deleteSchedule(scheduleId: string): Promise<ScheduleDeletionResult> {
        return (await this.recorder.run('deleteSchedule', [scheduleId], () => ({
            success: true,
            scheduleId,
        }))) as ScheduleDeletionResult;
    }

    async startWorker(): Promise<void> {
        await this.recorder.run('startWorker', [], () => undefined);
    }

    async stopWorker(): Promise<void> {
        await this.recorder.run('stopWorker', [], () => undefined);
    }

    isWorkerRunning(): boolean {
        return this.recorder.run('isWorkerRunning', [], () => true) as boolean;
    }

    hasWorker(): boolean {
        return this.recorder.run('hasWorker', [], () => true) as boolean;
    }
}

type FakedClient = Pick<
    TemporalClientService,
    | 'startWorkflow'
    | 'signalWorkflow'
    | 'signalWithStart'
    | 'queryWorkflow'
    | 'updateWorkflow'
    | 'getWorkflowHandle'
    | 'terminateWorkflow'
    | 'cancelWorkflow'
    | 'isHealthy'
>;

/**
 * Drop-in replacement for {@link TemporalClientService}. Same recording and
 * configuration model as {@link FakeTemporalService}; methods use the client
 * service's own (unwrapped) return shapes.
 */
@Injectable()
export class FakeTemporalClientService implements FakedClient {
    constructor(private readonly recorder: TemporalTestingRecorder) {}

    async startWorkflow(
        workflowType: string,
        args: unknown[],
        options?: WorkflowStartOptions,
    ): Promise<any> {
        return this.recorder.run('client.startWorkflow', [workflowType, args, options], () => {
            const workflowId = options?.workflowId ?? nextId(workflowType);
            const handle = fakeHandle(workflowId);
            return { ...handle, handle };
        });
    }

    async signalWorkflow(
        workflowId: string,
        signalName: string,
        args?: readonly unknown[],
        runId?: string,
    ): Promise<void> {
        await this.recorder.run(
            'client.signalWorkflow',
            [workflowId, signalName, args, runId],
            () => undefined,
        );
    }

    async signalWithStart(
        workflowType: string,
        signalName: string,
        signalArgs: unknown[],
        workflowArgs: unknown[],
        options?: WorkflowStartOptions,
    ): Promise<any> {
        return this.recorder.run(
            'client.signalWithStart',
            [workflowType, signalName, signalArgs, workflowArgs, options],
            () => fakeHandle(options?.workflowId ?? nextId(workflowType)),
        );
    }

    async queryWorkflow<T = unknown>(
        workflowId: string,
        queryName: string,
        args?: readonly unknown[],
        runId?: string,
    ): Promise<T> {
        return (await this.recorder.run(
            'client.queryWorkflow',
            [workflowId, queryName, args, runId],
            () => undefined,
        )) as T;
    }

    async updateWorkflow<T = unknown>(
        workflowId: string,
        updateName: string,
        args?: readonly unknown[],
        runId?: string,
    ): Promise<T> {
        return (await this.recorder.run(
            'client.updateWorkflow',
            [workflowId, updateName, args, runId],
            () => undefined,
        )) as T;
    }

    async getWorkflowHandle(workflowId: string, runId?: string): Promise<any> {
        return this.recorder.run('client.getWorkflowHandle', [workflowId, runId], () =>
            fakeHandle(workflowId),
        );
    }

    async terminateWorkflow(workflowId: string, reason?: string, runId?: string): Promise<void> {
        await this.recorder.run(
            'client.terminateWorkflow',
            [workflowId, reason, runId],
            () => undefined,
        );
    }

    async cancelWorkflow(workflowId: string, runId?: string): Promise<void> {
        await this.recorder.run('client.cancelWorkflow', [workflowId, runId], () => undefined);
    }

    isHealthy(): boolean {
        return this.recorder.run('client.isHealthy', [], () => true) as boolean;
    }
}
