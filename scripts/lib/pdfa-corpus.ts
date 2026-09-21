/**
 * pdfnative-mcp — the conformance corpus (PDF/A + PDF/X)
 * ========================================================
 * One table drives scripts/generate-pdfa-corpus.ts and the `corpus/` family
 * of the sample generator; `derived.pdfaCorpus` in docs/assets/ecosystem.json
 * is its length, `declared.pdfaSamples` and `declared.pdfxSamples` the number
 * of claiming files per standard.
 *
 * Every entry names the tool that produces it (`tool` is the manifest
 * record, `produce` performs the call through the built server's
 * `tools/call` handler). Later entries may consume earlier outputs through
 * `ctx.get()` (sign, attach, merge, extract reuse earlier renders), so the
 * order matters and execution is sequential.
 *
 * Reproducibility: `ctx.produce()` pins `creationDate` / `signingTime` /
 * `modDate` to the instant in scripts/helpers/io.ts wherever the tool's live
 * input schema declares them, so the corpus bytes are stable across machines
 * and the manifest's sha256 column is diffable. The one exception is the
 * signed entry: its throwaway RSA key is generated per run and never written
 * to disk, so its bytes differ by design.
 *
 * Text-rendering tools pass `embedFonts: true` so base-14 Helvetica text
 * does not void the claim; `add_international_text` always embeds its Noto
 * fonts and has no such flag.
 *
 * Negative canaries (`expectCompliant: false`) claim conformance but are
 * KNOWN non-conformant — the validator must reject them, otherwise the
 * validator itself is broken ("accepts everything") and the run fails.
 */

import { join } from 'node:path';

import { TEST_OUTPUT_DIR } from '../helpers/io.js';
import { buildRsaSelfSignedCert } from './corpus-cert.js';
import { buildMinimalRgbIccProfile } from './synthetic-icc.js';

export const OUT_DIR = join(TEST_OUTPUT_DIR, 'pdfa');

export type Claim = 'pdfa' | 'pdfx' | 'none';

export interface CorpusContext {
    /** Base64 bytes of an earlier entry, by file name. Throws when it has not been produced yet. */
    readonly get: (file: string) => string;
    /** Call a tool on the built server with pinned instants; returns base64 PDF bytes. */
    readonly produce: (tool: string, args: Readonly<Record<string, unknown>>) => Promise<string>;
}

export interface CorpusEntry {
    readonly file: string;
    /** The MCP tool whose output the file is. */
    readonly tool: string;
    /** Which standard the output claims in its XMP. Default 'pdfa'. */
    readonly claims?: Claim;
    /** Older spelling of `claims: 'none'`, kept for the page-tree entries. */
    readonly expectPdfAClaim?: boolean;
    /** Default true; false marks a negative canary. Ignored when the file makes no claim. */
    readonly expectCompliant?: boolean;
    readonly produce: (ctx: CorpusContext) => Promise<string>;
}

/** The standard an entry claims, with `expectPdfAClaim: false` folded in. */
export function claimOf(entry: CorpusEntry): Claim {
    if (entry.claims !== undefined) return entry.claims;
    return entry.expectPdfAClaim === false ? 'none' : 'pdfa';
}

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

const PARAGRAPHS = [
    'pdfnative-mcp renders this corpus through the same tool handlers an MCP client would call.',
    'Each file claims a PDF/A conformance level in its XMP packet and is validated by veraPDF.',
] as const;

