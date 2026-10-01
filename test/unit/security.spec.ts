import {
    assessConnectionSecurity,
    enforceConnectionSecurity,
    isLoopbackAddress,
} from '../../src/security';
import { resetSecurityWarnings } from '../../src/security/validate';

const conn = (c: Record<string, unknown>) => ({ connection: c as never });

describe('isLoopbackAddress', () => {
    it.each([
        'localhost:7233',
        'LOCALHOST',
        '127.0.0.1:7233',
        '127.1.2.3',
        '[::1]:7233',
        '::1',
        'app.localhost:7233',
    ])('%s is loopback', (address) => expect(isLoopbackAddress(address)).toBe(true));

    it.each(['temporal:7233', 'ns.acct.tmprl.cloud:7233', '10.0.0.5:7233', '[2001:db8::1]:7233'])(
        '%s is remote',
        (address) => expect(isLoopbackAddress(address)).toBe(false),
    );
});

describe('assessConnectionSecurity', () => {
    const remote = 'ns.acct.tmprl.cloud:7233';

    it.each([
        ['loopback, no tls, no key', conn({ address: 'localhost:7233' }), []],
        ['loopback with key and no tls', conn({ address: '127.0.0.1:7233', apiKey: 'k' }), []],
        ['remote + tls + key', conn({ address: remote, tls: true, apiKey: 'k' }), []],
        [
            'remote + tls object, no key',
            conn({ address: remote, tls: { serverNameOverride: 'x' } }),
            [],
        ],
        ['no connection at all', {}, []],
        ['no address', conn({}), []],
    ])('%s: clean', (_n, options, expected) => {
        expect(assessConnectionSecurity(options)).toEqual(expected);
    });

    it('flags remote without TLS or key as plaintext-remote', () => {
        const [finding] = assessConnectionSecurity(conn({ address: remote }));

        expect(finding.code).toBe('plaintext-remote');
        expect(finding.message).toContain(remote);
    });

    it('flags remote apiKey without TLS as credentials in plaintext', () => {
        const [finding] = assessConnectionSecurity(
            conn({ address: remote, apiKey: 'k', tls: false }),
        );

        expect(finding.code).toBe('plaintext-remote-with-credentials');
    });

    it('treats an Authorization metadata header as credentials', () => {
        const [finding] = assessConnectionSecurity(
            conn({ address: remote, metadata: { Authorization: 'Bearer x' } }),
        );

        expect(finding.code).toBe('plaintext-remote-with-credentials');
    });
});

describe('enforceConnectionSecurity', () => {
    const bad = conn({ address: 'ns.acct.tmprl.cloud:7233' });

    beforeEach(() => resetSecurityWarnings());

    it('warns once per distinct finding and does not throw by default', () => {
        const log = { warn: jest.fn() };

        enforceConnectionSecurity(bad, log);
        enforceConnectionSecurity(bad, log);

        expect(log.warn).toHaveBeenCalledTimes(1);
    });

    it('stays silent for secure settings', () => {
        const log = { warn: jest.fn() };

        enforceConnectionSecurity(conn({ address: 'localhost:7233' }), log);
        enforceConnectionSecurity(conn({ address: 'a.b:7233', tls: true, apiKey: 'k' }), log);

        expect(log.warn).not.toHaveBeenCalled();
    });

    it('strictSecurity turns the finding into a startup error with the fix in the message', () => {
        const log = { warn: jest.fn() };

        expect(() => enforceConnectionSecurity({ ...bad, strictSecurity: true }, log)).toThrow(
            /strictSecurity:.*without TLS.*Fix the connection settings/s,
        );
        expect(log.warn).not.toHaveBeenCalled();
    });

    it('strictSecurity with secure settings does not throw', () => {
        expect(() =>
            enforceConnectionSecurity(
                { ...conn({ address: 'a.b:7233', tls: true, apiKey: 'k' }), strictSecurity: true },
                { warn: jest.fn() },
            ),
        ).not.toThrow();
    });

    it('logs through a Nest logger when none is given', () => {
        expect(() => enforceConnectionSecurity(bad)).not.toThrow();
    });
});
