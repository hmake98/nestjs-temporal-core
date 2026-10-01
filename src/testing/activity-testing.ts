import { Provider, Type } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { TemporalClientError } from '../errors';

/**
 * Replace an activity class in a Nest testing module with a mock, e.g. to unit-test
 * a service that depends on an activity without running its real implementation.
 */
export function overrideActivity<T extends TestingModuleBuilder, A>(
    builder: T,
    activityClass: Type<A>,
    mock: Partial<A>,
): T {
    builder.overrideProvider(activityClass).useValue(mock);
    return builder;
}

export interface ActivityHarnessOptions {
    /** Extra providers the activity depends on (real, or `{ provide, useValue }` mocks). */
    providers?: Provider[];
    /** Override fields of the mocked activity `Info` (workflow id, attempt, ...). */
    info?: Record<string, unknown>;
}

export interface ActivityHarness<T> {
    /** The activity instance, constructed through Nest DI. */
    instance: T;
    /** Run an activity method inside a mocked Activity context. */
    run<K extends keyof T>(
        method: K,
        ...args: T[K] extends (...a: infer P) => unknown ? P : never
    ): Promise<T[K] extends (...a: never[]) => infer R ? Awaited<R> : never>;
    /** Details of every `Context.current().heartbeat(...)` call, in order. */
    heartbeats: unknown[];
    /** Cancel the activity context; `Context.current().cancellationSignal` aborts. */
    cancel(reason?: string): void;
    close(): Promise<void>;
}

/**
 * Unit-test an activity with Nest DI plus heartbeat/cancellation context, without a
 * Temporal server. Requires the optional peer `@temporalio/testing`.
 *
 * @example
 * ```typescript
 * const harness = await createActivityHarness(PaymentActivity, {
 *   providers: [{ provide: PaymentGateway, useValue: { charge: async () => 'ok' } }],
 * });
 * await expect(harness.run('charge', 100)).resolves.toBe('ok');
 * await harness.close();
 * ```
 */
export async function createActivityHarness<T extends object>(
    activityClass: Type<T>,
    options: ActivityHarnessOptions = {},
): Promise<ActivityHarness<T>> {
    // Loaded lazily so `TemporalTestingModule` works without @temporalio/testing installed.
    let MockActivityEnvironment: typeof import('@temporalio/testing').MockActivityEnvironment;
    try {
        ({ MockActivityEnvironment } = await import('@temporalio/testing'));
    } catch (cause) {
        throw new TemporalClientError(
            "createActivityHarness requires the optional peer dependency '@temporalio/testing'. " +
                'Install it with: npm install --save-dev @temporalio/testing',
            cause,
        );
    }

    const moduleRef = await Test.createTestingModule({
        providers: [activityClass, ...(options.providers ?? [])],
    }).compile();
    const instance = moduleRef.get(activityClass);
    const env = new MockActivityEnvironment(options.info as never);
    const heartbeats: unknown[] = [];
    env.on('heartbeat', (details: unknown) => heartbeats.push(details));

    return {
        instance,
        heartbeats,
        async run(method, ...args) {
            const fn = (instance[method] as unknown as (...a: unknown[]) => unknown).bind(instance);
            return env.run(fn as never, ...(args as unknown as never[])) as never;
        },
        cancel(reason) {
            env.cancel(reason as never);
        },
        close: () => moduleRef.close(),
    };
}
