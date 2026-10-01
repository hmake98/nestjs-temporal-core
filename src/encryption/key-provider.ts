/** Supplies AES-256 keys by id so keys can be rotated without losing old data. */
export interface EncryptionKeyProvider {
    /** Id of the key used to encrypt new payloads. */
    currentKeyId(): string | Promise<string>;
    /** Key for `keyId` (32 bytes). Must still return retired keys to decrypt old payloads. */
    getKey(keyId: string): Buffer | Promise<Buffer>;
}

export const AES_256_KEY_BYTES = 32;

/**
 * In-memory key provider. `keys` maps key ids to 32-byte keys; keep retired keys in the map
 * so payloads written under them stay readable after you switch `currentKeyId`.
 *
 * @example
 * ```typescript
 * createStaticKeyProvider({
 *   currentKeyId: 'v2',
 *   keys: { v1: Buffer.from(process.env.KEY_V1!, 'base64'), v2: Buffer.from(process.env.KEY_V2!, 'base64') },
 * });
 * ```
 */
export function createStaticKeyProvider(options: {
    currentKeyId: string;
    keys: Record<string, Buffer>;
}): EncryptionKeyProvider {
    const { currentKeyId, keys } = options;
    for (const [id, key] of Object.entries(keys)) {
        if (key.length !== AES_256_KEY_BYTES) {
            throw new Error(
                `Encryption key '${id}' must be ${AES_256_KEY_BYTES} bytes (AES-256), got ${key.length}`,
            );
        }
    }
    if (!keys[currentKeyId]) {
        throw new Error(`currentKeyId '${currentKeyId}' has no entry in keys`);
    }

    return {
        currentKeyId: () => currentKeyId,
        getKey(keyId) {
            const key = keys[keyId];
            if (!key) {
                throw new Error(`No encryption key available for key id '${keyId}'`);
            }
            return key;
        },
    };
}
