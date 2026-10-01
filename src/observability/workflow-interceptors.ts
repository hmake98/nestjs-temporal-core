// Runs inside the Temporal workflow sandbox: no Node APIs, no Nest, only
// `@temporalio/workflow` / `@temporalio/common`. The workflow itself cannot read the id
// (no AsyncLocalStorage in the sandbox); this module only forwards the incoming header to
// everything the workflow starts, so the id survives workflow -> activity / child hops.
import type { Payload } from '@temporalio/common';
import type {
    WorkflowInboundCallsInterceptor,
    WorkflowInterceptors,
    WorkflowOutboundCallsInterceptor,
} from '@temporalio/workflow';

const HEADER = 'x-correlation-id';

let current: Payload | undefined;

const remember = (headers: Record<string, Payload> | undefined): void => {
    current = headers?.[HEADER] ?? current;
};

const forward = <I extends { headers: Record<string, Payload> }>(input: I): I =>
    current ? { ...input, headers: { ...input.headers, [HEADER]: current } } : input;

const inbound: WorkflowInboundCallsInterceptor = {
    execute: (input, next) => {
        remember(input.headers);
        return next(input);
    },
    handleSignal: (input, next) => {
        remember(input.headers);
        return next(input);
    },
    handleUpdate: (input, next) => {
        remember(input.headers);
        return next(input);
    },
    handleQuery: (input, next) => {
        remember(input.headers);
        return next(input);
    },
};

const outbound: WorkflowOutboundCallsInterceptor = {
    scheduleActivity: (input, next) => next(forward(input)),
    scheduleLocalActivity: (input, next) => next(forward(input)),
    startChildWorkflowExecution: (input, next) => next(forward(input)),
    signalWorkflow: (input, next) => next(forward(input)),
    continueAsNew: (input, next) => next(forward(input)),
};

export const interceptors = (): WorkflowInterceptors => ({
    inbound: [inbound],
    outbound: [outbound],
});
