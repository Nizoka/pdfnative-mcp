/**
 * Proves the offline mock PKI fixtures: the PAdES ladder B-B → B-T → B-LT
 * → B-LTA runs end-to-end through pdfnative's public API with zero network,
 * and the loopback TSA server drives the real HTTP transport path.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import {
    buildDocumentPDFBytes,
    initCrypto,
    listSignatures,
    parseCertificate,
    parseRsaPrivateKey,
    parseTimestampResponse,
    signPdfBytesWithTimestamp,
    buildTimestampRequest,
} from 'pdfnative';

import {
    MOCK_CRL_URL,
    MOCK_OCSP_URL,
    archivedBLTA,
    createMockPki,
    createMockRevocationProvider,
    createMockTimestampProvider,
    fullLadder,
    ltvBLT,
    placeholderForPades,
    signedBB,
    signedBT,
} from './_ltv-fixtures.js';
import { fetchTimestampProvider, startMockTsaServer } from './_tsa-server.js';

const pki = createMockPki();

beforeAll(async () => {
    await initCrypto();
});

function samplePdf(): Uint8Array {
    return buildDocumentPDFBytes({
        title: 'LTV fixtures',
        blocks: [{ type: 'paragraph', text: 'long-term validation' }],
    });
}

function latin1(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('latin1');
}

describe('mock PKI', () => {
    it('is deterministic and memoised', () => {
        expect(createMockPki()).toBe(pki);
        expect(pki.signer.certDerBase64).toBe(Buffer.from(pki.signer.certDer).toString('base64'));
        expect(pki.chainDerBase64).toEqual([pki.root.certDerBase64]);
    });

    it('certificates carry the expected extensions (parsed by pdfnative)', () => {
        expect(pki.root.cert.isCA).toBe(true);
        expect(pki.signer.cert.ocspUrls).toEqual([MOCK_OCSP_URL]);
        expect(pki.signer.cert.crlUrls).toEqual([MOCK_CRL_URL]);
        expect(pki.signer.cert.caIssuersUrls?.length).toBe(1);
        expect(pki.signer.cert.authorityKeyId).toEqual(pki.root.cert.subjectKeyId);
        expect(pki.tsa.cert.extKeyUsage?.length).toBe(1);
        expect(pki.ocsp.cert.hasOcspNoCheck).toBe(true);
        expect(parseCertificate(Buffer.from(pki.tsa.certDerBase64, 'base64')).serialNumber).toBe(3n);
    });

    it('exposes a PKCS#1 key that round-trips through parseRsaPrivateKey', () => {
        const parsed = parseRsaPrivateKey(Buffer.from(pki.signer.rsaKeyPkcs1DerBase64, 'base64'));
        expect(parsed.n).toBe(pki.signer.rsaKey.n);
        expect(parsed.d).toBe(pki.signer.rsaKey.d);
    });
});

describe('PAdES ladder', () => {
    it('B-B signs with ETSI.CAdES.detached', () => {
        const bb = signedBB(samplePdf(), { reason: 'fixture' });
        const sigs = listSignatures(bb);
        expect(sigs.length).toBe(1);
        expect(sigs[0]?.subFilter).toBe('ETSI.CAdES.detached');
        expect(sigs[0]?.isPlaceholder).toBe(false);
        expect(latin1(bb)).toContain('/Reason (fixture)');
    });

    it('B-T → B-LT → B-LTA: signature + DocTimeStamp, /DSS and /VRI present', async () => {
        const { bt, blt, blta } = await fullLadder(samplePdf());
        expect(listSignatures(bt).length).toBe(1);
        expect(latin1(blt)).toContain('/DSS');
        expect(latin1(blt)).toContain('/VRI');
        expect(blt.subarray(0, bt.length)).toEqual(bt);

        const sigs = listSignatures(blta);
        expect(sigs.length).toBe(2);
        const dts = sigs.find((s) => s.isDocTimestamp);
        expect(dts?.subFilter).toBe('ETSI.RFC3161');
        expect(sigs.some((s) => !s.isDocTimestamp && s.subFilter === 'ETSI.CAdES.detached')).toBe(true);
        expect(blta.subarray(0, blt.length)).toEqual(blt);
    });

    it('individual rungs compose on a B-B signature', async () => {
        const blt = await ltvBLT(signedBB(samplePdf()));
        const blta = await archivedBLTA(blt);
        expect(listSignatures(blta).filter((s) => s.isDocTimestamp).length).toBe(1);
    });

    it('is byte-deterministic for B-B and B-T (fixed keys, fixed genTime)', async () => {
        const pdf = samplePdf();
        const a = await signedBT(pdf);
        const b = await signedBT(pdf);
        expect(a).toEqual(b);
    });

    it('OCSP failure propagates; preferOcsp=false routes through the (revoked) CRL', async () => {
        const flaky = createMockRevocationProvider(pki, { failOcsp: true, revoked: true });
        const bb = signedBB(samplePdf());
        await expect(ltvBLT(bb, { revocationProvider: flaky })).rejects.toThrow(/responder unavailable/);

        const blt = await ltvBLT(bb, { revocationProvider: flaky, preferOcsp: false });
        const text = latin1(blt);
        expect(text).toContain('/CRLs');
        expect(text).toContain('/DSS');
        expect(text).not.toContain('/OCSPs');
    });

    it('a tampered TSA token makes signPdfBytesWithTimestamp throw', async () => {
        const tampered = createMockTimestampProvider(pki, { tamper: true });
        await expect(signedBT(samplePdf(), { timestampProvider: tampered })).rejects.toThrow(/imprint/);
    });

    it('a status-2 rejection is surfaced and never embedded', async () => {
        const rejecting = createMockTimestampProvider(pki, { status: 2 });
        await expect(signedBT(samplePdf(), { timestampProvider: rejecting })).rejects.toThrow(/status 2/);
    });
});

describe('mock TSA HTTP server', () => {
    it('serves a granted token over HTTP that signs a B-T document', async () => {
        const server = await startMockTsaServer(pki);
        try {
            const provider = fetchTimestampProvider(server.url);
            const bt = await signPdfBytesWithTimestamp(placeholderForPades(samplePdf()), {
                signerCert: pki.signer.cert,
                certChain: pki.chain,
                rsaKey: pki.signer.rsaKey,
                profile: 'pades',
                timestampProvider: provider,
                timestampNonce: 7n,
            });
            expect(listSignatures(bt).length).toBe(1);
            expect(server.requests).toBe(1);

            // The raw reply parses as granted via pdfnative's own parser.
            const reply = await provider.getTimestamp(buildTimestampRequest(new Uint8Array(32)));
            expect(parseTimestampResponse(reply).status).toBe(0);
        } finally {
            await server.close();
        }
    });

    it('reject / tamper / http500 / wrongContentType / wrong media type', async () => {
        const expectations: Array<{ mode: 'reject' | 'tamper' | 'http500' | 'wrongContentType'; re: RegExp }> = [
            { mode: 'reject', re: /status 2/ },
            { mode: 'tamper', re: /imprint/ },
            { mode: 'http500', re: /HTTP 500/ },
            { mode: 'wrongContentType', re: /Content-Type/ },
        ];
        for (const { mode, re } of expectations) {
            const server = await startMockTsaServer(pki, { mode });
            try {
                await expect(signedBT(samplePdf(), { timestampProvider: fetchTimestampProvider(server.url) }))
                    .rejects.toThrow(re);
            } finally {
                await server.close();
            }
        }

        const server = await startMockTsaServer(pki);
        try {
            const res = await fetch(server.url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
            expect(res.status).toBe(415);
            const miss = await fetch(server.url.replace('/tsr', '/other'), { method: 'POST' });
            expect(miss.status).toBe(404);
        } finally {
            await server.close();
        }
    });

    it('slow mode honours an abort signal', async () => {
        const server = await startMockTsaServer(pki, { mode: 'slow', delayMs: 5000 });
        try {
            const provider = fetchTimestampProvider(server.url, { signal: AbortSignal.timeout(100) });
            await expect(signedBT(samplePdf(), { timestampProvider: provider })).rejects.toThrow();
        } finally {
            await server.close();
        }
    });
});
