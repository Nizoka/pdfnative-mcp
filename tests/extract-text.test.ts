/**
 * Tests for `extract_text` — Unicode extraction backed by pdfnative v1.6.0's
 * `extractText()` (real /ToUnicode decoding, positioned runs, encrypted input).
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { extractText } from '../src/tools/extract-text.js';
import { ensureCompressionReady } from '../src/server.js';
import { makeEncryptedPdfBase64 } from './_encrypted-fixtures.js';

beforeAll(async () => {
    delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
    await ensureCompressionReady();
});

async function makeSimplePdf(): Promise<string> {
    const r = await generateBasicPdf({
        title: 'Extraction sample',
        blocks: [
            { type: 'heading', text: 'Hello World', level: 1 },
            { type: 'paragraph', text: 'Lorem ipsum dolor sit amet.' },
            { type: 'pageBreak' },
            { type: 'paragraph', text: 'Second page here.' },
        ],
    });
    return r.base64!;
}

describe('extract_text', () => {
    it('extracts real Unicode text from a generate_basic_pdf output', async () => {
        const pdf = await makeSimplePdf();
        const out = await extractText({ pdfBase64: pdf });
        expect(out.pageCount).toBe(2);
        expect(out.extractedPageCount).toBe(2);
        expect(out.pages.length).toBe(2);
        expect(out.extractable).toBe(true);
        // /ToUnicode decoding yields the actual words, not glyph indices.
        expect(out.fullText).toContain('Hello World');
        expect(out.fullText).toContain('Lorem ipsum');
    });

    it('reports the true document page count even with a pages[] filter', async () => {
        const pdf = await makeSimplePdf();
        const out = await extractText({ pdfBase64: pdf, pages: [0] });
        expect(out.pageCount).toBe(2); // total pages, not the subset size
        expect(out.extractedPageCount).toBe(1);
        expect(out.pages[0]!.index).toBe(0);
    });

    it('returns positioned runs when includeRuns is true', async () => {
        const pdf = await makeSimplePdf();
        const out = await extractText({ pdfBase64: pdf, includeRuns: true, pages: [0] });
        const runs = out.pages[0]!.runs;
        expect(runs).toBeDefined();
        expect(runs!.length).toBeGreaterThan(0);
        const first = runs![0]!;
        expect(typeof first.text).toBe('string');
        expect(typeof first.x).toBe('number');
        expect(typeof first.y).toBe('number');
        expect(typeof first.fontSize).toBe('number');
        expect(typeof first.fontName).toBe('string');
    });

    it('omits runs by default', async () => {
        const pdf = await makeSimplePdf();
        const out = await extractText({ pdfBase64: pdf });
        expect(out.pages[0]!.runs).toBeUndefined();
    });

    it('extracts from an encrypted PDF with the password', async () => {
        const enc = makeEncryptedPdfBase64({ userPassword: 'open-me', text: 'Encrypted body text.' });
        const out = await extractText({ pdfBase64: enc, password: 'open-me' });
        expect(out.extractable).toBe(true);
        expect(out.fullText).toContain('Encrypted body text');
    });

    it('rejects an encrypted PDF without a password (PASSWORD_REQUIRED)', async () => {
        const enc = makeEncryptedPdfBase64({ userPassword: 'open-me' });
        await expect(extractText({ pdfBase64: enc })).rejects.toMatchObject({ code: 'PASSWORD_REQUIRED' });
    });

    it('rejects an encrypted PDF with the wrong password (PASSWORD_INVALID)', async () => {
        const enc = makeEncryptedPdfBase64({ userPassword: 'open-me' });
        await expect(extractText({ pdfBase64: enc, password: 'nope' })).rejects.toMatchObject({ code: 'PASSWORD_INVALID' });
    });

    it('rejects an out-of-range page index with VALIDATION_ERROR', async () => {
        const pdf = await makeSimplePdf();
        await expect(extractText({ pdfBase64: pdf, pages: [999] })).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
        });
    });

    it('rejects malformed input', async () => {
        await expect(extractText({})).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(extractText({ pdfBase64: 'xx' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects junk PDF bytes with PDF_PARSE_FAILED', async () => {
        const junk = Buffer.from('not a pdf at all').toString('base64');
        await expect(extractText({ pdfBase64: junk })).rejects.toMatchObject({
            code: 'PDF_PARSE_FAILED',
        });
    });
});
