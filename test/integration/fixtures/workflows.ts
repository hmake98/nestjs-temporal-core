// Workflow code runs inside the Temporal v8 sandbox: only @temporalio/workflow imports.
import {
    condition,
    sleep,
    defineQuery,
    defineSignal,
    defineUpdate,
    proxyActivities,
    setHandler,
} from '@temporalio/workflow';

interface GreetingActivities {
    greet(name: string): Promise<string>;
}

interface SlowActivities {
    slowTask(ms: number): Promise<string>;
}

const { greet } = proxyActivities<GreetingActivities>({
    startToCloseTimeout: '10 seconds',
});

interface CorrelationActivities {
    currentId(): Promise<string | undefined>;
}

const { currentId } = proxyActivities<CorrelationActivities>({
    startToCloseTimeout: '10 seconds',
});

const { slowTask } = proxyActivities<SlowActivities>({
    startToCloseTimeout: '30 seconds',
});

export async function greetingWorkflow(name: string): Promise<string> {
    return greet(name);
}

export const addSignal = defineSignal<[number]>('add');
export const finishSignal = defineSignal('finish');
export const totalQuery = defineQuery<number>('total');
export const setTotalUpdate = defineUpdate<number, [number]>('setTotal');

/** Accumulates numbers from signals until told to finish; supports query and update. */
export async function counterWorkflow(): Promise<number> {
    let total = 0;
    let finished = false;
    setHandler(addSignal, (n) => {
        total += n;
    });
    setHandler(finishSignal, () => {
        finished = true;
    });
    setHandler(totalQuery, () => total);
    setHandler(setTotalUpdate, (n) => {
        const previous = total;
        total = n;
        return previous;
    });
    await condition(() => finished);
    return total;
}

export async function slowWorkflow(ms: number): Promise<string> {
    return slowTask(ms);
}

/** Returns whatever correlation id the activity sees. */
export async function correlationWorkflow(): Promise<string | undefined> {
    return currentId();
}

interface FailingActivities {
    httpFail(): Promise<void>;
    decoratedFail(): Promise<void>;
    plainFail(): Promise<void>;
}

const failing = proxyActivities<FailingActivities>({
    startToCloseTimeout: '10 seconds',
    retry: { maximumAttempts: 3, initialInterval: '10 milliseconds', backoffCoefficient: 1 },
});

/** Runs one of the failing activities; the retry policy allows 3 attempts. */
export async function failingWorkflow(which: keyof FailingActivities): Promise<void> {
    await failing[which]();
}

/** Waits a day on a timer: only finishes quickly under a time-skipping server. */
export async function sleeperWorkflow(): Promise<string> {
    await sleep('1 day');
    return 'slept';
}
