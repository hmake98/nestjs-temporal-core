import { randomBytes } from 'crypto';
import { defaultDataConverter, type Payload } from '@temporalio/common';
import {
    AesGcmPayloadCodec,
    createEncryptionDataConverter,
    createStaticKeyProvider,
    ENCRYPTED_ENCODING,
    KEY_ID_METADATA,
} from '../../src/encryption';

const keyA = randomBytes(32);
const keyB = randomBytes(32);
const plain = (value: unknown): Payload => defaultDataConverter.payloadConverter.toPayload(value)!;
const read = (payload: Payload) => defaultDataConverter.payloadConverter.fromPayload(payload);
const meta = (p: Payload, key: string) => Buffer.from(p.metadata![key]).toString('utf8');

describe('AesGcmPayloadCodec', () => {
    const codec = new AesGcmPayloadCodec(
        createStaticKeyProvider({ currentKeyId: 'k1', keys: { k1: keyA } }),
    );

    it('round-trips payloads, keeping metadata and data intact', async () => {
        const originals = [plain({ a: 1, nested: ['x'] }), plain('text'), plain(42), plain(null)];

        const encrypted = await codec.encode(originals);
        const decrypted = await codec.decode(encrypted);

        expect(decrypted.map(read)).toEqual([{ a: 1, nested: ['x'] }, 'text', 42, null]);
        expect(decrypted[0].metadata).toEqual(originals[0].metadata);
    });

    it('hides content and metadata from the server', async () => {
        const [encrypted] = await codec.encode([plain({ ssn: '123-45-6789' })]);

        expect(meta(encrypted, 'encoding')).toBe(ENCRYPTED_ENCODING);
        expect(meta(encrypted, KEY_ID_METADATA)).toBe('k1');
        expect(Buffer.from(encrypted.data!).toString('utf8')).not.toContain('123-45-6789');
        expect(Object.keys(encrypted.metadata!).sort()).toEqual(['encoding', KEY_ID_METADATA]);
    });

    it('uses a fresh IV per payload, so equal inputs encrypt differently', async () => {
        const [a, b] = await codec.encode([plain('same'), plain('same')]);

        expect(Buffer.from(a.data!).equals(Buffer.from(b.data!))).toBe(false);
    });

    it('fails with a clear error under the wrong key', async () => {
        const [encrypted] = await codec.encode([plain('secret')]);
        const other = new AesGcmPayloadCodec(
            createStaticKeyProvider({ currentKeyId: 'k1', keys: { k1: keyB } }),
        );

        await expect(other.decode([encrypted])).rejects.toThrow(
            /Failed to decrypt payload \(key id 'k1'\)/,
        );
    });

    it('fails when the key id is unknown', async () => {
        const [encrypted] = await codec.encode([plain('secret')]);
        const other = new AesGcmPayloadCodec(
            createStaticKeyProvider({ currentKeyId: 'z', keys: { z: keyB } }),
        );

        await expect(other.decode([encrypted])).rejects.toThrow(
            /No encryption key available for key id 'k1'/,
        );
    });

    it('detects tampered ciphertext', async () => {
        const [encrypted] = await codec.encode([plain('secret')]);
        const data = Buffer.from(encrypted.data!);
        data[data.length - 1] ^= 0xff;

        await expect(codec.decode([{ ...encrypted, data }])).rejects.toThrow(/Failed to decrypt/);
    });

    it('detects a swapped key id (authenticated as additional data)', async () => {
        const rotating = new AesGcmPayloadCodec(
            createStaticKeyProvider({ currentKeyId: 'k1', keys: { k1: keyA, k2: keyA } }),
        );
        const [encrypted] = await rotating.encode([plain('secret')]);
        const forged = {
            ...encrypted,
            metadata: { ...encrypted.metadata, [KEY_ID_METADATA]: Buffer.from('k2') },
        };

        await expect(rotating.decode([forged])).rejects.toThrow(/Failed to decrypt/);
    });

    it('passes through payloads that are not encrypted', async () => {
        const unencrypted = plain({ legacy: true });

        const [out] = await codec.decode([unencrypted]);

        expect(out).toBe(unencrypted);
        expect(await codec.decode([{ data: Buffer.from('x') }])).toHaveLength(1);
    });

    it('handles large payloads', async () => {
        const big = { blob: randomBytes(5 * 1024 * 1024).toString('base64') };

        const [encrypted] = await codec.encode([plain(big)]);
        const [decrypted] = await codec.decode([encrypted]);

        expect(read(decrypted)).toEqual(big);
    });

    it('handles payloads without data or metadata', async () => {
        const [encrypted] = await codec.encode([{}]);
        const [decrypted] = await codec.decode([encrypted]);

        expect(Buffer.from(decrypted.data ?? []).length).toBe(0);
    });

    describe('key rotation', () => {
        const keys = { v1: keyA, v2: keyB };

        it('new data uses the new key; old data still decrypts', async () => {
            const before = new AesGcmPayloadCodec(
                createStaticKeyProvider({ currentKeyId: 'v1', keys }),
            );
            const after = new AesGcmPayloadCodec(
                createStaticKeyProvider({ currentKeyId: 'v2', keys }),
            );

            const [oldPayload] = await before.encode([plain('old')]);
            const [newPayload] = await after.encode([plain('new')]);

            expect(meta(oldPayload, KEY_ID_METADATA)).toBe('v1');
            expect(meta(newPayload, KEY_ID_METADATA)).toBe('v2');
            expect(read((await after.decode([oldPayload]))[0])).toBe('old');
            expect(read((await after.decode([newPayload]))[0])).toBe('new');
        });

        it('an old key that was removed can no longer decrypt', async () => {
            const before = new AesGcmPayloadCodec(
                createStaticKeyProvider({ currentKeyId: 'v1', keys }),
            );
            const [oldPayload] = await before.encode([plain('old')]);
            const retired = new AesGcmPayloadCodec(
                createStaticKeyProvider({ currentKeyId: 'v2', keys: { v2: keyB } }),
            );

            await expect(retired.decode([oldPayload])).rejects.toThrow(/key id 'v1'/);
        });
    });

    it('supports async key providers', async () => {
        const asyncCodec = new AesGcmPayloadCodec({
            currentKeyId: async () => 'remote',
            getKey: async () => keyA,
        });

        const [encrypted] = await asyncCodec.encode([plain('x')]);

        expect(read((await asyncCodec.decode([encrypted]))[0])).toBe('x');
    });

    it('wraps non-Error failures from the key provider', async () => {
        const [encrypted] = await codec.encode([plain('x')]);
        const throwing = new AesGcmPayloadCodec({
            currentKeyId: () => 'k1',
            getKey: () => {
                throw 'vault offline';
            },
        });

        await expect(throwing.decode([encrypted])).rejects.toThrow(/vault offline/);
    });

    it('rejects a provider that returns a wrong-sized key', async () => {
        const bad = new AesGcmPayloadCodec({
            currentKeyId: () => 'short',
            getKey: () => Buffer.alloc(16),
        });

        await expect(bad.encode([plain('x')])).rejects.toThrow(/must be 32 bytes/);
    });
});

describe('createStaticKeyProvider', () => {
    it('rejects keys that are not 32 bytes', () => {
        expect(() =>
            createStaticKeyProvider({ currentKeyId: 'a', keys: { a: Buffer.alloc(16) } }),
        ).toThrow(/must be 32 bytes \(AES-256\), got 16/);
    });

    it('requires currentKeyId to exist', () => {
        expect(() =>
            createStaticKeyProvider({ currentKeyId: 'missing', keys: { a: keyA } }),
        ).toThrow(/currentKeyId 'missing'/);
    });
});

describe('createEncryptionDataConverter', () => {
    const converter = createEncryptionDataConverter(
        createStaticKeyProvider({ currentKeyId: 'k', keys: { k: keyA } }),
    );

    it('produces a DataConverter whose output is only readable through the codec', async () => {
        const [codec] = converter.payloadCodecs!;
        const [payload] = await codec.encode([plain({ secret: 'value' })]);

        expect(meta(payload, 'encoding')).toBe(ENCRYPTED_ENCODING);
        expect(read((await codec.decode([payload]))[0])).toEqual({ secret: 'value' });
        // Without the codec the data is not the original JSON.
        expect(() => read(payload)).toThrow(/Unknown encoding/);
    });
});
