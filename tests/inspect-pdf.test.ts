import { describe, it, expect, beforeAll } from 'vitest';
import { inspectPdf } from '../src/tools/inspect-pdf.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { prepareSignaturePlaceholder } from '../src/tools/prepare-signature-placeholder.js';
import { ensureCompressionReady } from '../src/server.js';
import { ToolError } from '../src/errors.js';

beforeAll(async () => {
    delete process.env['PDFNATIVE_MPC_OUTPUT_DIR'];
    await ensureCompressionReady();
});

async function buildSamplePdf(): Promise<string> {
    const r = await generateBasicPdf({
        title: 'Sample',
        blocks: [{ type: 'paragraph', text: 'Hello world.' }],
    });
    if (r.mode !== 'base64' || r.base64 === undefined) throw new Error('expected base64 result');
    return r.base64;
}

describe('inspect_pdf', () => {
    it('reports basic structural metadata for a generated PDF', async () => {
        const pdfBase64 = await buildSamplePdf();
        const out = await inspectPdf({ pdfBase64 });
        expect(out.pageCount).toBeGreaterThanOrEqual(1);
        expect(out.encryption).toBe('none');
        expect(out.signatureCount).toBe(0);
        expect(typeof out.version).toBe('string');
        expect(out.version.startsWith('1.') || out.version.startsWith('2.')).toBe(true);
    });

    it('returns per-page sizes when pages=true', async () => {
        const pdfBase64 = await buildSamplePdf();
        const out = await inspectPdf({ pdfBase64, pages: true });
        expect(Array.isArray(out.perPage)).toBe(true);
        expect(out.perPage!.length).toBe(out.pageCount);
        expect(out.perPage![0].width).toBeGreaterThan(0);
        expect(out.perPage![0].height).toBeGreaterThan(0);
    });

    it('counts signature placeholder fields', async () => {
        const placeholder = await prepareSignaturePlaceholder({
            title: 'Needs sig',
            signerName: 'Alice',
        });
        if (placeholder.mode !== 'base64' || placeholder.base64 === undefined) throw new Error('expected base64');
        const out = await inspectPdf({ pdfBase64: placeholder.base64 });
        expect(out.signatureCount).toBe(1);
    });

    it('evaluates check assertions and returns checksPassed flag', async () => {
        const pdfBase64 = await buildSamplePdf();
        const out = await inspectPdf({ pdfBase64, check: ['encrypted', 'signed'] });
        // Generated PDF is neither encrypted nor signed → both checks fail → checksPassed false
        expect(out.checksPassed).toBe(false);
        expect(out.checks?.encrypted).toBe(false);
        expect(out.checks?.signed).toBe(false);
    });

    it('rejects invalid base64', async () => {
        await expect(inspectPdf({ pdfBase64: '!!!!' })).rejects.toBeInstanceOf(ToolError);
    });

    it('rejects non-PDF input', async () => {
        const garbage = Buffer.from('not a pdf at all').toString('base64');
        await expect(inspectPdf({ pdfBase64: garbage })).rejects.toBeInstanceOf(ToolError);
    });

    it('detects PDF/A claim from XMP metadata', async () => {
        const r = await generateBasicPdf({
            title: 'PDF/A Sample',
            blocks: [{ type: 'paragraph', text: 'Archival document.' }],
            pdfA: 'pdfa2b',
        });
        if (r.mode !== 'base64' || r.base64 === undefined) throw new Error('expected base64');
        const out = await inspectPdf({ pdfBase64: r.base64 });
        expect(out.pdfA).not.toBeNull();
        expect(typeof out.pdfA).toBe('string');
    });

    it('reports checksPassed=true when assertions match', async () => {
        const placeholder = await prepareSignaturePlaceholder({ title: 'Sig', signerName: 'Bob' });
        if (placeholder.mode !== 'base64' || placeholder.base64 === undefined) throw new Error('expected base64');
        const out = await inspectPdf({ pdfBase64: placeholder.base64, check: ['signed'] });
        expect(out.checks?.signed).toBe(true);
        expect(out.checksPassed).toBe(true);
    });

    it('extracts version from PDF header', async () => {
        const pdfBase64 = await buildSamplePdf();
        const out = await inspectPdf({ pdfBase64 });
        expect(out.version).toMatch(/^\d+\.\d+$/);
    });

    it('returns info dict as plain object', async () => {
        const pdfBase64 = await buildSamplePdf();
        const out = await inspectPdf({ pdfBase64 });
        expect(typeof out.info).toBe('object');
    });

    it('evaluates pdfa check as true on a PDF/A document', async () => {
        const r = await generateBasicPdf({
            title: 'Archival',
            blocks: [{ type: 'paragraph', text: 'test' }],
            pdfA: 'pdfa2b',
        });
        if (r.mode !== 'base64' || r.base64 === undefined) throw new Error('no base64');
        const out = await inspectPdf({ pdfBase64: r.base64, check: ['pdfa'] });
        expect(out.checks?.pdfa).toBe(true);
        expect(out.checksPassed).toBe(true);
    });

    it('evaluates all three check assertions at once on an unsigned plain PDF', async () => {
        const pdfBase64 = await buildSamplePdf();
        const out = await inspectPdf({ pdfBase64, check: ['pdfa', 'signed', 'encrypted'] });
        expect(out.checks?.pdfa).toBe(false);
        expect(out.checks?.signed).toBe(false);
        expect(out.checks?.encrypted).toBe(false);
        expect(out.checksPassed).toBe(false);
    });
});
