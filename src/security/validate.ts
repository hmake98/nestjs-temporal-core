import { Logger } from '@nestjs/common';
import type { TemporalOptions } from '../interfaces';

export interface SecurityFinding {
    code: 'plaintext-remote-with-credentials' | 'plaintext-remote';
    message: string;
}

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|::1|\[::1\])$/i;

/** Host part of a `host:port` / `[v6]:port` address. */
function hostOf(address: string): string {
    const bracket = /^\[([^\]]+)\]/.exec(address);
    if (bracket) return bracket[1];
    const colons = address.split(':').length - 1;
    // Bare IPv6 (several colons, no brackets) has no port to strip.
    return colons > 1 ? address : address.replace(/:\d+$/, '');
}

export function isLoopbackAddress(address: string): boolean {
    const host = hostOf(address);
    return LOOPBACK.test(host) || host.toLowerCase().endsWith('.localhost');
}

/**
 * Inspect the connection settings for insecure combinations. Pure: logs and throws nothing.
 * Only remote addresses are flagged; loopback (local dev) is always fine.
 */
export function assessConnectionSecurity(
    options: Pick<TemporalOptions, 'connection'>,
): SecurityFinding[] {
    const connection = options.connection;
    if (!connection?.address || isLoopbackAddress(connection.address)) {
        return [];
    }
    if (connection.tls) {
        return [];
    }

    const hasCredentials =
        !!connection.apiKey ||
        Object.keys(connection.metadata ?? {}).some((k) => k.toLowerCase() === 'authorization');

    return hasCredentials
        ? [
              {
                  code: 'plaintext-remote-with-credentials',
                  message:
                      `Credentials would be sent to remote Temporal server '${connection.address}' ` +
                      'without TLS. Set `connection.tls` (true or a TLS config).',
              },
          ]
        : [
              {
                  code: 'plaintext-remote',
                  message:
                      `Connecting to remote Temporal server '${connection.address}' without TLS ` +
                      'or an API key: traffic is unencrypted and unauthenticated. ' +
                      'Set `connection.tls` and `connection.apiKey` (or client certificates).',
              },
          ];
}

const warned = new Set<string>();

/** @internal Test hook. */
export function resetSecurityWarnings(): void {
    warned.clear();
}

/**
 * Warn about insecure connection settings; with `strictSecurity: true` throw instead, so
 * the app fails at startup rather than running exposed. Each warning is logged once.
 */
export function enforceConnectionSecurity(
    options: Pick<TemporalOptions, 'connection' | 'strictSecurity'>,
    log: { warn(message: string): void } = new Logger('TemporalSecurity'),
): SecurityFinding[] {
    const findings = assessConnectionSecurity(options);

    if (options.strictSecurity && findings.length > 0) {
        throw new Error(
            `strictSecurity: ${findings.map((f) => f.message).join(' ')} ` +
                'Fix the connection settings or disable `strictSecurity`.',
        );
    }
    for (const finding of findings) {
        if (!warned.has(finding.message)) {
            warned.add(finding.message);
            log.warn(finding.message);
        }
    }
    return findings;
}
