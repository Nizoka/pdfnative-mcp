/**
 * pdfnative-mcp — PDF/A validation corpus generator
 * ==================================================
 * Drives the built MCP tool handlers (`dist/server.js`) to produce a small,
 * deterministic corpus of PDF/A-claiming documents under `test-output/pdfa/`,
 * one per PDF/A-relevant feature the server exposes. `scripts/validate-pdfa.mjs`
 * then runs every file through the veraPDF reference validator.
 *
 * Usage:  npm run build && npm run corpus:pdfa
 *         node scripts/generate-pdfa-corpus.mjs
 * Exit:   0 when every file was written, 1 when any tool call returned an error
 *         (the tool's error message is printed), 2 when dist/ is missing.
 *
 * Dependency-free: imports only the compiled server module and node built-ins.
 * Text-rendering tools pass `embedFonts: true` (pdfnative-mcp 1.6.0) so base-14
 * Helvetica text does not void the PDF/A claim; `add_international_text`
 * always embeds its Noto fonts and has no such flag.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'test-output', 'pdfa');
const SERVER_MODULE = join(ROOT, 'dist', 'server.js');

if (!existsSync(SERVER_MODULE)) {
    process.stderr.write('dist/server.js not found — run `npm run build` first.\n');
    process.exit(2);
}

const { callToolDirect, ensureCompressionReady } = await import(pathToFileURL(SERVER_MODULE).href);

/** Minimal valid 1×1 JPEG (same bytes as tests/embed-image.test.ts). */
const MINIMAL_JPEG_BASE64 =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAARC' +
    'AABAAEDASIA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/a' +
    'AAwDAQACEQMRAD8AJQAB/9k=';

const ATTACHMENT_XML_BASE64 = Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>\n<invoice id="INV-0001"><total currency="EUR">123.45</total></invoice>\n',
    'utf8',
).toString('base64');

const EMBED = { embedFonts: true };

/**
 * Call a tool and return the PDF bytes (base64) from the embedded resource
 * content block. Throws with the tool's error text when `isError` is set.
 */
async function producePdf(name, args) {
    const result = await callToolDirect(name, args);
    if (result.isError === true) {
        const text = result.content?.[0]?.type === 'text' ? result.content[0].text : 'unknown error';
        throw new Error(`${name}: ${text}`);
    }
    const block = (result.content ?? []).find((c) => c.type === 'resource' && typeof c.resource?.blob === 'string');
    if (block === undefined || block.resource.blob.length === 0) {
        throw new Error(`${name}: no embedded PDF resource in the tool result.`);
    }
    return block.resource.blob;
}

const PARAGRAPHS = [
    'pdfnative-mcp renders this corpus through the same tool handlers an MCP client would call.',
    'Each file claims a PDF/A conformance level in its XMP packet and is validated by veraPDF.',
];

/**
 * Corpus definition: `file` is the output name, `produce` returns base64 PDF
 * bytes. Composite entries (merge / extract) reuse earlier outputs via `ctx`.
 *
 * `expectPdfAClaim: false` marks outputs of the page-tree tools (merge_pdfs,
 * extract_pages): pdfnative rebuilds the page tree and does not carry the
 * source XMP packet across, so the result no longer claims PDF/A. They stay in
 * the corpus so the validator's coverage canary asserts that fact in both
 * directions (a claim appearing or disappearing is a behaviour change).
 */