/** One AcroForm, rendered with and without embedded fonts (positive entry + negative canary). */
const PDFA_FORM = {
    title: 'Corpus — PDF/A-2b AcroForm',
    pdfA: 'pdfa2b',
    fields: [
        { fieldType: 'text', name: 'fullName', label: 'Full name', value: 'Ada Lovelace' },
        { fieldType: 'checkbox', name: 'agree', label: 'I agree', checked: true },
        { fieldType: 'dropdown', name: 'country', label: 'Country', options: ['FR', 'DE', 'UK'], value: 'FR' },
        { fieldType: 'radio', name: 'size', label: 'Size', options: ['S', 'M', 'L'] },
    ],
    footerText: 'Form fields under PDF/A-2b (appearance streams, no JavaScript).',
} as const;

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
export const CORPUS: readonly CorpusEntry[] = [
    {
        file: 'basic-pdfa1b.pdf',
        tool: 'generate_basic_pdf',
        produce: (ctx) =>
            ctx.produce('generate_basic_pdf', {
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
        produce: (ctx) =>
            ctx.produce('generate_basic_pdf', {
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
        produce: (ctx) =>
            ctx.produce('generate_basic_pdf', {
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
        produce: (ctx) =>
            ctx.produce('generate_basic_pdf', {
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
        produce: (ctx) =>
            ctx.produce('generate_basic_pdf', {
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
        produce: (ctx) =>
            ctx.produce('generate_basic_pdf', {
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
        produce: (ctx) =>
            ctx.produce('generate_basic_pdf', {
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
        produce: (ctx) =>
            ctx.produce('add_table', {
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
        produce: (ctx) =>
            ctx.produce('add_chart', {
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
        produce: (ctx) =>
            ctx.produce('add_international_text', {
                title: 'Corpus — PDF/A-2u Arabic and Latin',
                pdfA: 'pdfa2u',
                lang: ['ar', 'latin'],
                paragraphs: ['مرحبا بالعالم — hello from pdfnative-mcp.', 'Mixed-script paragraph: العربية and Latin.'],
            }),
    },
    {
        file: 'barcode-pdfa2b-qr.pdf',
        tool: 'add_barcode',
        produce: (ctx) =>
            ctx.produce('add_barcode', {
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
        produce: (ctx) =>
            ctx.produce('embed_image', {
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
        produce: (ctx) =>
            ctx.produce('add_attachment', {
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
        file: 'composite-blocks-pdfa2b.pdf',
        tool: 'generate_basic_pdf',
        // Every non-form block kind in one document: toc, table, link, barcode,
        // svg (paths + <text>), image (RGB JPEG) and chart. All pure vector or
        // RGB raster, so the PDF/A-2b claim must hold with embedded fonts.
        produce: (ctx) =>
            ctx.produce('generate_basic_pdf', {
                title: 'Corpus — composite blocks under PDF/A-2b',
                pdfA: 'pdfa2b',
                blocks: [
                    { type: 'toc', maxLevel: 2 },
                    { type: 'heading', text: 'Figures', level: 1 },
                    { type: 'paragraph', text: 'Tables, links, barcodes and drawings in one archival document.' },
                    { type: 'table', headers: ['Item', 'Qty'], rows: [['Widget', '2'], ['Gadget', '5']], zebra: true, caption: 'Stock', clipCells: true },
                    { type: 'link', text: 'Project home', url: 'https://github.com/Nizoka/pdfnative-mcp' },
                    { type: 'heading', text: 'Codes', level: 2 },
                    { type: 'barcode', format: 'qr', data: 'https://example.com', width: 120, align: 'center' },
                    { type: 'svg', data: '<svg viewBox="0 0 20 10"><rect x="1" y="1" width="18" height="8" fill="#1a73e8"/><text x="10" y="7" font-size="4" fill="#ffffff" text-anchor="middle">svg</text></svg>', width: 160, height: 80, alt: 'Blue box with the word svg' },
                    { type: 'chart', chartType: 'bar', series: [{ label: 'Units', values: [3, 5, 2] }], categories: ['A', 'B', 'C'] },
                ],
                ...EMBED,
            }),
    },
    {
        file: 'layout-letter-templates-compress-pdfa2b.pdf',
        tool: 'generate_basic_pdf',
        // Layout options under PDF/A-2b: Letter page, custom margins, running
        // header/footer templates and FlateDecode streams (compress). The XMP
        // packet must stay uncompressed for the claim to be discoverable.
        produce: (ctx) =>
            ctx.produce('generate_basic_pdf', {
                title: 'Corpus — Letter, templates, compressed streams',
                pdfA: 'pdfa2b',
                pageSize: 'Letter',
                margins: { top: 60, right: 48, bottom: 50, left: 48 },
                headerTemplate: { left: '{title}', right: 'Page {page} of {pages}' },
                footerTemplate: { center: 'Archival copy' },
                compress: true,
                blocks: Array.from({ length: 40 }, (_, i) => ({ type: 'paragraph', text: `Paragraph ${i + 1} of a two-page Letter document with running header and footer.` })),
                ...EMBED,
            }),
    },
    {
        file: 'form-pdfa2b.pdf',
        tool: 'add_form',
        // A negative canary until pdfnative 1.8.0: the AcroForm /DR
        // default-appearance font was an unembedded Type1 /Helv whatever
        // `embedFonts` said (ISO 19005-2 6.2.11.4.1). The engine now embeds the
        // registered Latin font in /DR, so an interactive form can be archival;
        // the run went XPASS on the bump and the flag was flipped deliberately.
        produce: (ctx) => ctx.produce('add_form', { ...PDFA_FORM, ...EMBED }),
    },
    {
        file: 'form-pdfa2b-no-embedfonts.pdf',
        tool: 'add_form',
        // Negative canary: the same form without `embedFonts`. Page text and
        // the /DR font both fall back to unembedded base-14 Helvetica
        // (diagnostics PDFA_NO_FONT_ENTRIES + PDFA_UNEMBEDDED_FORM_FONT), so
        // veraPDF MUST reject it.
        expectCompliant: false,
        produce: (ctx) => ctx.produce('add_form', { ...PDFA_FORM, title: 'Corpus — PDF/A-2b AcroForm without embedded fonts (negative canary)' }),
    },
    {
        file: 'placeholder-pdfa2b-unsigned.pdf',
        tool: 'prepare_signature_placeholder',
        // Negative canary: an unsigned placeholder carries an all-zero /Contents
        // and a dangling /ByteRange. veraPDF rejects it (ISO 19005-2 6.4.3 —
        // signature dictionary rules). This file MUST fail validation; if it
        // ever passes, the validator is not validating.
        expectCompliant: false,
        produce: (ctx) =>
            ctx.produce('prepare_signature_placeholder', {
                title: 'Corpus — PDF/A-2b unsigned placeholder',
                pdfA: 'pdfa2b',
                signerName: 'Corpus Signer',
                reason: 'Corpus',
                subFilter: 'ETSI.CAdES.detached',
                signingTime: '2026-01-01T00:00:00Z',
                blocks: [{ type: 'paragraph', text: 'Reserved signature field, not yet signed.' }],
                ...EMBED,
            }),
    },
    {
        file: 'signed-pdfa2b-pades.pdf',
        tool: 'sign_pdf',
        // Signed sibling of the placeholder above: PAdES baseline-B over the
        // same bytes with a throwaway self-signed RSA certificate. The
        // incremental update must keep the PDF/A-2b claim and conform.
        produce: (ctx) =>
            ctx.produce('sign_pdf', {
                pdfBase64: ctx.get('placeholder-pdfa2b-unsigned.pdf'),
                algorithm: 'rsa-sha256',
                profile: 'pades',
                ...buildRsaSelfSignedCert(),
            }),
    },
    {
        file: 'basic-pdfa1b-watermark.pdf',
        tool: 'generate_basic_pdf',
        produce: (ctx) =>
            ctx.produce('generate_basic_pdf', {
                title: 'Corpus — PDF/A-1b watermark',
                pdfA: 'pdfa1b',
                watermark: { text: 'ARCHIVE', opacity: 1 },
                blocks: [
                    { type: 'heading', text: 'Watermark under PDF/A-1b', level: 1 },
                    { type: 'paragraph', text: 'No transparency is allowed in PDF/A-1; the watermark is drawn opaque.' },
                ],
                ...EMBED,
            }),
    },
    {
        file: 'international-pdfa2u-emoji-math.pdf',
        tool: 'add_international_text',
        produce: (ctx) =>
            ctx.produce('add_international_text', {
                title: 'Corpus — PDF/A-2u Latin, emoji and math',
                pdfA: 'pdfa2u',
                lang: ['latin', 'emoji', 'math'],
                paragraphs: ['Colour emoji: 😀 🚀 ✅ under PDF/A-2u.', 'Math: ∀x ∈ ℝ, ∑ √2 ± ∞ ÷ ×.'],
            }),
    },
    {
        file: 'basic-pdfa2b-custom-outputintent.pdf',
        tool: 'generate_basic_pdf',
        produce: (ctx) =>
            ctx.produce('generate_basic_pdf', {
                title: 'Corpus — PDF/A-2b caller-supplied OutputIntent',
                pdfA: 'pdfa2b',
                outputIntent: {
                    iccProfileBase64: buildMinimalRgbIccProfile(),
                    outputConditionIdentifier: 'Corpus RGB',
                    registryName: 'http://www.color.org',
                    outputCondition: 'Corpus display RGB',
                    info: 'Minimal matrix/TRC RGB profile built by scripts/lib/synthetic-icc.ts',
                },
                blocks: [
                    { type: 'heading', text: 'Custom OutputIntent', level: 1 },
                    { type: 'paragraph', text: PARAGRAPHS[1] },
                ],
                ...EMBED,
            }),
    },
    {
        file: 'attachment-pdfa3b-pdf.pdf',
        tool: 'add_attachment',
        // PDF/A-3b with a PDF (not XML) payload: /AFRelationship + MIME subtype.
        produce: (ctx) =>
            ctx.produce('add_attachment', {
                title: 'Corpus — PDF/A-3b PDF attachment',
                blocks: [
                    { type: 'heading', text: 'Bundle', level: 1 },
                    { type: 'paragraph', text: 'The PDF/A-1b corpus file travels as an embedded PDF.' },
                ],
                attachments: [
                    {
                        filename: 'basic-pdfa1b.pdf',
                        mimeType: 'application/pdf',
                        dataBase64: ctx.get('basic-pdfa1b.pdf'),
                        relationship: 'Supplement',
                        description: 'Embedded PDF payload',
                    },
                ],
                ...EMBED,
            }),
    },
    {
        file: 'metadata-updated-pdfa2u.pdf',
        tool: 'update_metadata',
        // Rewrites /Info and the XMP packet of a claiming file; the claim must
        // survive and the synchronised metadata must still conform (6.6.2).
        produce: (ctx) =>
            ctx.produce('update_metadata', {
                pdfBase64: ctx.get('basic-pdfa2u-text.pdf'),
                title: 'Corpus — metadata rewritten',
                author: 'Corpus Author',
                subject: 'update_metadata on a PDF/A-2u document',
                keywords: 'pdfa, xmp, update_metadata',
                modDate: '2026-01-02T00:00:00Z',
            }),
    },
    {
        file: 'basic-pdfa2b-no-embedfonts.pdf',
        tool: 'generate_basic_pdf',
        // Negative canary: base-14 Helvetica without embedFonts claims PDF/A-2b
        // but violates ISO 19005-2 6.2.11.4.1 (fonts must be embedded).
        // veraPDF MUST reject it.
        expectCompliant: false,
        produce: (ctx) =>
            ctx.produce('generate_basic_pdf', {
                title: 'Corpus — PDF/A-2b without embedded fonts (negative canary)',
                pdfA: 'pdfa2b',
                blocks: [{ type: 'paragraph', text: 'Helvetica is referenced, not embedded.' }],
            }),
    },
    {
        file: 'merge-pdfa2b.pdf',
        tool: 'merge_pdfs',
        expectPdfAClaim: false,
        produce: async (ctx) => {
            const second = await ctx.produce('generate_basic_pdf', {
                title: 'Corpus — merge source B',
                pdfA: 'pdfa2b',
                blocks: [{ type: 'paragraph', text: 'Second source document.' }],
                ...EMBED,
            });
            return ctx.produce('merge_pdfs', { pdfsBase64: [ctx.get('basic-pdfa2b-watermark.pdf'), second] });
        },
    },
    {
        file: 'extract-pages-pdfa2b.pdf',
        tool: 'extract_pages',
        expectPdfAClaim: false,
        produce: (ctx) =>
            ctx.produce('extract_pages', { pdfBase64: ctx.get('basic-pdfa2b-outline-labels-list.pdf'), pages: [1] }),
    },
];
