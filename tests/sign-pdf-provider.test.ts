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
