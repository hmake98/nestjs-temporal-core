import { defaultPayloadConverter } from '@temporalio/common';
import { getCorrelationId, runWithCorrelationId } from '../../src/observability/correlation';
import {
    createCorrelationActivityInterceptor,
    createCorrelationClientInterceptor,
} from '../../src/observability/interceptors';
import {
    resolveCorrelation,
    withCorrelationClientInterceptors,
    withCorrelationWorkerOptions,
} from '../../src/observability/apply';

const decode = (headers: any, name = 'x-correlation-id') =>
    defaultPayloadConverter.fromPayload(headers[name]);

describe('correlation context', () => {
    it('is undefined outside a run and scoped inside it', () => {
        expect(getCorrelationId()).toBeUndefined();
        runWithCorrelationId('abc', () => expect(getCorrelationId()).toBe('abc'));
        expect(getCorrelationId()).toBeUndefined();
    });

    it('does not leak ids between concurrent requests', async () => {
        const seen: string[] = [];
        await Promise.all(
            ['a', 'b', 'c', 'd'].map((id, i) =>
                runWithCorrelationId(id, async () => {
                    await new Promise((r) => setTimeout(r, (4 - i) * 5));
                    seen.push(`${id}:${getCorrelationId()}`);
                }),
            ),
        );
        expect(seen.sort()).toEqual(['a:a', 'b:b', 'c:c', 'd:d']);
    });
});

describe('client interceptor', () => {
    const next = jest.fn(async (input: any) => input);

    beforeEach(() => next.mockClear());

    it.each([
        'start',
        'startWithDetails',
        'signal',
        'signalWithStart',
        'startUpdate',
        'query',
    ] as const)('%s stamps the current id', async (method) => {
        const interceptor: any = createCorrelationClientInterceptor();

        const out = await runWithCorrelationId('req-1', () =>
            interceptor[method]({ headers: { other: 'kept' } }, next),
        );

        expect(decode(out.headers)).toBe('req-1');
        expect(out.headers.other).toBe('kept');
    });

    it('generates an id when none is active', async () => {
        const interceptor: any = createCorrelationClientInterceptor();

        const out = await interceptor.start({ headers: {} }, next);

        expect(decode(out.headers)).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('uses a custom generator', async () => {
        const interceptor: any = createCorrelationClientInterceptor({ generate: () => 'gen-1' });

        const out = await interceptor.signal({ headers: undefined }, next);

        expect(decode(out.headers)).toBe('gen-1');
    });

    it('stamps both header sets of startUpdateWithStart', async () => {
        const interceptor: any = createCorrelationClientInterceptor();

        const out = await runWithCorrelationId('u1', () =>
            interceptor.startUpdateWithStart({ workflowStartHeaders: {}, updateHeaders: {} }, next),
        );

        expect(decode(out.workflowStartHeaders)).toBe('u1');
        expect(decode(out.updateHeaders)).toBe('u1');
    });
});

describe('activity interceptor', () => {
    const run = (headers: any) => {
        const factory: any = createCorrelationActivityInterceptor();
        return factory({}).inbound.execute({ headers, args: [] }, async () => getCorrelationId());
    };

    it('runs the activity inside the id from its headers', async () => {
        const headers = { 'x-correlation-id': defaultPayloadConverter.toPayload('act-1') };

        await expect(run(headers)).resolves.toBe('act-1');
    });

    it('leaves the context empty when no header is present', async () => {
        await expect(run({})).resolves.toBeUndefined();
        await expect(run(undefined)).resolves.toBeUndefined();
    });
});

describe('apply helpers', () => {
    it('resolveCorrelation', () => {
        expect(resolveCorrelation(undefined)).toBeUndefined();
        expect(resolveCorrelation(false)).toBeUndefined();
        expect(resolveCorrelation(true)).toEqual({});
        const custom = { generate: () => 'x' };
        expect(resolveCorrelation(custom)).toBe(custom);
    });

    describe('withCorrelationClientInterceptors', () => {
        it('is a no-op when disabled', () => {
            const existing = { workflow: [] };
            expect(withCorrelationClientInterceptors(existing, false)).toBe(existing);
            expect(withCorrelationClientInterceptors(undefined, undefined)).toBeUndefined();
        });

        it('adds to nothing', () => {
            const result: any = withCorrelationClientInterceptors(undefined, true);
            expect(result.workflow).toHaveLength(1);
        });

        it('appends to the user array without mutating it', () => {
            const mine = { start: jest.fn() };
            const existing: any = { workflow: [mine], schedule: [] };

            const result: any = withCorrelationClientInterceptors(existing, true);

            expect(result.workflow).toHaveLength(2);
            expect(result.workflow[0]).toBe(mine);
            expect(result.schedule).toBe(existing.schedule);
            expect(existing.workflow).toHaveLength(1);
        });

        it('extends the deprecated { calls } form', () => {
            const mine = { start: jest.fn() };
            const existing: any = { workflow: { calls: () => [mine] } };

            const result: any = withCorrelationClientInterceptors(existing, true);
            const calls = result.workflow.calls({ workflowId: 'w' });

            expect(calls).toHaveLength(2);
            expect(calls[0]).toBe(mine);
        });

        it('handles a { calls }-less legacy object', () => {
            const result: any = withCorrelationClientInterceptors({ workflow: {} } as any, true);
            expect(result.workflow.calls({})).toHaveLength(1);
        });
    });

    describe('withCorrelationWorkerOptions', () => {
        it('is a no-op when disabled', () => {
            const options = { maxConcurrentActivityTaskExecutions: 3 };
            expect(withCorrelationWorkerOptions(options, undefined)).toBe(options);
        });

        it('adds the activity factory and the workflow module, keeping user entries', () => {
            const userFactory = jest.fn();
            const options: any = {
                maxConcurrentActivityTaskExecutions: 3,
                interceptors: { activity: [userFactory], workflowModules: ['/user/mod'] },
            };

            const result: any = withCorrelationWorkerOptions(options, true);

            expect(result.maxConcurrentActivityTaskExecutions).toBe(3);
            expect(result.interceptors.activity).toHaveLength(2);
            expect(result.interceptors.activity[0]).toBe(userFactory);
            expect(result.interceptors.workflowModules[0]).toBe('/user/mod');
            expect(result.interceptors.workflowModules[1]).toMatch(/workflow-interceptors/);
        });

        it('works with no existing worker options', () => {
            const result: any = withCorrelationWorkerOptions(undefined, true);
            expect(result.interceptors.activity).toHaveLength(1);
            expect(result.interceptors.workflowModules).toHaveLength(1);
        });
    });
});

describe('withDataConverter', () => {
    const { withDataConverter } = require('../../src/observability/apply');

    it('is a no-op without a module-level converter', () => {
        const options = { maxCachedWorkflows: 1 };
        expect(withDataConverter(options, undefined)).toBe(options);
    });

    it('defaults the worker converter', () => {
        const converter = { payloadCodecs: [] };
        expect(withDataConverter({ maxCachedWorkflows: 1 }, converter)).toEqual({
            maxCachedWorkflows: 1,
            dataConverter: converter,
        });
        expect(withDataConverter(undefined, converter)).toEqual({ dataConverter: converter });
    });

    it('keeps an explicit worker converter', () => {
        const mine = { payloadCodecs: [] };
        const options = { dataConverter: mine };
        expect(withDataConverter(options, { payloadCodecs: [] })).toBe(options);
    });
});
