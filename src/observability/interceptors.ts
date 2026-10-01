import { randomUUID } from 'crypto';
import { defaultPayloadConverter, type Payload } from '@temporalio/common';
import type { WorkflowClientInterceptor } from '@temporalio/client';
import type {
    ActivityExecuteInput,
    ActivityInboundCallsInterceptor,
    ActivityInterceptorsFactory,
    Next,
} from '@temporalio/worker';
import { DEFAULT_CORRELATION_HEADER, getCorrelationId, runWithCorrelationId } from './correlation';
import { CorrelationOptions } from './types';

type Headers = Record<string, Payload>;

function withHeader(headers: Headers | undefined, header: string, id: string): Headers {
    return { ...headers, [header]: defaultPayloadConverter.toPayload(id) as Payload };
}

/**
 * Client interceptor: stamps every outgoing workflow call with the current correlation id,
 * generating one when the caller has none.
 */
export function createCorrelationClientInterceptor(
    options: CorrelationOptions = {},
): WorkflowClientInterceptor {
    const header = DEFAULT_CORRELATION_HEADER;
    const generate = options.generate ?? randomUUID;
    const stamp = <I extends { headers: Headers }>(input: I): I => ({
        ...input,
        headers: withHeader(input.headers, header, getCorrelationId() ?? generate()),
    });

    return {
        start: (input, next) => next(stamp(input)),
        startWithDetails: (input, next) => next(stamp(input)),
        signal: (input, next) => next(stamp(input)),
        signalWithStart: (input, next) => next(stamp(input)),
        startUpdate: (input, next) => next(stamp(input)),
        startUpdateWithStart: (input, next) => {
            const id = getCorrelationId() ?? generate();
            return next({
                ...input,
                workflowStartHeaders: withHeader(input.workflowStartHeaders, header, id),
                updateHeaders: withHeader(input.updateHeaders, header, id),
            });
        },
        query: (input, next) => next(stamp(input)),
    };
}

/**
 * Activity interceptor factory: reads the correlation id from the activity's headers and
 * runs the activity inside it, so `getCorrelationId()` and the library logger see it.
 */
export function createCorrelationActivityInterceptor(): ActivityInterceptorsFactory {
    const header = DEFAULT_CORRELATION_HEADER;
    return () => ({
        inbound: {
            execute(
                input: ActivityExecuteInput,
                next: Next<ActivityInboundCallsInterceptor, 'execute'>,
            ) {
                const payload = input.headers?.[header];
                const id = payload
                    ? defaultPayloadConverter.fromPayload<string>(payload)
                    : undefined;
                return id ? runWithCorrelationId(id, () => next(input)) : next(input);
            },
        },
    });
}
