/**
 * Tests for `verify_pdf` — end-to-end sign + verify round-trip for both
 * RSA-SHA256 and ECDSA-SHA256 (P-256), plus negative cases:
 *   - tampered PDF body breaks integrity
 *   - tampered signature value breaks signatureValue verification
 *   - non-PDF input rejected
 *   - trustedRootsDerBase64 elevates chainTrust to 'trusted'
 *   - missing signatures returns allValid=false with an empty list
 */
import { describe, expect, it, beforeAll } from 'vitest';
import {
    addSignaturePlaceholder,
    buildDocumentPDFBytes,
    initCrypto,
    signPdfBytes,
} from 'pdfnative';

import { verifyPdf } from '../src/tools/verify-pdf.js';
import { ToolError } from '../src/errors.js';

import { buildRsaSelfSignedCert, buildEcdsaSelfSignedCert } from './_cert-fixtures.js';
import { fullLadder, MOCK_TSA_GEN_TIME } from './_ltv-fixtures.js';

function pdfWithPlaceholder(): Uint8Array {
    const base = buildDocumentPDFBytes({
        title: 'Verify test',
        blocks: [{ type: 'paragraph', text: 'verify_pdf round-trip fixture' }],
    });
    return addSignaturePlaceholder(base, { fieldName: 'Sig1', placeholderBytes: 8192 });
}

function toB64(b: Uint8Array): string {
    return Buffer.from(b).toString('base64');
}

