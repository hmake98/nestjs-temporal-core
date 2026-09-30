import { Activity, ActivityMethod } from '../../../src';

@Activity()
export class GreetingActivities {
    @ActivityMethod('greet')
    async greet(name: string): Promise<string> {
        return `Hello, ${name}!`;
    }
}
