/**
 * add_ltv / timestamp_pdf / sign_pdf{timestamp} through the MCP tools, with
 * the operator-configured network path driven end-to-end: a real loopback
 * RFC 3161 server for the TSA, and OCSP / CRL requests to the mock PKI's
 * `mock.invalid` endpoints routed through the `fetch` test seam.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { listSignatures } from 'pdfnative';

import { ensureCompressionReady } from '../src/server.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { signPdf } from '../src/tools/sign-pdf.js';
import { verifyPdf } from '../src/tools/verify-pdf.js';
import { addLtv } from '../src/tools/add-ltv.js';
import { timestampPdf } from '../src/tools/timestamp-pdf.js';
import { ToolError } from '../src/errors.js';
import { ALLOWED_HOSTS_ENV, REVOCATION_ENV, TSA_URL_ENV, __setFetchForTests } from '../src/network.js';
import { assertValidPdf } from './_pdf-assert.js';
import { createMockPki, createMockRevocationProvider, MOCK_CRL_URL, MOCK_OCSP_URL, type MockPki } from './_ltv-fixtures.js';
import { startMockTsaServer, type MockTsaServer } from './_tsa-server.js';

const ENV = [TSA_URL_ENV, REVOCATION_ENV, ALLOWED_HOSTS_ENV, 'PDFNATIVE_MCP_TSA_AUTH'];

function text(b64: string): string {
    return Buffer.from(b64, 'base64').toString('latin1');
}

/** Route the mock PKI's OCSP / CRL URLs to the in-process provider through the fetch seam. */
function routeRevocationToMock(pki: MockPki, opts?: { revoked?: boolean }): void {
    const provider = createMockRevocationProvider(pki, opts);
    __setFetchForTests(async (input, init) => {
        const url = String(input);
        if (url === MOCK_OCSP_URL && provider.fetchOcsp !== undefined) {
            const body = init?.body as Uint8Array;
            return new Response(await provider.fetchOcsp(url, body), { status: 200, headers: { 'content-type': 'application/ocsp-response' } });
        }
        if (url === MOCK_CRL_URL && provider.fetchCrl !== undefined) {
            return new Response(await provider.fetchCrl(url), { status: 200, headers: { 'content-type': 'application/pkix-crl' } });
        }
        // Anything else (incl. the loopback TSA) goes to the real network.
        return globalThis.fetch(input, init);
    });
}

