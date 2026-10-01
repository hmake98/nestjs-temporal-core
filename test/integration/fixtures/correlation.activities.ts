import { Activity, ActivityMethod, getCorrelationId } from '../../../src';

@Activity()
export class CorrelationActivities {
    @ActivityMethod('currentId')
    async currentId(): Promise<string | undefined> {
        return getCorrelationId();
    }
}
