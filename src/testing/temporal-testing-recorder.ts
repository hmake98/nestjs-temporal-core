import { Injectable } from '@nestjs/common';

export interface RecordedCall {
    /** Name of the faked method, e.g. `startWorkflow`. */
    method: string;
    /** Arguments the method was called with. */
    args: unknown[];
}

type Responder = (...args: any[]) => unknown;

/**
 * Shared by the fake services in {@link TemporalTestingModule}: records every call
 * and lets a test configure per-method results and errors.
 *
 * @example
 * ```typescript
 * const temporal = moduleRef.get(TemporalTestingRecorder);
 * temporal.respondWith('queryWorkflow', { success: true, result: 42 });
 * temporal.failWith('signalWorkflow', new Error('down'));
 * expect(temporal.callsTo('startWorkflow')).toHaveLength(1);
 * ```
 */
@Injectable()
export class TemporalTestingRecorder {
    readonly calls: RecordedCall[] = [];
    private readonly responders = new Map<string, Responder>();
    private readonly failures = new Map<string, unknown>();

    /** All recorded calls to `method`, in call order. */
    callsTo(method: string): RecordedCall[] {
        return this.calls.filter((call) => call.method === method);
    }

    /**
     * Configure what `method` returns. Pass a function to compute the result from the
     * call arguments; anything else is returned as-is. Replaces any earlier response.
     */
    respondWith(method: string, response: unknown): this {
        this.failures.delete(method);
        this.responders.set(
            method,
            typeof response === 'function' ? (response as Responder) : () => response,
        );
        return this;
    }

    /** Make `method` reject with `error` until {@link reset} or a new response is set. */
    failWith(method: string, error: unknown): this {
        this.responders.delete(method);
        this.failures.set(method, error);
        return this;
    }

    /** Clear recorded calls and all configured responses and failures. */
    reset(): void {
        this.calls.length = 0;
        this.responders.clear();
        this.failures.clear();
    }

    /** @internal Used by the fakes: record the call, then fail, respond or fall back. */
    run<T>(method: string, args: unknown[], fallback: () => T): T | unknown {
        this.calls.push({ method, args });
        if (this.failures.has(method)) {
            throw this.failures.get(method);
        }
        const responder = this.responders.get(method);
        return responder ? responder(...args) : fallback();
    }
}