describe('LTV tools (add_ltv, timestamp_pdf, sign_pdf timestamp)', () => {
    let pki: MockPki;
    let tsa: MockTsaServer | undefined;
    let unsignedPdf: string;

    beforeAll(async () => {
        await ensureCompressionReady();
        pki = createMockPki();
        unsignedPdf = (await generateBasicPdf({ title: 'LTV', blocks: [{ type: 'paragraph', text: 'long-term validation' }] })).base64!;
    });
    afterEach(async () => {
        for (const k of ENV) delete process.env[k];
        __setFetchForTests(null);
        if (tsa !== undefined) {
            await tsa.close();
            tsa = undefined;
        }
    });

    async function signPades(opts: { timestamp?: boolean } = {}): Promise<string> {
        const r = await signPdf({
            pdfBase64: unsignedPdf,
            algorithm: 'rsa-sha256',
            profile: 'pades',
            certDerBase64: pki.signer.certDerBase64,
            certChainDerBase64: [...pki.chainDerBase64],
            rsaKeyPkcs1DerBase64: pki.signer.rsaKeyPkcs1DerBase64,
            reason: 'Contract',
            ...(opts.timestamp === true ? { timestamp: true } : {}),
        });
        return r.base64!;
    }

    it('is offline by default: timestamp / online LTV fail fast without any network configuration', async () => {
        const signed = await signPades();
        await expect(timestampPdf({ pdfBase64: signed })).rejects.toMatchObject({ code: 'TSA_NOT_CONFIGURED' });
        await expect(addLtv({ pdfBase64: signed })).rejects.toMatchObject({ code: 'REVOCATION_NOT_CONFIGURED' });
        await expect(signPdf({ pdfBase64: unsignedPdf, algorithm: 'rsa-sha256', certDerBase64: pki.signer.certDerBase64, rsaKeyPkcs1DerBase64: pki.signer.rsaKeyPkcs1DerBase64, timestamp: true })).rejects.toMatchObject({ code: 'TSA_NOT_CONFIGURED' });
    });

    it('runs the full PAdES ladder B-B → B-T → B-LT (online) → B-LTA through the tools', async () => {
        tsa = await startMockTsaServer(pki);
        process.env[TSA_URL_ENV] = tsa.url;
        process.env[REVOCATION_ENV] = 'ocsp,crl';
        process.env[ALLOWED_HOSTS_ENV] = 'mock.invalid';
        routeRevocationToMock(pki);

        const bt = await signPades({ timestamp: true });
        expect(tsa.requests).toBe(1);
        assertValidPdf(Buffer.from(bt, 'base64'));
        expect(text(bt)).toContain('/SubFilter /ETSI.CAdES.detached');

        const blt = await addLtv({ pdfBase64: bt, mode: 'online' });
        expect(blt.summary).toMatchObject({ mode: 'online', signatures: 1 });
        const bltText = text(blt.base64!);
        expect(bltText).toContain('/DSS');
        expect(bltText).toContain('/VRI');
        expect(bltText).toContain('/OCSPs');

        const blta = await timestampPdf({ pdfBase64: blt.base64! });
        expect(tsa.requests).toBe(2);
        const sigs = listSignatures(Buffer.from(blta.base64!, 'base64'));
        expect(sigs.filter((s) => s.isDocTimestamp)).toHaveLength(1);
        expect(sigs.filter((s) => !s.isDocTimestamp && !s.isPlaceholder)).toHaveLength(1);
        // Every rung is an incremental revision: the previous bytes are a verbatim prefix.
        expect(blta.base64!.startsWith(blt.base64!.slice(0, -8))).toBe(true);

        // Re-timestamping extends the chain with an auto-suffixed field.
        const again = await timestampPdf({ pdfBase64: blta.base64! });
        const names = listSignatures(Buffer.from(again.base64!, 'base64')).filter((s) => s.isDocTimestamp).map((s) => s.fieldName);
        expect(names).toEqual(['DocTimeStamp1', 'DocTimeStamp2']);
    });

    it('embeds caller-supplied material offline (no network at all) and validates every blob', async () => {
        const signed = await signPades();
        const provider = createMockRevocationProvider(pki);
        const crlDer = await provider.fetchCrl!(MOCK_CRL_URL);
        const out = await addLtv({
            pdfBase64: signed,
            mode: 'offline',
            certificatesDerBase64: [pki.root.certDerBase64],
            crlsDerBase64: [Buffer.from(crlDer).toString('base64')],
        });
        expect(out.summary).toMatchObject({ mode: 'offline', signatures: 1, certificates: 1, crls: 1, ocspResponses: 0 });
        const t = text(out.base64!);
        expect(t).toContain('/DSS');
        expect(t).toContain('/CRLs');
        expect(t).toContain('/VRI');

        await expect(addLtv({ pdfBase64: signed, mode: 'offline' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(addLtv({ pdfBase64: signed, mode: 'offline', certificatesDerBase64: ['AQIDBA=='] })).rejects.toMatchObject({ code: 'LTV_MATERIAL_INVALID' });
        await expect(addLtv({ pdfBase64: signed, mode: 'offline', crlsDerBase64: [pki.root.certDerBase64] })).rejects.toMatchObject({ code: 'LTV_MATERIAL_INVALID' });
        await expect(addLtv({ pdfBase64: unsignedPdf, mode: 'offline', certificatesDerBase64: [pki.root.certDerBase64] })).rejects.toMatchObject({ code: 'LTV_NO_SIGNATURE' });
    });

    it('refuses unsigned documents online and refuses revocation hosts outside the allow-list', async () => {
        process.env[REVOCATION_ENV] = 'ocsp';
        process.env[ALLOWED_HOSTS_ENV] = 'ocsp.example.com'; // mock.invalid is NOT listed
        routeRevocationToMock(pki);
        const signed = await signPades();
        const err = await addLtv({ pdfBase64: signed }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ToolError);
        expect(['NETWORK_HOST_NOT_ALLOWED', 'LTV_ERROR']).toContain((err as ToolError).code);
        expect((err as ToolError).message).toMatch(/not in PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS|mock\.invalid/);

        process.env[ALLOWED_HOSTS_ENV] = 'mock.invalid';
        await expect(addLtv({ pdfBase64: unsignedPdf })).rejects.toMatchObject({ code: 'LTV_NO_SIGNATURE' });
    });

    it('maps TSA failures: rejection status and HTTP errors never embed a token', async () => {
        tsa = await startMockTsaServer(pki, { mode: 'reject' });
        process.env[TSA_URL_ENV] = tsa.url;
        const signed = await signPades();
        await expect(timestampPdf({ pdfBase64: signed })).rejects.toMatchObject({ code: 'TSA_REJECTED' });
        await tsa.close();

        tsa = await startMockTsaServer(pki, { mode: 'http500' });
        process.env[TSA_URL_ENV] = tsa.url;
        await expect(timestampPdf({ pdfBase64: signed })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
        await expect(signPdf({ pdfBase64: unsignedPdf, algorithm: 'rsa-sha256', certDerBase64: pki.signer.certDerBase64, rsaKeyPkcs1DerBase64: pki.signer.rsaKeyPkcs1DerBase64, timestamp: true })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    });

    it('rejects malformed input and non-PDF bytes', async () => {
        tsa = await startMockTsaServer(pki);
        process.env[TSA_URL_ENV] = tsa.url;
        await expect(timestampPdf({ pdfBase64: 'AQIDBA==', placeholderBytes: 1 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(timestampPdf({ pdfBase64: 'AQIDBA==' })).rejects.toMatchObject({ code: 'PDF_PARSE_FAILED' });
        process.env[REVOCATION_ENV] = 'ocsp';
        process.env[ALLOWED_HOSTS_ENV] = 'mock.invalid';
        await expect(addLtv({ pdfBase64: 'AQIDBA==' })).rejects.toMatchObject({ code: 'PDF_PARSE_FAILED' });
    });
});

describe('sign_pdf — review regressions (placeholder selection, chain, TSA rejection)', () => {
    let pki: MockPki;
    let tsa: MockTsaServer | undefined;
    let unsignedPdf: string;

    beforeAll(async () => {
        await ensureCompressionReady();
        pki = createMockPki();
        unsignedPdf = (await generateBasicPdf({ title: 'Sign', blocks: [{ type: 'paragraph', text: 'review' }] })).base64!;
    });
    afterEach(async () => {
        for (const k of ENV) delete process.env[k];
        if (tsa !== undefined) {
            await tsa.close();
            tsa = undefined;
        }
    });

    const keys = (): Record<string, unknown> => ({
        algorithm: 'rsa-sha256',
        certDerBase64: pki.signer.certDerBase64,
        rsaKeyPkcs1DerBase64: pki.signer.rsaKeyPkcs1DerBase64,
    });

    it('PLACEHOLDER_AMBIGUOUS when several unsigned placeholders exist and no fieldName is given; SIGNATURE_FIELD_NOT_FOUND for a wrong name', async () => {
        const { addSignaturePlaceholder } = await import('pdfnative');
        const one = addSignaturePlaceholder(Buffer.from(unsignedPdf, 'base64'), { fieldName: 'Author' });
        const two = addSignaturePlaceholder(one, { fieldName: 'Reviewer', allowMultiple: true });
        const pdf = Buffer.from(two).toString('base64');
        await expect(signPdf({ pdfBase64: pdf, ...keys() })).rejects.toMatchObject({ code: 'PLACEHOLDER_AMBIGUOUS' });
        await expect(signPdf({ pdfBase64: pdf, ...keys(), fieldName: 'Nobody' })).rejects.toMatchObject({ code: 'SIGNATURE_FIELD_NOT_FOUND' });
        const signed = await signPdf({ pdfBase64: pdf, ...keys(), fieldName: 'Reviewer' });
        const v = await verifyPdf({ pdfBase64: signed.base64! });
        expect(v.signatures.find((s) => s.fieldName === 'Reviewer')?.valid).toBe(true);
    });

    it('rejects an unparsable certChainDerBase64 entry and walks a carried intermediate chain up to a trusted root', async () => {
        await expect(signPdf({ pdfBase64: unsignedPdf, ...keys(), certChainDerBase64: ['AQIDBA=='] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        // Signer → root (the mock PKI has no intermediate): the root must be found through the carried chain.
        const signed = await signPdf({ pdfBase64: unsignedPdf, ...keys(), certChainDerBase64: [...pki.chainDerBase64] });
        const trusted = await verifyPdf({ pdfBase64: signed.base64!, trustedRootsDerBase64: [pki.root.certDerBase64] });
        expect(trusted.signatures[0]?.chainTrust).toBe('trusted');
        expect(trusted.allValid).toBe(true);
    });

    it('sign_pdf timestamp=true maps a TSA rejection to TSA_REJECTED and embeds nothing', async () => {
        tsa = await startMockTsaServer(pki, { mode: 'reject' });
        process.env[TSA_URL_ENV] = tsa.url;
        await expect(signPdf({ pdfBase64: unsignedPdf, ...keys(), profile: 'pades', timestamp: true })).rejects.toMatchObject({ code: 'TSA_REJECTED' });
        expect(tsa.requests).toBe(1);
    });
});

describe('add_ltv — review regressions (online material validation, VRI coverage)', () => {
    let pki: MockPki;
    let tsa: MockTsaServer | undefined;
    let unsignedPdf: string;

    beforeAll(async () => {
        await ensureCompressionReady();
        pki = createMockPki();
        unsignedPdf = (await generateBasicPdf({ title: 'LTV2', blocks: [{ type: 'paragraph', text: 'review' }] })).base64!;
    });
    afterEach(async () => {
        for (const k of ENV) delete process.env[k];
        __setFetchForTests(null);
        if (tsa !== undefined) {
            await tsa.close();
            tsa = undefined;
        }
    });

    async function signed(): Promise<string> {
        const r = await signPdf({ pdfBase64: unsignedPdf, algorithm: 'rsa-sha256', profile: 'pades', certDerBase64: pki.signer.certDerBase64, certChainDerBase64: [...pki.chainDerBase64], rsaKeyPkcs1DerBase64: pki.signer.rsaKeyPkcs1DerBase64 });
        return r.base64!;
    }

    it('online mode refuses a responder answer that is not an OCSP response / CRL (HTTP 200 HTML page)', async () => {
        process.env[REVOCATION_ENV] = 'ocsp,crl';
        process.env[ALLOWED_HOSTS_ENV] = 'mock.invalid';
        __setFetchForTests(async () => new Response('<html>maintenance</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
        const err = await addLtv({ pdfBase64: await signed(), mode: 'online' }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ToolError);
        expect((err as ToolError).code).toBe('LTV_MATERIAL_INVALID');
        expect((err as ToolError).message).toMatch(/mock\.invalid/);
    });

    it('offline mode gives every signed field — document timestamps included — a /VRI entry', async () => {
        tsa = await startMockTsaServer(pki);
        process.env[TSA_URL_ENV] = tsa.url;
        const stamped = await timestampPdf({ pdfBase64: await signed() });
        const provider = createMockRevocationProvider(pki);
        const crlDer = await provider.fetchCrl!(MOCK_CRL_URL);
        const out = await addLtv({ pdfBase64: stamped.base64!, mode: 'offline', certificatesDerBase64: [pki.root.certDerBase64, pki.tsa.certDerBase64], crlsDerBase64: [Buffer.from(crlDer).toString('base64')] });
        expect(out.summary).toMatchObject({ signatures: 2 });
        const { inspectPdf } = await import('../src/tools/inspect-pdf.js');
        const info = (await inspectPdf({ pdfBase64: out.base64! })) as { dss?: { vriKeys: string[] } };
        expect(info.dss?.vriKeys).toHaveLength(2);
    });
});
