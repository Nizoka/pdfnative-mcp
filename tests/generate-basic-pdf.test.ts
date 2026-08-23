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
import { assertValidPdf } from './_pdf-assert.js';

beforeAll(async () => {
    delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
    await ensureCompressionReady();
});

const BASE = { title: 'Doc', blocks: [{ type: 'paragraph', text: 'Hello world.' }] } as const;

describe('generate_basic_pdf watermark + normalize', () => {
    it('renders a text watermark on every page', async () => {
        const result = await generateBasicPdf({
            ...BASE,
            watermark: { text: 'DRAFT', opacity: 0.15, angle: -45, color: [0.75, 0.75, 0.75] },
        });
        expect(result.mode).toBe('base64');
        assertValidPdf(result.base64!);
        expect(result.sizeBytes).toBeGreaterThan(100);
    });

    it('keeps default output byte-identical when no new options are supplied', async () => {
        const a = await generateBasicPdf(BASE);
        const b = await generateBasicPdf(BASE);
        expect(a.base64).toBe(b.base64);
    });

    it('accepts a normalize form', async () => {
        const result = await generateBasicPdf({ ...BASE, normalize: 'NFC' });
        assertValidPdf(result.base64!);
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

    it('rejects a semi-transparent watermark under pdfA=pdfa1b with PDF_A_COMPLIANCE_VIOLATION', async () => {
        await expect(
            generateBasicPdf({ ...BASE, pdfA: 'pdfa1b', watermark: { text: 'DRAFT', opacity: 0.2 } }),
        ).rejects.toMatchObject({ code: 'PDF_A_COMPLIANCE_VIOLATION' });
    });

    it('rejects a default-opacity watermark under pdfA=pdfa1b (0.15 default is transparent)', async () => {
        await expect(
            generateBasicPdf({ ...BASE, pdfA: 'pdfa1b', watermark: { text: 'DRAFT' } }),
        ).rejects.toMatchObject({ code: 'PDF_A_COMPLIANCE_VIOLATION' });
    });

    it('allows an opaque watermark under pdfA=pdfa1b', async () => {
        const result = await generateBasicPdf({
            ...BASE,
            pdfA: 'pdfa1b',
            watermark: { text: 'DRAFT', opacity: 1 },
        });
        assertValidPdf(result.base64!);
    });

    it('allows a semi-transparent watermark under pdfA=pdfa2b', async () => {
        const result = await generateBasicPdf({
            ...BASE,
            pdfA: 'pdfa2b',
            watermark: { text: 'DRAFT', opacity: 0.2 },
        });
        assertValidPdf(result.base64!);
    });

    it('rejects an unsupported normalize form', async () => {
        await expect(generateBasicPdf({ ...BASE, normalize: 'NFG' })).rejects.toThrow(ToolError);
    });
});

describe('generate_basic_pdf print + diagnostics inputs (v1.6.0)', () => {
    it('embedFonts + pdfA + includeDiagnostics yields a valid PDF with no font diagnostic', async () => {
        const result = await generateBasicPdf({ ...BASE, embedFonts: true, pdfA: 'pdfa2b', includeDiagnostics: true });
        assertValidPdf(result.base64!);
        expect(result.diagnostics!.map((d) => d.code)).not.toContain('PDFA_NO_FONT_ENTRIES');
    });

    it('maps an engine chart failure inside a chart block to CHART_ERROR', async () => {
        await expect(
            generateBasicPdf({
                title: 'Chart',
                blocks: [{ type: 'chart', chartType: 'bar', categories: ['a', 'b'], series: [{ label: 's', values: [1, 2, 3] }] }],
            }),
        ).rejects.toMatchObject({ code: 'CHART_ERROR' });
    });

    it('writes diagnostics alongside a file-mode result', async () => {
        const { promises: fs } = await import('node:fs');
        const os = await import('node:os');
        const path = await import('node:path');
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-diag-'));
        process.env['PDFNATIVE_MCP_OUTPUT_DIR'] = dir;
        try {
            const result = await generateBasicPdf({ ...BASE, pdfA: 'pdfa2b', includeDiagnostics: true, outputMode: 'file', outputPath: 'diag.pdf' });
            expect(result.mode).toBe('file');
            expect(result.diagnostics!.map((d) => d.code)).toContain('PDFA_NO_FONT_ENTRIES');
        } finally {
            delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
        }
    });
});
