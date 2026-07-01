/**
 * Tests for the pdfnative v1.4 document features threaded into the generation
 * tools in v1.3.0: nested lists, document outline / bookmarks, page labels,
 * viewer preferences (generate_basic_pdf) and cell borders + vertical
 * alignment (add_table).
 *
 * These options are additive: when omitted, output is unchanged. The assertions
 * confirm valid PDFs and, where cheaply observable, the presence of the
 * corresponding catalog structures (/Outlines, /PageLabels, /ViewerPreferences).
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { addTable } from '../src/tools/add-table.js';
import { ensureCompressionReady } from '../src/server.js';
import { ToolError } from '../src/errors.js';
import { assertValidPdf } from './_pdf-assert.js';

const ENV_KEY = 'PDFNATIVE_MCP_OUTPUT_DIR';

function decodedText(base64: string): string {
    return Buffer.from(base64, 'base64').toString('latin1');
}

describe('v1.4 document features', () => {
    beforeAll(async () => {
        delete process.env[ENV_KEY];
        await ensureCompressionReady();
    });

    describe('generate_basic_pdf — nested lists', () => {
        it('renders a nested list (object items with sub-lists)', async () => {
            const result = await generateBasicPdf({
                title: 'Nested',
                blocks: [
                    {
                        type: 'list',
                        style: 'bullet',
                        items: [
                            'Top-level item',
                            { text: 'Parent', items: ['Child A', { text: 'Child B', items: ['Grandchild'] }] },
                        ],
                    },
                ],
            });
            assertValidPdf(result.base64 as string);
        });

        it('is unchanged for string-only lists (still valid)', async () => {
            const result = await generateBasicPdf({
                title: 'Flat',
                blocks: [{ type: 'list', style: 'numbered', items: ['One', 'Two', 'Three'] }],
            });
            assertValidPdf(result.base64 as string);
        });
    });

    describe('generate_basic_pdf — outline / bookmarks', () => {
        it("emits /Outlines for outline: 'auto'", async () => {
            const result = await generateBasicPdf({
                title: 'Outlined',
                blocks: [
                    { type: 'heading', text: 'Chapter 1', level: 1 },
                    { type: 'paragraph', text: 'Body' },
                    { type: 'pageBreak' },
                    { type: 'heading', text: 'Chapter 2', level: 1 },
                ],
                outline: 'auto',
            });
            const text = decodedText(result.base64 as string);
            expect(text).toContain('/Outlines');
        });

        it('emits /Outlines for an explicit bookmark tree', async () => {
            const result = await generateBasicPdf({
                title: 'Explicit outline',
                blocks: [
                    { type: 'heading', text: 'Intro', level: 1 },
                    { type: 'pageBreak' },
                    { type: 'heading', text: 'Details', level: 1 },
                ],
                outline: [
                    { title: 'Introduction', pageIndex: 0, bold: true },
                    { title: 'Details', pageIndex: 1, children: [{ title: 'Sub', pageIndex: 1 }] },
                ],
            });
            const text = decodedText(result.base64 as string);
            expect(text).toContain('/Outlines');
        });
    });

    describe('generate_basic_pdf — page labels', () => {
        it('emits /PageLabels for a roman + decimal scheme', async () => {
            const result = await generateBasicPdf({
                title: 'Labelled',
                blocks: [
                    { type: 'heading', text: 'Front matter', level: 1 },
                    { type: 'pageBreak' },
                    { type: 'heading', text: 'Body', level: 1 },
                ],
                pageLabels: [
                    { startPage: 0, style: 'roman' },
                    { startPage: 1, style: 'decimal', start: 1 },
                ],
            });
            const text = decodedText(result.base64 as string);
            expect(text).toContain('/PageLabels');
        });
    });

    describe('generate_basic_pdf — viewer preferences', () => {
        it('emits /ViewerPreferences', async () => {
            const result = await generateBasicPdf({
                title: 'Prefs',
                blocks: [{ type: 'paragraph', text: 'Body' }],
                viewerPreferences: { displayDocTitle: true, pageLayout: 'singlePage', direction: 'l2r' },
            });
            const text = decodedText(result.base64 as string);
            expect(text).toContain('/ViewerPreferences');
        });
    });

    describe('add_table — cell borders + vertical alignment', () => {
        it('produces a valid PDF with cellBorders and cellVAlign (document backend)', async () => {
            const result = await addTable({
                title: 'Bordered',
                headers: ['A', 'B'],
                rows: [['1', '2'], ['3', '4']],
                cellBorders: { all: true, color: '0.8 0.8 0.8', width: 0.5, style: 'solid' },
                cellVAlign: 'middle',
            });
            assertValidPdf(result.base64 as string);
        });

        it('accepts viewerPreferences and stays valid', async () => {
            const result = await addTable({
                title: 'Prefs table',
                headers: ['A'],
                rows: [['1']],
                viewerPreferences: { pageLayout: 'oneColumn' },
            });
            assertValidPdf(result.base64 as string);
        });
    });

    describe('validation', () => {
        it('rejects an outline node missing pageIndex', async () => {
            await expect(
                generateBasicPdf({
                    title: 'Bad',
                    blocks: [{ type: 'paragraph', text: 'x' }],
                    outline: [{ title: 'No page' } as unknown as { title: string; pageIndex: number }],
                }),
            ).rejects.toThrow(ToolError);
        });
    });

    describe('mapper coverage — rich optional fields', () => {
        it('threads every optional outline / page-label / viewer-preference field', async () => {
            const result = await generateBasicPdf({
                title: 'Rich',
                blocks: [
                    { type: 'heading', text: 'A', level: 1 },
                    { type: 'pageBreak' },
                    { type: 'heading', text: 'B', level: 1 },
                ],
                outline: [
                    {
                        title: 'Styled',
                        pageIndex: 0,
                        y: 700,
                        bold: true,
                        italic: true,
                        color: '#1a73e8',
                        open: false,
                        children: [{ title: 'Child', pageIndex: 1, italic: true }],
                    },
                ],
                pageLabels: [
                    { startPage: 0, style: 'Alpha', prefix: 'A-', start: 2 },
                    { startPage: 1, style: 'none', prefix: 'Appendix-' },
                ],
                viewerPreferences: {
                    pageLayout: 'twoColumnLeft',
                    pageMode: 'useOutlines',
                    hideToolbar: true,
                    hideMenubar: true,
                    hideWindowUI: false,
                    fitWindow: true,
                    centerWindow: true,
                    displayDocTitle: true,
                    nonFullScreenPageMode: 'useThumbs',
                    direction: 'r2l',
                    printScaling: 'none',
                },
            });
            const text = decodedText(result.base64 as string);
            expect(text).toContain('/Outlines');
            expect(text).toContain('/PageLabels');
            expect(text).toContain('/ViewerPreferences');
        });

        it('threads every per-side cell border option in add_table', async () => {
            const result = await addTable({
                title: 'Sides',
                headers: ['A', 'B'],
                rows: [['1', '2']],
                cellBorders: { top: true, right: true, bottom: true, left: true, color: '#000000', width: 1, style: 'dashed' },
                cellVAlign: 'bottom',
            });
            assertValidPdf(result.base64 as string);
        });
    });
});