const CORPUS = [
    {
        file: 'basic-pdfa1b.pdf',
        tool: 'generate_basic_pdf',
        produce: () =>
            producePdf('generate_basic_pdf', {
                title: 'Corpus — PDF/A-1b plain',
                pdfA: 'pdfa1b',
                blocks: [
                    { type: 'heading', text: 'PDF/A-1b', level: 1 },
                    { type: 'paragraph', text: PARAGRAPHS[0] },
                ],
                ...EMBED,
            }),
    },
    {
        file: 'basic-pdfa2b-outline-labels-list.pdf',
        tool: 'generate_basic_pdf',
        produce: () =>
            producePdf('generate_basic_pdf', {
                title: 'Corpus — PDF/A-2b outline, page labels, nested list',
                pdfA: 'pdfa2b',
                outline: 'auto',
                pageLabels: [
                    { startPage: 0, style: 'roman' },
                    { startPage: 1, style: 'decimal', prefix: 'A-' },
                ],
                blocks: [
                    { type: 'heading', text: 'Front matter', level: 1 },
                    { type: 'paragraph', text: PARAGRAPHS[0] },
                    { type: 'pageBreak' },
                    { type: 'heading', text: 'Body', level: 1 },
                    {
                        type: 'list',
                        style: 'numbered',
                        items: [
                            'First item',
                            { text: 'Second item with children', items: ['Child A', { text: 'Child B', items: ['Grandchild'] }] },
                            'Third item',
                        ],
                    },
                ],
                ...EMBED,
            }),
    },
    {
        file: 'basic-pdfa2u-text.pdf',
        tool: 'generate_basic_pdf',
        produce: () =>
            producePdf('generate_basic_pdf', {
                title: 'Corpus — PDF/A-2u headings and paragraphs',
                pdfA: 'pdfa2u',
                blocks: [
                    { type: 'heading', text: 'Unicode-mapped text', level: 1 },
                    { type: 'paragraph', text: PARAGRAPHS[0] },
                    { type: 'heading', text: 'Second section', level: 2 },
                    { type: 'paragraph', text: PARAGRAPHS[1] },
                ],
                ...EMBED,
            }),
    },
    {
        file: 'basic-pdfa2b-watermark.pdf',
        tool: 'generate_basic_pdf',
        produce: () =>
            producePdf('generate_basic_pdf', {
                title: 'Corpus — PDF/A-2b watermark',
                pdfA: 'pdfa2b',
                watermark: { text: 'DRAFT', opacity: 1 },
                blocks: [
                    { type: 'heading', text: 'Watermarked', level: 1 },
                    { type: 'paragraph', text: PARAGRAPHS[1] },
                ],
                ...EMBED,
            }),
    },
    {
        file: 'basic-pdfa2b-chart-bar.pdf',
        tool: 'generate_basic_pdf',
        produce: () =>
            producePdf('generate_basic_pdf', {
                title: 'Corpus — PDF/A-2b bar chart block',
                pdfA: 'pdfa2b',
                blocks: [
                    { type: 'heading', text: 'Quarterly revenue', level: 1 },
                    {
                        type: 'chart',
                        chartType: 'bar',
                        title: 'Revenue by quarter',
                        categories: ['Q1', 'Q2', 'Q3', 'Q4'],
                        series: [
                            { label: '2024', values: [12, 15, 14, 18] },
                            { label: '2025', values: [14, 17, 16, 21] },
                        ],
                        axis: { grid: true },
                    },
                ],
                ...EMBED,
            }),
    },
    {
        file: 'basic-pdfa2b-chart-stackedbar.pdf',
        tool: 'generate_basic_pdf',
        produce: () =>
            producePdf('generate_basic_pdf', {
                title: 'Corpus — PDF/A-2b stacked bar chart block',
                pdfA: 'pdfa2b',
                blocks: [
                    { type: 'paragraph', text: 'Stacked bars with data labels.' },
                    {
                        type: 'chart',
                        chartType: 'stackedBar',
                        categories: ['North', 'South', 'East'],
                        series: [
                            { label: 'Hardware', values: [4, 6, 5] },
                            { label: 'Services', values: [3, 2, 6] },
                        ],
                        dataLabels: true,
                        legend: 'bottom',
                    },
                ],
                ...EMBED,
            }),
    },
    {
        file: 'basic-pdfa2b-print-metadata.pdf',
        tool: 'generate_basic_pdf',
        produce: () =>
            producePdf('generate_basic_pdf', {
                title: 'Corpus — PDF/A-2b bleed, printer marks, metadata',
                pdfA: 'pdfa2b',
                print: { bleed: 8.5, marks: true },
                metadata: { trapped: 'True', author: 'Corpus' },
                blocks: [
                    { type: 'heading', text: 'Print production', level: 1 },
                    { type: 'paragraph', text: PARAGRAPHS[0] },
                ],
                ...EMBED,
            }),
    },
    {
        file: 'table-pdfa2b.pdf',
        tool: 'add_table',
        produce: () =>
            producePdf('add_table', {
                title: 'Corpus — PDF/A-2b table',
                pdfA: 'pdfa2b',
                headers: ['Item', 'Qty', 'Price'],
                rows: [
                    ['Widget', '2', '9.99'],
                    ['Gadget', '1', '24.50'],
                    ['Gizmo', '5', '3.25'],
                ],
                zebra: true,
                ...EMBED,
            }),
    },
    {
        file: 'chart-pdfa2b-scatter.pdf',
        tool: 'add_chart',
        produce: () =>
            producePdf('add_chart', {
                title: 'Corpus — PDF/A-2b scatter chart',
                pdfA: 'pdfa2b',
                chartType: 'scatter',
                xAxis: { type: 'linear', grid: true },
                series: [
                    { label: 'Sample A', values: [1.2, 2.4, 3.1, 4.8], xValues: [1, 2, 3, 4] },
                    { label: 'Sample B', values: [0.8, 1.9, 3.5, 3.9], xValues: [1.5, 2.5, 3.5, 4.5] },
                ],
                ...EMBED,
            }),
    },
    {
        file: 'international-pdfa2u.pdf',
        tool: 'add_international_text',
        produce: () =>
            producePdf('add_international_text', {
                title: 'Corpus — PDF/A-2u Arabic and Latin',
                pdfA: 'pdfa2u',
                lang: ['ar', 'latin'],
                paragraphs: ['مرحبا بالعالم — hello from pdfnative-mcp.', 'Mixed-script paragraph: العربية and Latin.'],
            }),
    },
    {
        file: 'barcode-pdfa2b-qr.pdf',
        tool: 'add_barcode',
        produce: () =>
            producePdf('add_barcode', {
                title: 'Corpus — PDF/A-2b QR code',
                pdfA: 'pdfa2b',
                format: 'qr',
                data: 'https://github.com/Nizoka/pdfnative-mcp',
                caption: 'Scan to open the repository.',
                ...EMBED,
            }),
    },
    {
        file: 'image-pdfa2b-jpeg.pdf',
        tool: 'embed_image',
        produce: () =>
            producePdf('embed_image', {
                title: 'Corpus — PDF/A-2b embedded JPEG',
                pdfA: 'pdfa2b',
                imageBase64: MINIMAL_JPEG_BASE64,
                mimeType: 'image/jpeg',
                caption: 'A 1x1 JPEG.',
                width: 64,
                height: 64,
                ...EMBED,
            }),
    },
    {
        file: 'attachment-pdfa3b-xml.pdf',
        tool: 'add_attachment',
        produce: () =>
            producePdf('add_attachment', {
                title: 'Corpus — PDF/A-3b XML attachment',
                blocks: [
                    { type: 'heading', text: 'Invoice INV-0001', level: 1 },
                    { type: 'paragraph', text: 'Structured payload attached as factur-x.xml.' },
                ],
                attachments: [
                    {
                        filename: 'factur-x.xml',
                        mimeType: 'application/xml',
                        dataBase64: ATTACHMENT_XML_BASE64,
                        relationship: 'Source',
                        description: 'Structured invoice payload',
                    },
                ],
                ...EMBED,
            }),
    },
    {
        file: 'merge-pdfa2b.pdf',
        tool: 'merge_pdfs',
        expectPdfAClaim: false,
        produce: async (ctx) => {
            const second = await producePdf('generate_basic_pdf', {
                title: 'Corpus — merge source B',
                pdfA: 'pdfa2b',
                blocks: [{ type: 'paragraph', text: 'Second source document.' }],
                ...EMBED,
            });
            return producePdf('merge_pdfs', { pdfsBase64: [ctx.get('basic-pdfa2b-watermark.pdf'), second] });
        },
    },
    {
        file: 'extract-pages-pdfa2b.pdf',
        tool: 'extract_pages',
        expectPdfAClaim: false,
        produce: (ctx) =>
            producePdf('extract_pages', { pdfBase64: ctx.get('basic-pdfa2b-outline-labels-list.pdf'), pages: [1] }),
    },
];

