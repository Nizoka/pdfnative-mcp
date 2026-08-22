/**
 * `verify_pdf` with `ltv: true` — PAdES baseline ladder evaluation against the
 * offline mock PKI (`tests/_ltv-fixtures.ts`):
 *   - B-B / B-T / B-LT / B-LTA levels per rung
 *   - signature timestamp (genTime, imprint) and TSA subject
 *   - revocation status from embedded /DSS material (OCSP and CRL paths)
 *   - tampered timestamp imprint degrades to B-B
 *   - summary verbosity / default output untouched
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { buildDocumentPDFBytes, parseTimestampToken } from 'pdfnative';

import { parseCmsSignedData } from '../src/cms.js';
import { contentsToBytes } from '../src/pdf-introspection.js';
import { ensureCompressionReady } from '../src/server.js';
import { verifyPdf } from '../src/tools/verify-pdf.js';

import { connectLegacy } from './_mcp-harness.js';
import {
    createMockPki,
    createMockRevocationProvider,
    fullLadder,
    ltvBLT,
    MOCK_TSA_GEN_TIME,
    signedBB,
    signedBT,
} from './_ltv-fixtures.js';

function toB64(b: Uint8Array): string {
    return Buffer.from(b).toString('base64');
}

function basePdf(): Uint8Array {
    return buildDocumentPDFBytes({ title: 'LTV ladder', blocks: [{ type: 'paragraph', text: 'ltv fixture' }] });
}

/** Corrupt the last byte of the signature-timestamp messageImprint inside /Contents (in place in the hex). */
function tamperSignatureTimestamp(signed: Uint8Array): Uint8Array {
    const text = Buffer.from(signed).toString('latin1');
    const hexStart = text.indexOf('/Contents <') + '/Contents <'.length;
    const hexEnd = text.indexOf('>', hexStart);
    const contents = contentsToBytes(Buffer.from(text.slice(hexStart, hexEnd), 'hex').toString('latin1'));
    const cms = parseCmsSignedData(contents);
    const tokenDer = cms.signatureTimestampTokenDer!;
    const imprint = parseTimestampToken(tokenDer).messageImprint;
    // Locate the imprint bytes inside the token, then map back to the hex offset in the PDF.
    const tokenOffset = Buffer.from(contents).indexOf(Buffer.from(tokenDer));
    const imprintOffset = Buffer.from(tokenDer).indexOf(Buffer.from(imprint));
    expect(tokenOffset).toBeGreaterThanOrEqual(0);
    expect(imprintOffset).toBeGreaterThanOrEqual(0);
    const byteIndex = tokenOffset + imprintOffset + imprint.length - 1;
    const original = contents[byteIndex]!;
    const flipped = (original ^ 0xff).toString(16).padStart(2, '0');
    const out = new Uint8Array(signed);
    const hexPos = hexStart + byteIndex * 2;
    out[hexPos] = flipped.charCodeAt(0);
    out[hexPos + 1] = flipped.charCodeAt(1);
    return out;
}

