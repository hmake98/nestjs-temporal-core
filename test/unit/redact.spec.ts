import { DEFAULT_REDACT_KEYS, REDACTED, redact } from '../../src/utils/redact';

describe('redact', () => {
    it('masks credentials, TLS material and payload bodies at any depth', () => {
        const input = {
            address: 'localhost:7233',
            apiKey: 'sk-123',
            tls: { clientCertPair: { crt: Buffer.from('c'), key: Buffer.from('k') } },
            metadata: { Authorization: 'Bearer x', 'x-trace': 'ok' },
            payloads: [{ data: 'secret body' }],
        };

        expect(redact(input)).toEqual({
            address: 'localhost:7233',
            apiKey: REDACTED,
            tls: { clientCertPair: REDACTED },
            metadata: { Authorization: REDACTED, 'x-trace': 'ok' },
            payloads: REDACTED,
        });
    });

    it('matches keys ignoring case, dashes and underscores', () => {
        expect(redact({ API_KEY: 'a', 'Api-Key': 'b', apikey: 'c' })).toEqual({
            API_KEY: REDACTED,
            'Api-Key': REDACTED,
            apikey: REDACTED,
        });
    });

    it('redacts custom keys on top of the defaults', () => {
        expect(redact({ ssn: '1', token: 't', name: 'n' }, ['SSN'])).toEqual({
            ssn: REDACTED,
            token: REDACTED,
            name: 'n',
        });
    });

    it('walks arrays', () => {
        expect(redact([{ password: 'p' }, { ok: 1 }])).toEqual([{ password: REDACTED }, { ok: 1 }]);
    });

    it('does not mutate the input', () => {
        const input = { nested: { token: 't' }, list: [{ secret: 's' }] };
        const snapshot = JSON.parse(JSON.stringify(input));

        redact(input);

        expect(input).toEqual(snapshot);
    });

    it('handles cycles', () => {
        const a: Record<string, unknown> = { name: 'a' };
        a.self = a;

        expect(redact(a)).toEqual({ name: 'a', self: '[Circular]' });
    });

    it('does not mistake a repeated sibling for a cycle', () => {
        const shared = { v: 1 };

        expect(redact({ a: shared, b: shared })).toEqual({ a: { v: 1 }, b: { v: 1 } });
    });

    it('summarizes binary values and keeps Errors, Dates and primitives', () => {
        const error = new Error('x');
        const date = new Date(0);

        expect(redact({ bin: new Uint8Array(4), error, date, n: 1, s: 's', z: null })).toEqual({
            bin: '[Binary 4 bytes]',
            error,
            date,
            n: 1,
            s: 's',
            z: null,
        });
    });

    it('returns primitives unchanged', () => {
        expect(redact('plain')).toBe('plain');
        expect(redact(undefined)).toBeUndefined();
    });

    it('ships a non-empty default key list', () => {
        expect(DEFAULT_REDACT_KEYS).toEqual(expect.arrayContaining(['apiKey', 'payloads']));
    });
});
