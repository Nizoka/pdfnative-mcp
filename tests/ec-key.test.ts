import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { parseEcPrivateKeyDer } from '../src/ec-key.js';
import { ToolError } from '../src/errors.js';

describe('parseEcPrivateKeyDer', () => {
    it('parses a SEC1-encoded P-256 private key', () => {
        const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
        const der = privateKey.export({ format: 'der', type: 'sec1' });
        const scalar = parseEcPrivateKeyDer(new Uint8Array(der));
        expect(typeof scalar).toBe('bigint');
        expect(scalar > 0n).toBe(true);
        // P-256 order n is ~2^256; the scalar must fit
        expect(scalar < 2n ** 256n).toBe(true);
    });

    it('parses a PKCS#8-encoded P-256 private key', () => {
        const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
        const der = privateKey.export({ format: 'der', type: 'pkcs8' });
        const scalar = parseEcPrivateKeyDer(new Uint8Array(der));
        expect(typeof scalar).toBe('bigint');
        expect(scalar > 0n).toBe(true);
    });

    it('rejects unsupported curves (P-384) with EC_CURVE_UNSUPPORTED', () => {
        const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-384' });
        const der = privateKey.export({ format: 'der', type: 'sec1' });
        try {
            parseEcPrivateKeyDer(new Uint8Array(der));
            throw new Error('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(ToolError);
            expect((err as ToolError).code).toBe('EC_CURVE_UNSUPPORTED');
        }
    });

    it('rejects garbage DER with EC_KEY_PARSE_FAILED', () => {
        try {
            parseEcPrivateKeyDer(new Uint8Array([0, 1, 2, 3, 4]));
            throw new Error('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(ToolError);
            expect((err as ToolError).code).toBe('EC_KEY_PARSE_FAILED');
        }
    });

    it('round-trips the scalar (DER -> bigint matches JWK d)', () => {
        const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
        const der = privateKey.export({ format: 'der', type: 'sec1' });
        const jwk = privateKey.export({ format: 'jwk' }) as { d?: string };
        const padded = (jwk.d ?? '').replace(/-/g, '+').replace(/_/g, '/');
        const pad = (4 - (padded.length % 4)) % 4;
        const refHex = Buffer.from(padded + '='.repeat(pad), 'base64').toString('hex').padStart(64, '0');
        const scalar = parseEcPrivateKeyDer(new Uint8Array(der));
        expect(scalar.toString(16).padStart(64, '0')).toBe(refHex);
    });
});
