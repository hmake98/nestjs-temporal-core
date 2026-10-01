import { defaultPayloadConverter } from '@temporalio/common';

const payload = defaultPayloadConverter.toPayload('wf-1');

describe('workflow-side correlation forwarding', () => {
    let inbound: any;
    let outbound: any;

    beforeEach(() => {
        jest.resetModules();
        const { interceptors } = require('../../src/observability/workflow-interceptors');
        const result = interceptors();
        inbound = result.inbound[0];
        outbound = result.outbound[0];
    });

    const echo = async (input: any) => input;

    it('does not touch outbound calls before an id was seen', async () => {
        const input = { headers: { a: payload } };
        expect(await outbound.scheduleActivity(input, echo)).toBe(input);
    });

    it.each(['execute', 'handleSignal', 'handleUpdate', 'handleQuery'])(
        'remembers the id from %s',
        async (method) => {
            await inbound[method]({ headers: { 'x-correlation-id': payload } }, echo);

            const out = await outbound.scheduleActivity({ headers: {} }, echo);

            expect(out.headers['x-correlation-id']).toBe(payload);
        },
    );

    it.each([
        'scheduleActivity',
        'scheduleLocalActivity',
        'startChildWorkflowExecution',
        'signalWorkflow',
        'continueAsNew',
    ])('%s forwards the id and keeps other headers', async (method) => {
        await inbound.execute({ headers: { 'x-correlation-id': payload } }, echo);

        const out = await outbound[method]({ headers: { keep: payload } }, echo);

        expect(out.headers['x-correlation-id']).toBe(payload);
        expect(out.headers.keep).toBe(payload);
    });

    it('keeps the previous id when a later call has no header', async () => {
        await inbound.execute({ headers: { 'x-correlation-id': payload } }, echo);
        await inbound.handleSignal({ headers: undefined }, echo);

        const out = await outbound.scheduleActivity({ headers: {} }, echo);

        expect(out.headers['x-correlation-id']).toBe(payload);
    });
});
