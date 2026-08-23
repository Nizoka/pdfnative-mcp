import { describe, it, expect, beforeAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { ensureCompressionReady } from '../src/server.js';
import { updateMetadata } from '../src/tools/update-metadata.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { inspectPdf } from '../src/tools/inspect-pdf.js';
import { ToolError } from '../src/errors.js';
import { assertValidPdf } from './_pdf-assert.js';
import { makeEncryptedPdfBase64 } from './_encrypted-fixtures.js';

async function sample(pdfA?: 'pdfa2b'): Promise<string> {
    const r = await generateBasicPdf({ title: 'Original title', blocks: [{ type: 'paragraph', text: 'hello' }], ...(pdfA !== undefined ? { pdfA } : {}) });
    return r.base64!;
}

function text(b64: string): string {
    return Buffer.from(b64, 'base64').toString('latin1');
}

describe('update_metadata', () => {
    beforeAll(async () => {
        await ensureCompressionReady();
    });

    it('rewrites /Info as an incremental update and keeps the original revision intact', async () => {
        const src = await sample();
        const out = await updateMetadata({ pdfBase64: src, title: 'New title', author: 'Ada', subject: 'Sub', keywords: 'a, b', modDate: '2026-01-02T03:04:05Z' });
        expect(out.mode).toBe('base64');
        assertValidPdf(Buffer.from(out.base64!, 'base64'));
        // Incremental: the original bytes are a verbatim prefix.
        expect(out.base64!.startsWith(src.slice(0, src.length - 8))).toBe(true);
        const t = text(out.base64!);
        expect(t).toContain('/Title (New title)');
        expect(t).toContain('/Author (Ada)');
        expect(t).toContain('/Subject (Sub)');
        expect(t).toContain('/Keywords (a, b)');
        expect(t).toMatch(/\/ModDate \(D:2026010[12]\d{6}/); // engine writes local time
        const info = await inspectPdf({ pdfBase64: out.base64 });
        expect((info.info as Record<string, unknown>)['Title']).toBe('New title');
    });

    it('is deterministic for a fixed modDate and keeps XMP in sync on PDF/A documents', async () => {
        const src = await sample('pdfa2b');
        const a = await updateMetadata({ pdfBase64: src, author: 'Ada', modDate: '2026-01-02T03:04:05Z' });
        const b = await updateMetadata({ pdfBase64: src, author: 'Ada', modDate: '2026-01-02T03:04:05Z' });
        expect(a.base64).toBe(b.base64);
        const t = text(a.base64!);
        expect(t).toMatch(/dc:creator[\s\S]*Ada/);
    });

    it('rejects inputs with nothing to update, bad base64 and non-PDF bytes', async () => {
        const src = await sample();
        await expect(updateMetadata({ pdfBase64: src })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(updateMetadata({ pdfBase64: 'AQID', title: 'x' })).rejects.toMatchObject({ code: 'PDF_PARSE_FAILED' });
        await expect(updateMetadata({ pdfBase64: src, title: 'x', modDate: 'yesterday' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('refuses encrypted sources with ENCRYPTED_SOURCE', async () => {
        const enc = await makeEncryptedPdfBase64({ userPassword: 'u', ownerPassword: 'o' });
        const err = await updateMetadata({ pdfBase64: enc, title: 'x' }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ToolError);
        expect((err as ToolError).code).toBe('ENCRYPTED_SOURCE');
    });

    it('writes to the sandbox in file mode', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-meta-'));
        process.env['PDFNATIVE_MCP_OUTPUT_DIR'] = dir;
        try {
            const out = await updateMetadata({ pdfBase64: await sample(), title: 'F', outputMode: 'file', outputPath: 'meta/out.pdf' });
            expect(out.mode).toBe('file');
            expect(out.filePath?.startsWith(dir)).toBe(true);
            assertValidPdf(await fs.readFile(out.filePath!));
        } finally {
            delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
        }
    });
});
