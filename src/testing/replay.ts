import { Worker } from '@temporalio/worker';
import type { ReplayWorkerOptions } from '@temporalio/worker';
import * as fs from 'fs';

/** A workflow history to replay. `history` may be the JSON from `temporal workflow show --output json`. */
export interface ReplayHistory {
    workflowId: string;
    history: unknown;
}

export interface ReplayOutcome {
    workflowId: string;
    runId: string;
    /** Set when replay failed, usually a `DeterminismViolationError`. */
    error?: Error;
}

/** Thrown by {@link assertReplays}; `failures` lists each history that no longer replays. */
export class ReplayFailedError extends Error {
    constructor(public readonly failures: ReplayOutcome[]) {
        super(
            `${failures.length} workflow histor${failures.length === 1 ? 'y' : 'ies'} failed to replay:\n` +
                failures.map((f) => `  - ${f.workflowId}: ${f.error?.message}`).join('\n'),
        );
        this.name = 'ReplayFailedError';
    }
}

/** Read a history saved as JSON (for example from `temporal workflow show -o json`). */
export function readHistoryFile(file: string, workflowId?: string): ReplayHistory {
    const history = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return {
        workflowId: workflowId ?? file.replace(/^.*[\\/]/, '').replace(/\.json$/, ''),
        history,
    };
}

/**
 * Replay saved histories against the CURRENT workflow code and report which still replay. A
 * failed replay means the code change is not backward compatible with workflows already running
 * (non-determinism): use `patched()` or a new workflow type instead of editing in place.
 *
 * Needs no Temporal server. Pass `workflowsPath` or `workflowBundle` like worker options.
 */
export async function replayHistories(
    options: ReplayWorkerOptions,
    histories: ReplayHistory[],
): Promise<ReplayOutcome[]> {
    const outcomes: ReplayOutcome[] = [];
    // runReplayHistories returns results in order of completion, so key by workflowId.
    const byId = new Map(histories.map((h) => [h.workflowId, h]));
    if (byId.size !== histories.length) {
        throw new Error('replayHistories: workflowId values must be unique');
    }
    for await (const result of Worker.runReplayHistories(options, histories as never)) {
        outcomes.push({
            workflowId: result.workflowId,
            runId: result.runId,
            error: result.error,
        });
    }
    return outcomes;
}

/** Like {@link replayHistories}, but throws {@link ReplayFailedError} if any history fails. */
export async function assertReplays(
    options: ReplayWorkerOptions,
    histories: ReplayHistory[],
): Promise<void> {
    const failures = (await replayHistories(options, histories)).filter((o) => o.error);
    if (failures.length > 0) throw new ReplayFailedError(failures);
}
