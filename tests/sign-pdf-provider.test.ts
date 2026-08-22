/**
 * End-to-end tests for constant-time signing via the node:crypto provider
 * (v1.3.0). Uses real self-signed cert fixtures and the real `sign_pdf` /
 * `verify_pdf` tools (NO pdfnative mock), so the node:crypto signing path and
 * the pure-JS fallback are both exercised against actual CMS verification.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { signPdf } from '../src/tools/sign-pdf.js';
import { verifyPdf } from '../src/tools/verify-pdf.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { ensureCompressionReady } from '../src/server.js';
import { buildRsaSelfSignedCert, buildEcdsaSelfSignedCert } from './_cert-fixtures.js';

const ENV_KEY = 'PDFNATIVE_MCP_OUTPUT_DIR';

function toB64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
}

async function makePdfToSign(): Promise<string> {
    const result = await generateBasicPdf({ title: 'To sign', blocks: [{ type: 'paragraph', text: 'Sign me' }] });
    return result.base64 as string;
}

describe('sign_pdf — node:crypto provider (constant-time)', () => {
    beforeAll(async () => {
        delete process.env[ENV_KEY];
        await ensureCompressionReady();
    });

    it('signs with an RSA PKCS#1 DER key via node:crypto and verifies', async () => {
        const { certDer, privateKey } = buildRsaSelfSignedCert();
        const rsaDer = new Uint8Array(privateKey.export({ format: 'der', type: 'pkcs1' }));
        const signed = await signPdf({
            pdfBase64: await makePdfToSign(),
            algorithm: 'rsa-sha256',
            certDerBase64: toB64(certDer),
            rsaKeyPkcs1DerBase64: toB64(rsaDer),
            signerName: 'Alice',
        });
        const verified = await verifyPdf({ pdfBase64: signed.base64 as string });
        expect(verified.allValid).toBe(true);
        expect(verified.signatureCount).toBe(1);
    });

    it('signs with an ECDSA P-256 PKCS#8 DER key via node:crypto and verifies', async () => {
        const { certDer, privateKey } = buildEcdsaSelfSignedCert();
        const ecDer = new Uint8Array(privateKey.export({ format: 'der', type: 'pkcs8' }));
        const signed = await signPdf({
            pdfBase64: await makePdfToSign(),
            algorithm: 'ecdsa-sha256',
            certDerBase64: toB64(certDer),
            ecPrivateKeyDerBase64: toB64(ecDer),
        });
        const verified = await verifyPdf({ pdfBase64: signed.base64 as string });
        expect(verified.allValid).toBe(true);
        expect(verified.signatureCount).toBe(1);
    });

    it('signs with a raw P-256 scalar (pure-JS fallback) and verifies', async () => {
        const { certDer, ecKey } = buildEcdsaSelfSignedCert();
        const scalarHex = ecKey.d.toString(16).padStart(64, '0');
        const signed = await signPdf({
            pdfBase64: await makePdfToSign(),
            algorithm: 'ecdsa-sha256',
            certDerBase64: toB64(certDer),
            ecPrivateScalarHex: scalarHex,
        });
        const verified = await verifyPdf({ pdfBase64: signed.base64 as string });
        expect(verified.allValid).toBe(true);
    });
});

describe('sign_pdf — v1.6.0 (pdfnative 1.7): digest agility, PAdES profile, placeholder metadata', () => {
    beforeAll(async () => {
        delete process.env[ENV_KEY];
        await ensureCompressionReady();
    });

    for (const algorithm of ['rsa-sha384', 'rsa-sha512'] as const) {
        it(`signs with ${algorithm} via node:crypto and verify_pdf reports the algorithm`, async () => {
            const { certDer, privateKey } = buildRsaSelfSignedCert();
            const rsaDer = new Uint8Array(privateKey.export({ format: 'der', type: 'pkcs1' }));
            const signed = await signPdf({
                pdfBase64: await makePdfToSign(),
                algorithm,
                certDerBase64: toB64(certDer),
                rsaKeyPkcs1DerBase64: toB64(rsaDer),
            });
            const verified = await verifyPdf({ pdfBase64: signed.base64 as string });
            expect(verified.allValid).toBe(true);
            expect(verified.signatures[0]?.algorithm).toBe(algorithm);
        });
    }

    it('bakes signer metadata into the injected placeholder and emits the PAdES SubFilter for profile=pades', async () => {
        const { certDer, privateKey } = buildRsaSelfSignedCert();
        const rsaDer = new Uint8Array(privateKey.export({ format: 'der', type: 'pkcs1' }));
        const signed = await signPdf({
            pdfBase64: await makePdfToSign(),
            algorithm: 'rsa-sha256',
            profile: 'pades',
            certDerBase64: toB64(certDer),
            rsaKeyPkcs1DerBase64: toB64(rsaDer),
            signerName: 'Alice',
            reason: 'Approved',
            location: 'Paris',
            contactInfo: 'alice@example.com',
        });
        const text = Buffer.from(signed.base64 as string, 'base64').toString('latin1');
        expect(text).toContain('/SubFilter /ETSI.CAdES.detached');
        expect(text).toContain('/Reason (Approved)');
        expect(text).toContain('/Location (Paris)');
        expect(text).toContain('/ContactInfo (alice@example.com)');
        expect(text).toContain('/Name (Alice)');
        const verified = await verifyPdf({ pdfBase64: signed.base64 as string });
        expect(verified.allValid).toBe(true);
        expect(verified.signatures[0]?.reason).toBe('Approved');
        expect(verified.signatures[0]?.location).toBe('Paris');
    });

    it('keeps the default profile on adbe.pkcs7.detached and stays deterministic for a pinned signingTime', async () => {
        const { certDer, privateKey } = buildRsaSelfSignedCert();
        const rsaDer = new Uint8Array(privateKey.export({ format: 'der', type: 'pkcs1' }));
        const pdf = await makePdfToSign();
        const args = { pdfBase64: pdf, algorithm: 'rsa-sha256', certDerBase64: toB64(certDer), rsaKeyPkcs1DerBase64: toB64(rsaDer), signingTime: '2026-01-01T00:00:00Z' };
        const a = await signPdf(args);
        const b = await signPdf(args);
        expect(a.base64).toBe(b.base64);
        expect(Buffer.from(a.base64 as string, 'base64').toString('latin1')).toContain('/SubFilter /adbe.pkcs7.detached');
    });

    it('adds a second signature with allowMultiple + fieldName and both verify', async () => {
        const { certDer, privateKey } = buildRsaSelfSignedCert();
        const rsaDer = new Uint8Array(privateKey.export({ format: 'der', type: 'pkcs1' }));
        const first = await signPdf({
            pdfBase64: await makePdfToSign(),
            algorithm: 'rsa-sha256',
            certDerBase64: toB64(certDer),
            rsaKeyPkcs1DerBase64: toB64(rsaDer),
            fieldName: 'Author',
        });
        const second = await signPdf({
            pdfBase64: first.base64 as string,
            algorithm: 'rsa-sha256',
            certDerBase64: toB64(certDer),
            rsaKeyPkcs1DerBase64: toB64(rsaDer),
            fieldName: 'Reviewer',
            allowMultiple: true,
        });
        const verified = await verifyPdf({ pdfBase64: second.base64 as string });
        expect(verified.signatureCount).toBe(2);
        expect(verified.allValid).toBe(true);
        expect(verified.signatures.map((s) => s.fieldName).sort()).toEqual(['Author', 'Reviewer']);
        // The first revision is preserved verbatim.
        expect((second.base64 as string).startsWith((first.base64 as string).slice(0, -8))).toBe(true);
    });

    it('requires fieldName with allowMultiple and fails fast with TSA_NOT_CONFIGURED for timestamp=true', async () => {
        const { certDer, privateKey } = buildRsaSelfSignedCert();
        const rsaDer = new Uint8Array(privateKey.export({ format: 'der', type: 'pkcs1' }));
        const base = { pdfBase64: await makePdfToSign(), algorithm: 'rsa-sha256', certDerBase64: toB64(certDer), rsaKeyPkcs1DerBase64: toB64(rsaDer) };
        await expect(signPdf({ ...base, allowMultiple: true })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        delete process.env['PDFNATIVE_MCP_TSA_URL'];
        await expect(signPdf({ ...base, timestamp: true })).rejects.toMatchObject({ code: 'TSA_NOT_CONFIGURED' });
    });
});
