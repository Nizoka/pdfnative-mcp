/**
 * Unit tests for the node:crypto signature provider (v1.3.0).
 */
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

import { buildNodeCryptoProvider } from '../src/crypto-provider.js';

describe('buildNodeCryptoProvider', () => {
    it('returns null when the RSA key bytes cannot be imported', () => {
        const provider = buildNodeCryptoProvider({
            algorithm: 'rsa-sha256',
            der: new Uint8Array([1, 2, 3, 4]),
            keyType: 'pkcs1',
        });
        expect(provider).toBeNull();
    });

    it('returns null when the EC key bytes cannot be imported', () => {
        const provider = buildNodeCryptoProvider({
            algorithm: 'ecdsa-sha256',
            der: new Uint8Array([9, 9, 9, 9]),
            keyType: 'sec1',
        });
        expect(provider).toBeNull();
    });

    it('signs with a real RSA PKCS#1 key and returns a non-empty signature', () => {
        const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const der = new Uint8Array(privateKey.export({ format: 'der', type: 'pkcs1' }));
        const provider = buildNodeCryptoProvider({ algorithm: 'rsa-sha256', der, keyType: 'pkcs1' });
        expect(provider).not.toBeNull();
        const sig = provider!.sign(new Uint8Array([1, 2, 3, 4, 5]), 'rsa-sha256');
        // RSA-2048 signature is 256 bytes.
        expect(sig.byteLength).toBe(256);
    });

    it('signs with a real EC P-256 PKCS#8 key (DER-encoded ECDSA)', () => {
        const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
        const der = new Uint8Array(privateKey.export({ format: 'der', type: 'pkcs8' }));
        const provider = buildNodeCryptoProvider({ algorithm: 'ecdsa-sha256', der, keyType: 'pkcs8' });
        expect(provider).not.toBeNull();
        const sig = provider!.sign(new Uint8Array([1, 2, 3, 4, 5]), 'ecdsa-sha256');
        // DER-encoded ECDSA signature begins with a SEQUENCE tag (0x30).
        expect(sig[0]).toBe(0x30);
        expect(sig.byteLength).toBeGreaterThan(8);
    });
});