async function main() {
    await ensureCompressionReady();
    mkdirSync(OUT_DIR, { recursive: true });

    const ctx = new Map();
    const manifest = [];
    let totalBytes = 0;

    for (const entry of CORPUS) {
        let base64;
        try {
            base64 = await entry.produce(ctx);
        } catch (err) {
            process.stderr.write(`FAIL  ${entry.file}\n      ${err instanceof Error ? err.message : String(err)}\n`);
            return 1;
        }
        ctx.set(entry.file, base64);
        const bytes = Buffer.from(base64, 'base64');
        writeFileSync(join(OUT_DIR, entry.file), bytes);
        totalBytes += bytes.byteLength;
        const expectPdfAClaim = entry.expectPdfAClaim !== false;
        manifest.push({ file: entry.file, tool: entry.tool, bytes: bytes.byteLength, expectPdfAClaim });
        process.stdout.write(
            `  wrote  ${entry.file.padEnd(44)} ${String(bytes.byteLength).padStart(8)} B  (${entry.tool}${expectPdfAClaim ? '' : ', no PDF/A claim expected'})\n`,
        );
    }

    writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify({ generatedBy: 'scripts/generate-pdfa-corpus.mjs', files: manifest }, null, 2)}\n`);
    process.stdout.write(`\nPDF/A corpus: ${manifest.length} file(s), ${totalBytes} bytes → test-output/pdfa/ (manifest.json written)\n`);
    return 0;
}

process.exit(await main());
