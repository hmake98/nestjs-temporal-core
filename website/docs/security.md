---
id: security
title: Security
---

Payload encryption, connection checks, safe health endpoints and log redaction. Everything is opt-in except the warnings.

## Encrypt workflow and activity data

Temporal stores workflow inputs, results, signals and activity payloads in its history, readable by anyone with access to the server or the Web UI. `nestjs-temporal-core/encryption` encrypts them with AES-256-GCM before they leave your process. It uses only Node's `crypto`.

```typescript
import { randomBytes } from 'crypto';
import {
  createEncryptionDataConverter,
  createStaticKeyProvider,
} from 'nestjs-temporal-core/encryption';

TemporalModule.register({
  connection: { address, tls: true, apiKey },
  taskQueue: 'orders',
  dataConverter: createEncryptionDataConverter(
    createStaticKeyProvider({
      currentKeyId: 'v1',
      keys: { v1: Buffer.from(process.env.TEMPORAL_KEY_V1!, 'base64') }, // 32 bytes
    }),
  ),
  worker: { workflowsPath, activityClasses: [OrderActivities] },
});
```

The single `dataConverter` option is applied to **both** the client and the worker, so they cannot disagree. A `connection.dataConverter` or `worker.workerOptions.dataConverter` still takes precedence for its own side.

What the server sees: payloads tagged `binary/encrypted` with a key id. Both the payload data and its metadata are encrypted; the key id is authenticated, so swapping it is detected. Each payload gets a fresh random IV.

### Rotate keys

Keep retired keys in `keys`, change `currentKeyId`, redeploy. New payloads use the new key; old ones are decrypted with the key id stored in their metadata.

```typescript
createStaticKeyProvider({
  currentKeyId: 'v2',
  keys: { v1: oldKey, v2: newKey }, // keep v1 until no history needs it
});
```

For keys from a secrets manager, implement `EncryptionKeyProvider` (`currentKeyId()` and `getKey(id)`, both may be async).

### Behavior to know

- **Existing namespaces:** unencrypted payloads pass through on decode, so you can turn encryption on without breaking running workflows. Old history stays plaintext.
- **Failures are loud:** a wrong key, an unknown key id or tampered ciphertext throws `Failed to decrypt payload (key id '...')`.
- **Web UI and CLI** show ciphertext. Run a codec server that decrypts for authorized users if you need readable history.
- **Search attributes and memo** are not payloads of this kind and stay readable; do not put secrets there.
- A custom payload **converter** (not codec) that must run inside workflows needs the bundler's `payloadConverterPath`. Codecs, including this one, do not.

## Connection checks

At startup the library checks the connection settings for a **remote** server (loopback addresses are always fine):

| Situation | Result |
| --- | --- |
| Remote address, no TLS, no API key | Warning: traffic is unencrypted and unauthenticated |
| Remote address, no TLS, API key or `Authorization` header | Warning: credentials would be sent in plaintext |
| Remote address with `tls` set | Nothing |

Each warning is logged once. To make them fatal:

```typescript
TemporalModule.register({ strictSecurity: true, /* ... */ });
```

With `strictSecurity: true` the app fails at startup with a message that names the problem and the fix. It is off by default.

Internal hostnames such as a Docker Compose service name (`temporal:7233`) count as remote. If that network is trusted, leave `strictSecurity` off and accept the warning, or terminate TLS at the sidecar and keep `tls` set.

## Health endpoint

The default `/temporal/health` response lists component state and counts. For endpoints reachable by untrusted callers, return only the status:

```typescript
imports: [TemporalHealthModule.register({ detail: 'minimal' })]
// GET /temporal/health -> { "status": "healthy", "timestamp": "..." }
```

`detail: 'full'` (default) keeps the existing response.

### Terminus

If you use `@nestjs/terminus`, `nestjs-temporal-core/terminus` provides an indicator that returns only `up` / `down` plus the state string:

```typescript
import { TemporalHealthIndicator } from 'nestjs-temporal-core/terminus';

@Module({ imports: [TerminusModule], providers: [TemporalHealthIndicator] })
class HealthModule {}

// in a controller
check() {
  return this.health.check([() => this.temporal.isHealthy('temporal', { requireWorker: true })]);
}
```

Unhealthy states return a `down` result, so Terminus responds with 503. Requires `@nestjs/terminus` 11 or 12. Earlier versions of this indicator threw `HealthCheckError`, which `@nestjs/terminus` 12 no longer provides. A failure while checking is reported as down without exposing the error text.

## Logs

Credentials, TLS material and payload bodies are redacted from library logs. See [Production Observability](./observability.md#redaction) to add your own keys.
