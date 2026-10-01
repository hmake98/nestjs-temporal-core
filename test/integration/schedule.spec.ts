import { TemporalService } from '../../src';
import { GreetingActivities } from './fixtures/greeting.activities';
import { createTestEnv, IntegrationEnv } from './helpers/test-env';

describe('integration: schedule lifecycle through the TemporalService facade', () => {
    let ctx: IntegrationEnv;
    let temporal: TemporalService;

    beforeAll(async () => {
        ctx = await createTestEnv({ activityClasses: [GreetingActivities] });
        temporal = ctx.app.get(TemporalService);
    });

    afterAll(async () => {
        await ctx.teardown();
    });

    const definition = (note: string) => ({
        scheduleId: 'it-schedule',
        spec: { cronExpressions: ['0 9 * * *'] },
        description: note,
        action: {
            type: 'startWorkflow' as const,
            workflowType: 'greetingWorkflow',
            taskQueue: 'unused',
            args: ['scheduled'],
        },
        paused: true,
    });

    it('creates, repeats without error, updates, describes and deletes', async () => {
        const created = await temporal.upsertSchedule(definition('v1'));
        expect(created).toMatchObject({ success: true, action: 'created' });

        const repeated = await temporal.upsertSchedule(definition('v2'));
        expect(repeated).toMatchObject({ success: true, action: 'updated' });

        const described = await temporal.schedule.describeSchedule('it-schedule');
        expect(described.success).toBe(true);
        expect(described.description?.state.note).toBe('v2');

        const updated = await temporal.updateSchedule('it-schedule', (previous) => ({
            ...previous,
            state: { ...previous.state, note: 'v3' },
        }));
        expect(updated).toMatchObject({ success: true });
        const after = await temporal.schedule.describeSchedule('it-schedule');
        expect(after.description?.state.note).toBe('v3');

        await expect(temporal.deleteSchedule('it-schedule')).resolves.toMatchObject({
            success: true,
        });
        const gone = await temporal.schedule.describeSchedule('it-schedule');
        expect(gone.success).toBe(false);
    });

    it('reports a missing schedule id as a failed result with the original error', async () => {
        const deleted = await temporal.deleteSchedule('never-created');
        expect(deleted.success).toBe(false);
        expect(deleted.error).toBeInstanceOf(Error);

        const updated = await temporal.updateSchedule('never-created', (p) => p as never);
        expect(updated.success).toBe(false);
    });
});
