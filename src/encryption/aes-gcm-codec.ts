import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { Payload, PayloadCodec } from '@temporalio/common';
import type { DataConverter } from '@temporalio/common';
import { AES_256_KEY_BYTES, EncryptionKeyProvider } from './key-provider';

export const ENCRYPTED_ENCODING = 'binary/encrypted';
export const KEY_ID_METADATA = 'encryption-key-id';

const ENCODING_KEY = 'encoding';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 4;
const text = (s: string): Uint8Array => Buffer.from(s, 'utf8');

/** Serialize a payload (metadata + data) so both are encrypted, not just `data`. */
function pack(payload: Payload): Buffer {
    const metadata: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload.metadata ?? {})) {
        metadata[key] = Buffer.from(value).toString('base64');
    }
    const header = Buffer.from(JSON.stringify(metadata), 'utf8');
    const length = Buffer.alloc(HEADER_BYTES);
    length.writeUInt32BE(header.length);
    return Buffer.concat([length, header, Buffer.from(payload.data ?? [])]);
}

function unpack(buffer: Buffer): Payload {
    const headerLength = buffer.readUInt32BE(0);
    const header = JSON.parse(
        buffer.subarray(HEADER_BYTES, HEADER_BYTES + headerLength).toString('utf8'),
    ) as Record<string, string>;
    const metadata: Record<string, Uint8Array> = {};
    for (const [key, value] of Object.entries(header)) {
        metadata[key] = Buffer.from(value, 'base64');
    }
    return { metadata, data: buffer.subarray(HEADER_BYTES + headerLength) };
}

async function keyFor(provider: EncryptionKeyProvider, keyId: string): Promise<Buffer> {
    const key = await provider.getKey(keyId);
    if (key.length !== AES_256_KEY_BYTES) {
        throw new Error(`Encryption key '${keyId}' must be ${AES_256_KEY_BYTES} bytes`);
    }
    return key;
}

/**
 * AES-256-GCM payload codec using Node's `crypto` (no extra dependency).
 *
 * - Encrypts the whole payload, metadata included; the Temporal server and UI only see
 *   ciphertext tagged `binary/encrypted` plus the key id.
 * - The key id is authenticated (GCM additional data), so swapping it is detected.
 * - Decoding passes through payloads that are not encrypted, so you can turn encryption on
 *   for an existing namespace; old plaintext history stays readable.
 * - Tampered ciphertext or a wrong key makes decoding throw.
 */
export class AesGcmPayloadCodec implements PayloadCodec {
    constructor(private readonly keys: EncryptionKeyProvider) {}

    async encode(payloads: Payload[]): Promise<Payload[]> {
        const keyId = await this.keys.currentKeyId();
        const key = await keyFor(this.keys, keyId);

        return payloads.map((payload) => {
            const iv = randomBytes(IV_BYTES);
            const cipher = createCipheriv('aes-256-gcm', key, iv);
            cipher.setAAD(Buffer.from(keyId, 'utf8'));
            const encrypted = Buffer.concat([cipher.update(pack(payload)), cipher.final()]);

            return {
                metadata: {
                    [ENCODING_KEY]: text(ENCRYPTED_ENCODING),
                    [KEY_ID_METADATA]: text(keyId),
                },
                data: Buffer.concat([iv, cipher.getAuthTag(), encrypted]),
            };
        });
    }

    async decode(payloads: Payload[]): Promise<Payload[]> {
        return Promise.all(
            payloads.map(async (payload) => {
                const encoding = payload.metadata?.[ENCODING_KEY];
                if (!encoding || Buffer.from(encoding).toString('utf8') !== ENCRYPTED_ENCODING) {
                    return payload;
                }

                const keyId = Buffer.from(payload.metadata?.[KEY_ID_METADATA] ?? []).toString(
                    'utf8',
                );
                try {
                    const key = await keyFor(this.keys, keyId);
                    const data = Buffer.from(payload.data ?? []);
                    const decipher = createDecipheriv(
                        'aes-256-gcm',
                        key,
                        data.subarray(0, IV_BYTES),
                    );
                    decipher.setAAD(Buffer.from(keyId, 'utf8'));
                    decipher.setAuthTag(data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
                    const plain = Buffer.concat([
                        decipher.update(data.subarray(IV_BYTES + TAG_BYTES)),
                        decipher.final(),
                    ]);
                    return unpack(plain);
                } catch (cause) {
                    const error = new Error(
                        `Failed to decrypt payload (key id '${keyId}'): ${
                            cause instanceof Error ? cause.message : String(cause)
                        }`,
                    );
                    (error as Error & { cause?: unknown }).cause = cause;
                    throw error;
                }
            }),
        );
    }
}

/**
 * A `DataConverter` that encrypts every payload with AES-256-GCM. Pass it as the module's
 * `dataConverter` option: it is applied to both the client and the worker.
 *
 * @example
 * ```typescript
 * TemporalModule.register({
 *   dataConverter: createEncryptionDataConverter(
 *     createStaticKeyProvider({ currentKeyId: 'v1', keys: { v1: key } }),
 *   ),
 * });
 * ```
 */
export function createEncryptionDataConverter(keys: EncryptionKeyProvider): DataConverter {
    return { payloadCodecs: [new AesGcmPayloadCodec(keys)] };
}
