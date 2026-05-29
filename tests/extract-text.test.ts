/**
 * Tests for `extract_text` (best-effort plain-text extraction).
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { extractText, _extractPageTextForTesting } from '../src/tools/extract-text.js';
import { ensureCompressionReady } from '../src/server.js';

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
            { type: 'paragraph', text: 'Second paragraph here.' },
        ],
    });
    return r.base64!;
}

describe('extract_text', () => {
    it('extracts text from a generate_basic_pdf output', async () => {
        const pdf = await makeSimplePdf();
        const out = await extractText({ pdfBase64: pdf });
        expect(out.pageCount).toBeGreaterThan(0);
        expect(out.extractedPageCount).toBe(out.pageCount);
        expect(out.pages.length).toBe(out.pageCount);
        // pdfnative emits text via literal-string operators with standard fonts,
        // so at least *some* text must be recoverable.
        expect(out.fullText.length).toBeGreaterThan(0);
    });

    it('honours the pages[] filter', async () => {
        const pdf = await makeSimplePdf();
        const out = await extractText({ pdfBase64: pdf, pages: [0] });
        expect(out.extractedPageCount).toBe(1);
        expect(out.pages[0]!.index).toBe(0);
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

describe('extract_text content-stream tokenizer', () => {
    it('handles literal strings with the full escape table', () => {
        const stream = 'BT (a\\nb\\rc\\td\\be\\ff\\(g\\)h\\\\i\\101) Tj ET';
        const text = _extractPageTextForTesting(stream);
        expect(text).toContain('a');
        expect(text).toContain('\n');
        expect(text).toContain('A'); // octal \101
        expect(text).toContain('(');
        expect(text).toContain(')');
        expect(text).toContain('\\');
    });

    it('handles hex strings', () => {
        const stream = 'BT <48656C6C6F> Tj ET';
        expect(_extractPageTextForTesting(stream)).toBe('Hello');
    });

    it('handles hex strings with odd nibble count', () => {
        const stream = 'BT <414> Tj ET';
        // 414 -> 41,40 -> "A\0"; we just assert non-empty
        expect(_extractPageTextForTesting(stream).length).toBeGreaterThan(0);
    });

    it('handles nested parentheses inside literal strings', () => {
        const stream = 'BT (hello (world)) Tj ET';
        expect(_extractPageTextForTesting(stream)).toContain('hello (world)');
    });

    it('skips comments and dictionaries', () => {
        const stream = '% a comment\n<< /Foo 1 >> BT (text) Tj ET';
        expect(_extractPageTextForTesting(stream)).toContain('text');
    });

    it("treats ' and \" operators as soft separators", () => {
        const stream = "BT (line1) ' (line2) \" ET";
        const text = _extractPageTextForTesting(stream);
        expect(text).toContain('line1');
        expect(text).toContain('line2');
    });

    it('handles unknown escape by dropping the backslash', () => {
        const stream = 'BT (a\\zb) Tj ET';
        expect(_extractPageTextForTesting(stream)).toContain('azb');
    });

    it('returns empty string for empty content', () => {
        expect(_extractPageTextForTesting('')).toBe('');
    });

    it('survives unterminated hex string', () => {
        expect(_extractPageTextForTesting('BT <4865 Tj ET')).toBe('');
    });
});
