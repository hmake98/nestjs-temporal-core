import { Context } from '@temporalio/activity';
import { Activity, ActivityMethod } from '../../../src';

/** Shared with the test so it can observe an activity from outside the worker. */
export const slowState = { started: 0, finished: 0 };

@Activity()
export class SlowActivities {
    @ActivityMethod('slowTask')
    async slowTask(ms: number): Promise<string> {
        slowState.started++;
        // Rejects if the worker cancels the activity (e.g. shutdown without a grace period).
        await Context.current().sleep(ms);
        slowState.finished++;
        return 'finished';
    }
}
