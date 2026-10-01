import type { ClientInterceptors } from '@temporalio/client';
import type { DataConverter } from '@temporalio/common';
import type { WorkerOptions } from '@temporalio/worker';
import {
    createCorrelationActivityInterceptor,
    createCorrelationClientInterceptor,
} from './interceptors';
import { CorrelationOptions } from './types';

/** Normalize the `correlation` module option: `true` means defaults, falsy means off. */
export function resolveCorrelation(
    option: boolean | CorrelationOptions | undefined,
): CorrelationOptions | undefined {
    if (!option) return undefined;
    return option === true ? {} : option;
}

/** Add the correlation client interceptor to user-supplied client interceptors. */
export function withCorrelationClientInterceptors(
    interceptors: ClientInterceptors | undefined,
    option: boolean | CorrelationOptions | undefined,
): ClientInterceptors | undefined {
    const correlation = resolveCorrelation(option);
    if (!correlation) return interceptors;

    const ours = createCorrelationClientInterceptor(correlation);
    const existing = interceptors?.workflow;

    if (existing === undefined || Array.isArray(existing)) {
        return { ...interceptors, workflow: [...(existing ?? []), ours] };
    }
    // Deprecated `{ calls }` form: keep the user's factory and append ours.
    const legacy = existing as {
        calls?: (ctx: { workflowId?: string; runId?: string }) => unknown[];
    };
    return {
        ...interceptors,
        workflow: {
            ...legacy,
            calls: (ctx: { workflowId?: string; runId?: string }) => [
                ...(legacy.calls?.(ctx) ?? []),
                ours,
            ],
        } as unknown as ClientInterceptors['workflow'],
    };
}

/**
 * Add the correlation activity interceptor and workflow-side forwarding module to worker
 * options. The workflow module is skipped by the SDK when a prebuilt `workflowBundle` is
 * used; in that case add it to the bundle yourself.
 */
export function withCorrelationWorkerOptions(
    workerOptions: Partial<WorkerOptions> | undefined,
    option: boolean | CorrelationOptions | undefined,
): Partial<WorkerOptions> | undefined {
    if (!resolveCorrelation(option)) return workerOptions;

    const existing = workerOptions?.interceptors;
    return {
        ...workerOptions,
        interceptors: {
            ...existing,
            activity: [...(existing?.activity ?? []), createCorrelationActivityInterceptor()],
            workflowModules: [
                ...(existing?.workflowModules ?? []),
                require.resolve('./workflow-interceptors'),
            ],
        },
    };
}

/** Default the worker's `dataConverter` to the module-level one; an explicit one wins. */
export function withDataConverter(
    workerOptions: Partial<WorkerOptions> | undefined,
    dataConverter: DataConverter | undefined,
): Partial<WorkerOptions> | undefined {
    if (!dataConverter || workerOptions?.dataConverter) return workerOptions;
    return { ...workerOptions, dataConverter };
}
