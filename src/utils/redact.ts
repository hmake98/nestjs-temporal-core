/** Placeholder written in place of a sensitive value. */
export const REDACTED = '[REDACTED]';

/**
 * Keys whose values are never logged (compared case-insensitively, ignoring `-` and `_`):
 * credentials, TLS material and workflow/activity payload bodies.
 */
export const DEFAULT_REDACT_KEYS: readonly string[] = [
    'apiKey',
    'authorization',
    'password',
    'secret',
    'token',
    'accessToken',
    'refreshToken',
    'privateKey',
    'clientPrivateKey',
    'clientCertPair',
    'crt',
    'key',
    'serverRootCACertificate',
    'payload',
    'payloads',
];

const normalize = (key: string): string => key.replace(/[-_]/g, '').toLowerCase();

/**
 * Deep-copy `value` with sensitive values replaced by {@link REDACTED}. Never mutates the
 * input, tolerates cycles (`[Circular]`), and summarizes binary data instead of dumping it.
 *
 * @param extraKeys additional keys to redact, on top of {@link DEFAULT_REDACT_KEYS}
 */
export function redact<T>(value: T, extraKeys: readonly string[] = []): T {
    const keys = new Set([...DEFAULT_REDACT_KEYS, ...extraKeys].map(normalize));
    return walk(value, keys, new WeakSet()) as T;
}

function walk(value: unknown, keys: Set<string>, seen: WeakSet<object>): unknown {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (value instanceof Error) {
        return value;
    }
    if (value instanceof Uint8Array) {
        return `[Binary ${value.byteLength} bytes]`;
    }
    if (value instanceof Date) {
        return value;
    }
    if (seen.has(value)) {
        return '[Circular]';
    }
    seen.add(value);

    let result: unknown;
    if (Array.isArray(value)) {
        result = value.map((item) => walk(item, keys, seen));
    } else {
        const out: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value)) {
            out[key] = keys.has(normalize(key)) ? REDACTED : walk(child, keys, seen);
        }
        result = out;
    }
    // Only ancestors count as cycles; the same object appearing twice in siblings is fine.
    seen.delete(value);
    return result;
}
