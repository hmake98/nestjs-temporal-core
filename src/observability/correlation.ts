import { AsyncLocalStorage } from 'async_hooks';

export const DEFAULT_CORRELATION_HEADER = 'x-correlation-id';

const storage = new AsyncLocalStorage<string>();

/** Run `fn` with `id` as the current correlation id (visible to everything it awaits). */
export function runWithCorrelationId<T>(id: string, fn: () => T): T {
    return storage.run(id, fn);
}

/** The correlation id of the current async context, if any. */
export function getCorrelationId(): string | undefined {
    return storage.getStore();
}