describe('verify_pdf ltv', () => {
    beforeAll(async () => {
        await ensureCompressionReady();
    });

    it('reports B-B for a plain PAdES signature (no timestamp, no DSS)', async () => {
        const bb = signedBB(basePdf());
        const result = await verifyPdf({ pdfBase64: toB64(bb), ltv: true });
        expect(result.allValid).toBe(true);
        expect(result.ltvLevel).toBe('B-B');
        expect(result.dss).toBeNull();
        expect(result.caveats).toHaveLength(3);
        expect(result.caveats![0]).toMatch(/embedded \/DSS material only/);
        expect(result.caveats![1]).toMatch(/TSA certificate trust is not evaluated/);
        expect(result.caveats![2]).toMatch(/structural classification/);
        const sig = result.signatures[0]!;
        expect(sig.profile).toBe('pades');
        expect(sig.ltvLevel).toBe('B-B');
        expect(sig.timestamp).toEqual({ present: false, genTime: null, imprintVerified: null, tokenSignatureValid: null, tsaSubject: null });
        expect(sig.revocation).toEqual({ source: 'none', status: 'not-evaluated' });
    });

    it('reports B-T with a verified signature timestamp', async () => {
        const bt = await signedBT(basePdf());
        const result = await verifyPdf({ pdfBase64: toB64(bt), ltv: true });
        expect(result.allValid).toBe(true);
        expect(result.ltvLevel).toBe('B-T');
        const sig = result.signatures[0]!;
        expect(sig.ltvLevel).toBe('B-T');
        expect(sig.timestamp).toEqual({
            present: true,
            genTime: MOCK_TSA_GEN_TIME.toISOString(),
            imprintVerified: true,
            tokenSignatureValid: true,
            tsaSubject: 'pdfnative Mock TSA',
        });
        expect(sig.revocation).toEqual({ source: 'none', status: 'not-evaluated' });
    });

    it('reports B-LT with OCSP revocation status good from the /DSS', async () => {
        const { blt } = await fullLadder(basePdf());
        const result = await verifyPdf({ pdfBase64: toB64(blt), ltv: true });
        expect(result.allValid).toBe(true);
        expect(result.ltvLevel).toBe('B-LT');
        expect(result.dss).not.toBeNull();
        expect(result.dss!.ocsps).toBeGreaterThan(0);
        expect(result.dss!.vriKeys).toHaveLength(1);
        const sig = result.signatures[0]!;
        expect(sig.ltvLevel).toBe('B-LT');
        expect(sig.revocation).toEqual({ source: 'ocsp', status: 'good' });
    });

    it('reports revoked via the CRL path when the DSS carries a CRL listing the signer', async () => {
        const pki = createMockPki();
        const revocationProvider = createMockRevocationProvider(pki, { revoked: true });
        const bt = await signedBT(basePdf(), { pki });
        const blt = await ltvBLT(bt, { pki, revocationProvider, preferOcsp: false });
        const result = await verifyPdf({ pdfBase64: toB64(blt), ltv: true });
        expect(result.dss!.crls).toBeGreaterThan(0);
        const sig = result.signatures[0]!;
        expect(sig.revocation).toEqual({ source: 'crl', status: 'revoked' });
        // Material that speaks about the signer (even negatively) still makes the
        // document structurally B-LT, but a revoked signer is not a valid signature.
        expect(sig.ltvLevel).toBe('B-LT');
        expect(sig.valid).toBe(false);
        expect(sig.errors).toEqual(expect.arrayContaining([expect.stringMatching(/REVOKED/)]));
        expect(result.allValid).toBe(false);
        // Without the ltv view, the cryptographic verdict is unchanged.
        const plain = await verifyPdf({ pdfBase64: toB64(blt) });
        expect(plain.allValid).toBe(true);
    });

    /** Flip one byte of a CMS SignerInfo signature value inside the LAST /Contents hex string of a PDF. */
    function corruptSignatureValue(pdf: Uint8Array, pickToken: (cms: Uint8Array) => Uint8Array): Uint8Array {
        const text = Buffer.from(pdf).toString('latin1');
        const contentsStart = text.lastIndexOf('/Contents <') + '/Contents <'.length;
        const contentsEnd = text.indexOf('>', contentsStart);
        const hex = text.slice(contentsStart, contentsEnd);
        const contents = Buffer.from(hex, 'hex');
        const token = pickToken(contents);
        const sigValue = Buffer.from(parseCmsSignedData(token).signatureValue);
        const at = contents.indexOf(sigValue);
        if (at < 0) throw new Error('signature value not found in /Contents');
        contents[at + 4] = contents[at + 4]! ^ 0xff;
        const patched = text.slice(0, contentsStart) + contents.toString('hex').toUpperCase().padEnd(hex.length, '0') + text.slice(contentsEnd);
        return Buffer.from(patched, 'latin1');
    }

    it('does not claim B-T from a signature timestamp whose own CMS signature is broken', async () => {
        const bt = await signedBT(basePdf());
        // The signature timestamp token sits in the unsigned attributes of the ONLY /Contents.
        const corrupted = corruptSignatureValue(bt, (cms) => parseCmsSignedData(cms).signatureTimestampTokenDer!);
        const result = await verifyPdf({ pdfBase64: toB64(corrupted), ltv: true });
        const sig = result.signatures[0]!;
        expect(sig.valid).toBe(true); // the signer's own signature is untouched
        expect(sig.timestamp?.present).toBe(true);
        expect(sig.timestamp?.imprintVerified).toBe(true); // the imprint is public — anyone can recompute it
        expect(sig.timestamp?.tokenSignatureValid).toBe(false);
        expect(sig.ltvLevel).toBe('B-B');
        expect(result.ltvLevel).toBe('B-B');
    });

    it('a DocTimeStamp whose TSA signature does not verify flips allValid and the summary', async () => {
        const { blta } = await fullLadder(basePdf());
        // The DocTimeStamp is the last /Contents; its value IS the bare TimeStampToken (zero-padded).
        const corrupted = corruptSignatureValue(blta, (contents) => contents);
        const result = await verifyPdf({ pdfBase64: toB64(corrupted) });
        const ts = result.signatures.find((s) => s.isDocTimestamp === true)!;
        expect(ts.integrity).toBe(true);
        expect(ts.valid).toBe(false);
        expect(result.allValid).toBe(false);
        expect(result.summary).toBe('1/2 signature(s) valid.');
    });

    it('reports revoked via OCSP when the responder says so', async () => {
        const pki = createMockPki();
        const revocationProvider = createMockRevocationProvider(pki, { revoked: true });
        const bt = await signedBT(basePdf(), { pki });
        const blt = await ltvBLT(bt, { pki, revocationProvider });
        const result = await verifyPdf({ pdfBase64: toB64(blt), ltv: true });
        expect(result.signatures[0]!.revocation).toEqual({ source: 'ocsp', status: 'revoked' });
    });

    it('reports B-LTA when a valid document timestamp covers the B-LT revision', async () => {
        const { blta } = await fullLadder(basePdf());
        const result = await verifyPdf({ pdfBase64: toB64(blta), ltv: true });
        expect(result.allValid).toBe(true);
        expect(result.ltvLevel).toBe('B-LTA');
        expect(result.signatureCount).toBe(2);
        const sig = result.signatures.find((s) => s.isDocTimestamp !== true)!;
        expect(sig.ltvLevel).toBe('B-LTA');
        expect(sig.profile).toBe('pades');
        const ts = result.signatures.find((s) => s.isDocTimestamp === true)!;
        expect(ts.valid).toBe(true);
        expect(ts.integrity).toBe(true);
        expect(ts.signingTime).toBe(MOCK_TSA_GEN_TIME.toISOString());
        // Timestamp entries carry no per-signature ltv keys.
        expect(ts.ltvLevel).toBeUndefined();
        expect(ts.profile).toBeUndefined();
    });

    it('degrades to B-B when the signature timestamp imprint is tampered', async () => {
        const bt = await signedBT(basePdf());
        const tampered = tamperSignatureTimestamp(bt);
        const result = await verifyPdf({ pdfBase64: toB64(tampered), ltv: true });
        const sig = result.signatures[0]!;
        // The signature value itself is untouched, only the unsigned timestamp attribute.
        expect(sig.valid).toBe(true);
        expect(sig.timestamp!.present).toBe(true);
        expect(sig.timestamp!.imprintVerified).toBe(false);
        expect(sig.ltvLevel).toBe('B-B');
        expect(result.ltvLevel).toBe('B-B');
    });

    it('elevates a document timestamp to trusted when the TSA root is supplied', async () => {
        const pki = createMockPki();
        const { blta } = await fullLadder(basePdf(), { pki });
        const result = await verifyPdf({ pdfBase64: toB64(blta), trustedRootsDerBase64: [pki.root.certDerBase64] });
        for (const s of result.signatures) expect(s.chainTrust).toBe('trusted');
        expect(result.allValid).toBe(true);
    });

    it('keeps the default shape unchanged when ltv is false', async () => {
        const { blt } = await fullLadder(basePdf());
        const result = await verifyPdf({ pdfBase64: toB64(blt) });
        expect(Object.keys(result)).toEqual(['signatureCount', 'allValid', 'summary', 'signatures']);
        expect(result.signatures[0]!.ltvLevel).toBeUndefined();
        expect(result.signatures[0]!.timestamp).toBeUndefined();
        expect(result.signatures[0]!.revocation).toBeUndefined();
        expect(result.signatures[0]!.profile).toBeUndefined();
    });

    it("verbosity='summary' through the MCP handler stays the same scalar verdict with or without ltv", async () => {
        const { blta } = await fullLadder(basePdf());
        const client = await connectLegacy();
        try {
            const call = async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
                const res = (await client.request<{ structuredContent?: Record<string, unknown> }>('tools/call', {
                    name: 'verify_pdf',
                    arguments: args,
                })) as { structuredContent?: Record<string, unknown> };
                return res.structuredContent!;
            };
            const plain = await call({ pdfBase64: toB64(blta), verbosity: 'summary' });
            const withLtv = await call({ pdfBase64: toB64(blta), verbosity: 'summary', ltv: true });
            expect(Object.keys(plain)).toEqual(['signatureCount', 'allValid', 'invalid', 'summary']);
            expect(withLtv).toEqual(plain);
            expect(plain['allValid']).toBe(true);
            expect(plain['invalid']).toBe(0);
        } finally {
            await client.close();
        }
    });
});