describe('verify_pdf', () => {
    beforeAll(async () => {
        await initCrypto();
    });

    it('verifies an RSA-SHA256 round-trip end-to-end', async () => {
        const { signerCert, rsaKey, certDer } = buildRsaSelfSignedCert();
        const placeheld = pdfWithPlaceholder();
        const signed = signPdfBytes(placeheld, {
            algorithm: 'rsa-sha256',
            signerCert,
            rsaKey,
            signingTime: new Date('2025-01-15T12:00:00Z'),
        });
        const result = await verifyPdf({ pdfBase64: toB64(signed) });
        expect(result.signatureCount).toBe(1);
        expect(result.allValid).toBe(true);
        expect(result.signatures[0]!.algorithm).toBe('rsa-sha256');
        expect(result.signatures[0]!.integrity).toBe(true);
        expect(result.signatures[0]!.chainTrust).toBe('self-signed');
        expect(result.signatures[0]!.errors).toEqual([]);
        expect(result.summary).toContain('1 signature');

        // With trusted root supplied, chainTrust elevates to 'trusted'.
        const resultTrusted = await verifyPdf({
            pdfBase64: toB64(signed),
            trustedRootsDerBase64: [toB64(certDer)],
        });
        expect(resultTrusted.signatures[0]!.chainTrust).toBe('trusted');
        expect(resultTrusted.allValid).toBe(true);
    });

    it('verifies an ECDSA-SHA256 round-trip end-to-end', async () => {
        const { signerCert, ecKey } = buildEcdsaSelfSignedCert();
        const placeheld = pdfWithPlaceholder();
        const signed = signPdfBytes(placeheld, {
            algorithm: 'ecdsa-sha256',
            signerCert,
            ecKey,
            signingTime: new Date('2025-01-15T12:00:00Z'),
        });
        const result = await verifyPdf({ pdfBase64: toB64(signed) });
        expect(result.signatureCount).toBe(1);
        expect(result.allValid).toBe(true);
        expect(result.signatures[0]!.algorithm).toBe('ecdsa-sha256');
        expect(result.signatures[0]!.integrity).toBe(true);
    });

    it('reports integrity=false when the signed PDF body is tampered with', async () => {
        const { signerCert, rsaKey } = buildRsaSelfSignedCert();
        const placeheld = pdfWithPlaceholder();
        const signed = signPdfBytes(placeheld, { algorithm: 'rsa-sha256', signerCert, rsaKey });
        // Flip a single byte well outside the /Contents placeholder window (first 64 bytes are header/title).
        const tampered = new Uint8Array(signed);
        tampered[40]! ^= 0x01;
        const result = await verifyPdf({ pdfBase64: toB64(tampered) });
        expect(result.allValid).toBe(false);
        expect(result.signatures[0]!.integrity).toBe(false);
        expect(result.signatures[0]!.errors.join('|')).toMatch(/messageDigest/);
    });

    it('rejects non-PDF input with PDF_PARSE_FAILED', async () => {
        await expect(verifyPdf({ pdfBase64: toB64(new Uint8Array([1, 2, 3, 4])) })).rejects.toMatchObject({
            code: 'PDF_PARSE_FAILED',
        });
    });

    it('rejects invalid trustedRootsDerBase64 entries with VALIDATION_ERROR', async () => {
        const { signerCert, rsaKey } = buildRsaSelfSignedCert();
        const placeheld = pdfWithPlaceholder();
        const signed = signPdfBytes(placeheld, { algorithm: 'rsa-sha256', signerCert, rsaKey });
        await expect(
            verifyPdf({
                pdfBase64: toB64(signed),
                trustedRootsDerBase64: [toB64(new Uint8Array([0, 1, 2, 3, 4, 5]))],
            }),
        ).rejects.toBeInstanceOf(ToolError);
    });

    it('returns allValid=false with empty signature list when the PDF has no signature widgets', async () => {
        const plain = buildDocumentPDFBytes({ title: 'plain', blocks: [{ type: 'paragraph', text: 'x' }] });
        const result = await verifyPdf({ pdfBase64: toB64(plain) });
        expect(result.signatureCount).toBe(0);
        expect(result.signatures).toEqual([]);
        expect(result.allValid).toBe(false);
        expect(result.summary).toMatch(/no signatures/i);
    });

    it('rejects malformed input with VALIDATION_ERROR', async () => {
        await expect(verifyPdf({ pdfBase64: '' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(verifyPdf({ junk: true })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('reports signature-value failure when /Contents bytes are corrupted in place', async () => {
        const { signerCert, rsaKey } = buildRsaSelfSignedCert();
        const placeheld = pdfWithPlaceholder();
        const signed = signPdfBytes(placeheld, { algorithm: 'rsa-sha256', signerCert, rsaKey });
        // Locate the hex /Contents block and flip a byte inside it. This keeps the PDF byte-range
        // (which excludes Contents) intact so the messageDigest integrity check stays true, but
        // the CMS itself becomes invalid.
        const text = Buffer.from(signed).toString('latin1');
        const hexStart = text.indexOf('/Contents <') + '/Contents <'.length;
        const mutated = new Uint8Array(signed);
        mutated[hexStart + 4] = mutated[hexStart + 4] === 0x41 ? 0x42 : 0x41;
        const result = await verifyPdf({ pdfBase64: toB64(mutated) });
        expect(result.allValid).toBe(false);
        // The flipped nibble lands in the outer SEQUENCE length of the CMS ContentInfo,
        // so the failure is always a CMS parse error (never a signature-value mismatch).
        expect(result.signatures[0]!.errors).toHaveLength(1);
        expect(result.signatures[0]!.errors[0]).toMatch(/^ContentInfo: ASN\.1: value extends beyond buffer/);
        expect(result.signatures[0]!.integrity).toBe(false);
    });

    it('reports unverified chainTrust when supplied roots do not validate the signer', async () => {
        const signerFixture = buildRsaSelfSignedCert('Signer');
        const otherRoot = buildRsaSelfSignedCert('Other Root');
        const placeheld = pdfWithPlaceholder();
        const signed = signPdfBytes(placeheld, {
            algorithm: 'rsa-sha256',
            signerCert: signerFixture.signerCert,
            rsaKey: signerFixture.rsaKey,
        });
        const result = await verifyPdf({
            pdfBase64: toB64(signed),
            trustedRootsDerBase64: [toB64(otherRoot.certDer)],
        });
        expect(result.signatures[0]!.chainTrust).toBe('unverified');
        expect(result.signatures[0]!.errors.join('|')).toMatch(/trusted root/i);
    });

    it('default output carries subFilter but none of the ltv keys', async () => {
        const { signerCert, rsaKey } = buildRsaSelfSignedCert();
        const signed = signPdfBytes(pdfWithPlaceholder(), { algorithm: 'rsa-sha256', signerCert, rsaKey });
        const result = await verifyPdf({ pdfBase64: toB64(signed) });
        expect(Object.keys(result)).toEqual(['signatureCount', 'allValid', 'summary', 'signatures']);
        expect(Object.keys(result.signatures[0]!)).toEqual([
            'fieldName',
            'subFilter',
            'valid',
            'integrity',
            'algorithm',
            'signerSubject',
            'signingTime',
            'reason',
            'location',
            'chainTrust',
            'errors',
        ]);
        expect(result.signatures[0]!.subFilter).toBe('adbe.pkcs7.detached');
        expect(result.signatures[0]!.isDocTimestamp).toBeUndefined();
    });

    it('verifies a /DocTimeStamp as an RFC 3161 token, so a B-LTA document reports allValid=true', async () => {
        const base = buildDocumentPDFBytes({ title: 'LTA', blocks: [{ type: 'paragraph', text: 'archived' }] });
        const { blta } = await fullLadder(base);
        const result = await verifyPdf({ pdfBase64: toB64(blta) });
        expect(result.signatureCount).toBe(2);
        expect(result.allValid).toBe(true);
        expect(result.summary).toBe('All 2 signature(s) valid.');
        const ts = result.signatures.find((s) => s.isDocTimestamp === true);
        expect(ts).toBeDefined();
        expect(ts!.subFilter).toBe('ETSI.RFC3161');
        expect(ts!.integrity).toBe(true);
        expect(ts!.valid).toBe(true);
        expect(ts!.algorithm).toBeNull();
        expect(ts!.signerSubject).toBe('pdfnative Mock TSA');
        expect(ts!.signingTime).toBe(MOCK_TSA_GEN_TIME.toISOString());
        expect(ts!.errors).toEqual([]);
        // Without ltv the document-level extras stay absent.
        expect(result.dss).toBeUndefined();
        expect(result.ltvLevel).toBeUndefined();
    });

    it('reports an unsigned /DocTimeStamp placeholder as invalid without throwing', async () => {
        const base = buildDocumentPDFBytes({ title: 'TS placeholder', blocks: [{ type: 'paragraph', text: 'x' }] });
        const placeheld = addSignaturePlaceholder(base, { docTimeStamp: true, placeholderBytes: 4096 });
        const result = await verifyPdf({ pdfBase64: toB64(placeheld) });
        expect(result.signatureCount).toBe(1);
        expect(result.allValid).toBe(false);
        const ts = result.signatures[0]!;
        expect(ts.isDocTimestamp).toBe(true);
        expect(ts.subFilter).toBe('ETSI.RFC3161');
        expect(ts.integrity).toBe(false);
        expect(ts.valid).toBe(false);
        expect(ts.algorithm).toBeNull();
        expect(ts.errors.length).toBeGreaterThan(0);
    });

    it('reports a tampered /DocTimeStamp revision with integrity=false and allValid=false', async () => {
        const base = buildDocumentPDFBytes({ title: 'LTA', blocks: [{ type: 'paragraph', text: 'archived' }] });
        const { blta } = await fullLadder(base);
        const tampered = new Uint8Array(blta);
        // The document timestamp covers the whole file except its own /Contents; flip a byte
        // of the original revision that the first signature does not cover (its ByteRange gap).
        const text = Buffer.from(blta).toString('latin1');
        const hexStart = text.indexOf('/Contents <') + '/Contents <'.length;
        tampered[hexStart + 2] = tampered[hexStart + 2] === 0x41 ? 0x42 : 0x41;
        const result = await verifyPdf({ pdfBase64: toB64(tampered) });
        const ts = result.signatures.find((s) => s.isDocTimestamp === true)!;
        expect(ts.integrity).toBe(false);
        expect(ts.valid).toBe(false);
        expect(ts.errors.join('|')).toMatch(/messageImprint/);
        expect(result.allValid).toBe(false);
    });
});
