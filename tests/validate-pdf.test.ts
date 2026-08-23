import { describe, it, expect, beforeAll } from 'vitest';
import { validatePdf, type ValidatePdfResult } from '../src/tools/validate-pdf.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { ensureCompressionReady } from '../src/server.js';
import { ToolError } from '../src/errors.js';

beforeAll(async () => {
    delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
    await ensureCompressionReady();
});

async function buildPdf(pdfA?: 'pdfa2u'): Promise<string> {
    const r = await generateBasicPdf({
        title: 'Accessible doc',
        blocks: [
            { type: 'heading', text: 'Heading', level: 1 },
            { type: 'paragraph', text: 'A tagged, accessible paragraph.' },
        ],
        ...(pdfA !== undefined ? { pdfA } : {}),
    });
    if (r.mode !== 'base64' || r.base64 === undefined) throw new Error('expected base64');
    return r.base64;
}

describe('validate_pdf', () => {
    it('reports valid PDF/UA structure for a tagged PDF/A-2u document', async () => {
        const pdfBase64 = await buildPdf('pdfa2u');
        const out = (await validatePdf({ pdfBase64 })) as ValidatePdfResult;
        expect(out.standard).toBe('pdf-ua-1');
        expect(out.valid).toBe(true);
        expect(out.errors).toEqual([]);
        expect(Array.isArray(out.warnings)).toBe(true);
        expect(out.summary).toContain('PDF/UA');
    });

    it('reports blocking errors for an untagged PDF', async () => {
        const pdfBase64 = await buildPdf(); // no pdfA → not tagged
        const out = (await validatePdf({ pdfBase64 })) as ValidatePdfResult;
        expect(out.valid).toBe(false);
        expect(out.errors.length).toBeGreaterThan(0);
        expect(out.summary).toContain('failed');
    });

    it('rejects missing pdfBase64 at the schema boundary', async () => {
        await expect(validatePdf({})).rejects.toThrow(ToolError);
    });

    it('rejects an empty decoded buffer', async () => {
        await expect(validatePdf({ pdfBase64: '====' })).rejects.toThrow(ToolError);
    });

    it('raises PDF_PARSE_FAILED for unparsable input (consistent with every other read tool)', async () => {
        const notAPdf = Buffer.from('this is not a pdf at all').toString('base64');
        await expect(validatePdf({ pdfBase64: notAPdf })).rejects.toMatchObject({ code: 'PDF_PARSE_FAILED', message: expect.stringContaining('Unparseable PDF') });
    });
});
