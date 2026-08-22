/**
 * Tests for `encrypt_pdf` (pdfnative v1.6.0 page-tree re-encryption).
 */
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { encryptPdf } from '../src/tools/encrypt-pdf.js';
import { decryptPdf } from '../src/tools/decrypt-pdf.js';
import { inspectPdf } from '../src/tools/inspect-pdf.js';
import { createServer, ensureCompressionReady } from '../src/server.js';
import { assertValidPdf } from './_pdf-assert.js';
import { makePdfBase64 } from './_pagetree-fixtures.js';
import { connectLegacy } from './_mcp-harness.js';
import { makeEncryptedPdfBase64 } from './_encrypted-fixtures.js';

const ENV_KEY = 'PDFNATIVE_MCP_OUTPUT_DIR';

describe('encrypt_pdf', () => {
    beforeAll(async () => {
        delete process.env[ENV_KEY];
        await ensureCompressionReady();
    });
    afterEach(() => {
        delete process.env[ENV_KEY];
    });

    it('encrypts a plain PDF with AES-256 (verifiable via inspect_pdf)', async () => {
        const src = await makePdfBase64(2, 'Doc');
        const out = await encryptPdf({ pdfBase64: src, ownerPassword: 'owner', userPassword: 'user', algorithm: 'aes256' });
        expect(out.mode).toBe('base64');
        const insp = await inspectPdf({ pdfBase64: out.base64!, password: 'user' });
        expect(insp.encryption).toBe('aes-256');
        expect(insp.encryptionInfo?.algorithm).toBe('aes256');
        expect(insp.pageCount).toBe(2);
    });

    it('defaults to AES-128 when no algorithm is given', async () => {
        const src = await makePdfBase64(1, 'Doc');
        const out = await encryptPdf({ pdfBase64: src, ownerPassword: 'owner' });
        const insp = await inspectPdf({ pdfBase64: out.base64! });
        expect(insp.encryption).toBe('aes-128');
    });

    it('rotates the password of an already-encrypted source', async () => {
        const enc = makeEncryptedPdfBase64({ userPassword: 'old-pass', ownerPassword: 'old-owner' });
        const rotated = await encryptPdf({ pdfBase64: enc, password: 'old-pass', ownerPassword: 'new-owner', userPassword: 'new-pass' });
        // Old password no longer opens; new one does.
        await expect(inspectPdf({ pdfBase64: rotated.base64!, password: 'old-pass' })).rejects.toMatchObject({ code: 'PASSWORD_INVALID' });
        const insp = await inspectPdf({ pdfBase64: rotated.base64!, password: 'new-pass' });
        expect(insp.encryption).not.toBe('none');
    });

    it('completes an encrypt → decrypt round-trip', async () => {
        const src = await makePdfBase64(3, 'Doc');
        const enc = await encryptPdf({ pdfBase64: src, ownerPassword: 'owner', userPassword: 'user' });
        const dec = await decryptPdf({ pdfBase64: enc.base64!, password: 'user' });
        const insp = await inspectPdf({ pdfBase64: dec.base64! });
        expect(insp.encryption).toBe('none');
        expect(insp.pageCount).toBe(3);
    });

    it('requires ownerPassword (VALIDATION_ERROR)', async () => {
        const src = await makePdfBase64(1, 'Doc');
        await expect(encryptPdf({ pdfBase64: src })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects junk PDF bytes with PDF_PARSE_FAILED', async () => {
        const junk = Buffer.from('not a pdf at all').toString('base64');
        await expect(encryptPdf({ pdfBase64: junk, ownerPassword: 'owner' })).rejects.toMatchObject({ code: 'PDF_PARSE_FAILED' });
    });

    it('rejects an empty decoded buffer with VALIDATION_ERROR', async () => {
        await expect(encryptPdf({ pdfBase64: '====', ownerPassword: 'owner' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('never caches encryption output through the server (AES randomises, so a cache hit would return identical bytes)', async () => {
        // Drive the real tools/call dispatch (where the cache lives). With the cache
        // enabled, a cached tool returns byte-identical output; AES uses fresh
        // IV/salt/ID per call, so identical bytes across two calls would prove a
        // (forbidden) cache hit for the encryption tools. Differing bytes prove the
        // NON_CACHEABLE_TOOLS exclusion holds.
        const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-enccache-'));
        process.env['PDFNATIVE_MCP_CACHE_DIR'] = cacheDir;
        try {
            const client = await connectLegacy(createServer());
            const src = await makePdfBase64(1, 'Doc');
            const args = { pdfBase64: src, ownerPassword: 'owner', userPassword: 'user' };
            const blobOf = (r: unknown): string => {
                const res = r as { content: Array<{ type: string; resource?: { blob?: string } }> };
                return res.content.find((c) => c.type === 'resource')?.resource?.blob ?? '';
            };
            const a = blobOf(await client.callTool('encrypt_pdf', args));
            const b = blobOf(await client.callTool('encrypt_pdf', args));
            await client.close();
            expect(a.length).toBeGreaterThan(0);
            expect(a).not.toBe(b);
        } finally {
            delete process.env['PDFNATIVE_MCP_CACHE_DIR'];
        }
    });

    it('writes to a sandboxed file when outputMode=file', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-encrypt-'));
        process.env[ENV_KEY] = dir;
        const src = await makePdfBase64(1, 'Doc');
        const out = await encryptPdf({ pdfBase64: src, ownerPassword: 'owner', outputMode: 'file', outputPath: 'secure.pdf' });
        expect(out.mode).toBe('file');
        const bytes = await fs.readFile(out.filePath as string);
        assertValidPdf(new Uint8Array(bytes), 1);
    });
});
