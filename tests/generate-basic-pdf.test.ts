/**
 * Tests for `generate_basic_pdf` watermark + normalize opt-in inputs (v1.2.0).
 *
 * The default path (no watermark, no normalize) must stay byte-identical to
 * pre-1.2.0 output, so these tests assert the new options are purely additive.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { ensureCompressionReady } from '../src/server.js';
import { ToolError } from '../src/errors.js';

beforeAll(async () => {
    delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
    await ensureCompressionReady();
});

const PDF_HEADER = '%PDF-';

function head(b64: string): string {
    return Buffer.from(b64, 'base64').toString('latin1').slice(0, 5);
}

const BASE = { title: 'Doc', blocks: [{ type: 'paragraph', text: 'Hello world.' }] } as const;

describe('generate_basic_pdf watermark + normalize', () => {
    it('renders a text watermark on every page', async () => {
        const result = await generateBasicPdf({
            ...BASE,
            watermark: { text: 'DRAFT', opacity: 0.15, angle: -45, color: [0.75, 0.75, 0.75] },
        });
        expect(result.mode).toBe('base64');
        expect(head(result.base64!)).toBe(PDF_HEADER);
        expect(result.sizeBytes).toBeGreaterThan(100);
    });

    it('keeps default output byte-identical when no new options are supplied', async () => {
        const a = await generateBasicPdf(BASE);
        const b = await generateBasicPdf(BASE);
        expect(a.base64).toBe(b.base64);
    });

    it('accepts a normalize form', async () => {
        const result = await generateBasicPdf({ ...BASE, normalize: 'NFC' });
        expect(head(result.base64!)).toBe(PDF_HEADER);
    });

    it('rejects an out-of-range watermark opacity', async () => {
        await expect(
            generateBasicPdf({ ...BASE, watermark: { text: 'X', opacity: 5 } }),
        ).rejects.toThrow(ToolError);
    });

    it('rejects a watermark color outside the 0..1 range', async () => {
        await expect(
            generateBasicPdf({ ...BASE, watermark: { text: 'X', color: [2, 0, 0] } }),
        ).rejects.toThrow(ToolError);
    });

    it('rejects an unsupported normalize form', async () => {
        await expect(generateBasicPdf({ ...BASE, normalize: 'NFG' })).rejects.toThrow(ToolError);
    });
});
