import { BadRequestException } from '@nestjs/common';
import { Activity, ActivityMethod, NonRetryable } from '../../../src';

class CardDeclined extends Error {}

/** Counts how many times each activity actually ran, so tests can assert on retries. */
export const attempts: Record<string, number> = {};
const hit = (name: string) => (attempts[name] = (attempts[name] ?? 0) + 1);

@Activity()
export class FailingActivities {
    @ActivityMethod('httpFail')
    async httpFail(): Promise<void> {
        hit('httpFail');
        throw new BadRequestException('bad input');
    }

    @ActivityMethod('decoratedFail')
    @NonRetryable([CardDeclined])
    async decoratedFail(): Promise<void> {
        hit('decoratedFail');
        throw new CardDeclined('declined');
    }

    @ActivityMethod('plainFail')
    async plainFail(): Promise<void> {
        hit('plainFail');
        throw new Error('transient');
    }
}
