/**
 * pdfnative-mcp — PDF/A validation corpus generator
 * ==================================================
 * Drives the built MCP tool handlers (`dist/server.js`) to produce a small,
 * deterministic corpus of PDF/A-claiming documents under `test-output/pdfa/`
 * covering the PDF/A-relevant features listed in the CORPUS table below (it is
 * a representative sample, not an exhaustive feature matrix).
 * `scripts/validate-pdfa.mjs` then runs every file through the veraPDF
 * reference validator.
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
 *
 * Every entry carries `expectCompliant` in manifest.json. Most are `true`; the
 * negative canaries (`false`) are files that claim PDF/A but are KNOWN to be
 * non-conformant — the validator must see veraPDF reject them, otherwise the
 * validator itself is broken ("accepts everything") and the run fails.
 */

import { createSign, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

// ── Self-signed RSA test certificate (node:crypto + a tiny DER encoder) ──
// Mirrors tests/_cert-fixtures.ts without importing test code: a throwaway
// RSA-2048 key signs a v1 certificate with CN=Corpus Signer. Generated per run,
// never written to disk or printed.

function derLength(n) {
    if (n < 0x80) return [n];
    const bytes = [];
    for (let v = n; v > 0; v >>>= 8) bytes.unshift(v & 0xff);
    return [0x80 | bytes.length, ...bytes];
}
function der(tag, ...parts) {
    const body = Buffer.concat(parts.map((p) => Buffer.from(p)));
    return Buffer.concat([Buffer.from([tag, ...derLength(body.length)]), body]);
}
const derSeq = (...parts) => der(0x30, ...parts);
const derSet = (...parts) => der(0x31, ...parts);
function derInt(buf) {
    const b = Buffer.from(buf);
    return der(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
}
function derOid(dotted) {
    const p = dotted.split('.').map(Number);
    const out = [p[0] * 40 + p[1]];
    for (const v0 of p.slice(2)) {
        let v = v0;
        const stack = [v & 0x7f];
        for (v >>>= 7; v > 0; v >>>= 7) stack.push((v & 0x7f) | 0x80);
        out.push(...stack.reverse());
    }
    return der(0x06, Buffer.from(out));
}
const derNull = Buffer.from([0x05, 0x00]);
const derBitString = (bytes) => der(0x03, Buffer.from([0]), bytes);
function derUtcTime(date) {
    const s = date.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z';
    return der(0x17, Buffer.from(s, 'ascii'));
}

function buildRsaSelfSignedCert(cn = 'Corpus Signer') {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = privateKey.export({ format: 'jwk' });
    const rsaPub = derSeq(derInt(Buffer.from(jwk.n, 'base64url')), derInt(Buffer.from(jwk.e, 'base64url')));
    const spki = derSeq(derSeq(derOid('1.2.840.113549.1.1.1'), derNull), derBitString(rsaPub));
    const sigAlg = derSeq(derOid('1.2.840.113549.1.1.11'), derNull);
    const name = derSeq(derSet(derSeq(derOid('2.5.4.3'), der(0x0c, Buffer.from(cn, 'utf8')))));
    const validity = derSeq(derUtcTime(new Date(Date.now() - 60_000)), derUtcTime(new Date(Date.now() + 365 * 86_400_000)));
    const tbs = derSeq(derInt(Buffer.from([1])), sigAlg, name, validity, name, spki);
    const sig = createSign('sha256').update(tbs).sign(privateKey);
    const certDer = derSeq(tbs, sigAlg, derBitString(sig));
    return {
        certDerBase64: certDer.toString('base64'),
        rsaKeyPkcs1DerBase64: privateKey.export({ format: 'der', type: 'pkcs1' }).toString('base64'),
    };
}

// ── Minimal valid RGB ICC v2 profile (custom OutputIntent entry) ──────
// Structurally the same display-class matrix/TRC profile pdfnative emits for
// its built-in sRGB intent (9 tags: desc, wtpt, cprt, rXYZ/gXYZ/bXYZ, rTRC/
// gTRC/bTRC), with a distinct description so the corpus file is recognisably
// a caller-supplied intent. veraPDF parses the ICC header and tag table
// (ISO 19005 6.2.2 / 6.2.3), so a bare 128-byte header would not do.

function buildMinimalRgbIccProfile(description = 'Corpus RGB') {
    const tags = [];
    const typeTag = (sig, body) => Buffer.concat([Buffer.from(sig, 'ascii'), Buffer.alloc(4), body]);
    const s15 = (v) => {
        const b = Buffer.alloc(4);
        b.writeInt32BE(Math.round(v * 65536));
        return b;
    };
    const xyz = (x, y, z) => typeTag('XYZ ', Buffer.concat([s15(x), s15(y), s15(z)]));
    // desc: ascii count + ascii (NUL-terminated) + unicode code/count (8) +
    // scriptcode code/count (3) + 67-byte scriptcode field.
    const descBody = Buffer.alloc(4 + description.length + 1 + 8 + 3 + 67);
    descBody.writeUInt32BE(description.length + 1, 0);
    descBody.write(description, 4, 'ascii');
    tags.push(['desc', typeTag('desc', descBody)]);
    tags.push(['wtpt', xyz(0.9642, 1.0, 0.8249)]);
    tags.push(['cprt', typeTag('text', Buffer.from('No Copyright\0', 'ascii'))]);
    tags.push(['rXYZ', xyz(0.4361, 0.2225, 0.0139)]);
    tags.push(['gXYZ', xyz(0.3851, 0.7169, 0.0971)]);
    tags.push(['bXYZ', xyz(0.1431, 0.0606, 0.7141)]);
    const curv = Buffer.alloc(4 + 2); // count = 1 → single u8Fixed8 gamma value
    curv.writeUInt32BE(1, 0);
    curv.writeUInt16BE(563, 4); // gamma 2.2 as u8Fixed8
    const trc = typeTag('curv', curv);
    for (const sig of ['rTRC', 'gTRC', 'bTRC']) tags.push([sig, trc]);

    const table = Buffer.alloc(4 + tags.length * 12);
    table.writeUInt32BE(tags.length, 0);
    let offset = 128 + table.length;
    const bodies = [];
    tags.forEach(([sig, body], i) => {
        const padded = Buffer.concat([body, Buffer.alloc((4 - (body.length % 4)) % 4)]);
        table.write(sig, 4 + i * 12, 'ascii');
        table.writeUInt32BE(offset, 8 + i * 12);
        table.writeUInt32BE(body.length, 12 + i * 12);
        bodies.push(padded);
        offset += padded.length;
    });
    const header = Buffer.alloc(128);
    header.writeUInt32BE(offset, 0); // profile size
    header.writeUInt8(2, 8); // version 2.1.0
    header.writeUInt8(0x10, 9);
    header.write('mntr', 12, 'ascii'); // display device class
    header.write('RGB ', 16, 'ascii'); // data colour space
    header.write('XYZ ', 20, 'ascii'); // PCS
    header.writeUInt16BE(2025, 24); // creation year
    header.writeUInt16BE(1, 26);
    header.writeUInt16BE(1, 28);
    header.write('acsp', 36, 'ascii');
    header.write('MSFT', 40, 'ascii');
    header.writeUInt32BE(63190, 68); // illuminant D50
    header.writeUInt32BE(65536, 72);
    header.writeUInt32BE(54061, 76);
    return Buffer.concat([header, table, ...bodies]).toString('base64');
}

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
        file: 'form-pdfa2b.pdf',
        tool: 'add_form',
        // KNOWN FAILURE (pdfnative 1.7.0): the AcroForm /DR default-appearance
        // font (/Helv → non-embedded Type1 Helvetica, used by the widget /DA
        // strings) is emitted by the engine regardless of `embedFonts`, so
        // veraPDF reports ISO 19005-2 6.2.11.4.1. Page text IS embedded. Kept
        // as a tracked expectation rather than dropped: the run turns XPASS
        // (fatal) the day the engine embeds /DR fonts, forcing this flag to
        // be flipped to `true` deliberately.
        expectCompliant: false,
        produce: () =>
            producePdf('add_form', {
                title: 'Corpus — PDF/A-2b AcroForm',
                pdfA: 'pdfa2b',
                fields: [
                    { fieldType: 'text', name: 'fullName', label: 'Full name', value: 'Ada Lovelace' },
                    { fieldType: 'checkbox', name: 'agree', label: 'I agree', checked: true },
                    { fieldType: 'dropdown', name: 'country', label: 'Country', options: ['FR', 'DE', 'UK'], value: 'FR' },
                    { fieldType: 'radio', name: 'size', label: 'Size', options: ['S', 'M', 'L'] },
                ],
                footerText: 'Form fields under PDF/A-2b (appearance streams, no JavaScript).',
                ...EMBED,
            }),
    },
    {
        file: 'placeholder-pdfa2b-unsigned.pdf',
        tool: 'prepare_signature_placeholder',
        // Negative canary: an unsigned placeholder carries an all-zero /Contents
        // and a dangling /ByteRange. veraPDF rejects it (ISO 19005-2 6.4.3 —
        // signature dictionary rules). This file MUST fail validation; if it
        // ever passes, the validator is not validating.
        expectCompliant: false,
        produce: () =>
            producePdf('prepare_signature_placeholder', {
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
            producePdf('sign_pdf', {
                pdfBase64: ctx.get('placeholder-pdfa2b-unsigned.pdf'),
                algorithm: 'rsa-sha256',
                profile: 'pades',
                ...buildRsaSelfSignedCert(),
            }),
    },
    {
        file: 'basic-pdfa1b-watermark.pdf',
        tool: 'generate_basic_pdf',
        produce: () =>
            producePdf('generate_basic_pdf', {
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
        produce: () =>
            producePdf('add_international_text', {
                title: 'Corpus — PDF/A-2u Latin, emoji and math',
                pdfA: 'pdfa2u',
                lang: ['latin', 'emoji', 'math'],
                paragraphs: ['Colour emoji: 😀 🚀 ✅ under PDF/A-2u.', 'Math: ∀x ∈ ℝ, ∑ √2 ± ∞ ÷ ×.'],
            }),
    },
    {
        file: 'basic-pdfa2b-custom-outputintent.pdf',
        tool: 'generate_basic_pdf',
        produce: () =>
            producePdf('generate_basic_pdf', {
                title: 'Corpus — PDF/A-2b caller-supplied OutputIntent',
                pdfA: 'pdfa2b',
                outputIntent: {
                    iccProfileBase64: buildMinimalRgbIccProfile(),
                    outputConditionIdentifier: 'Corpus RGB',
                    registryName: 'http://www.color.org',
                    outputCondition: 'Corpus display RGB',
                    info: 'Minimal matrix/TRC RGB profile built by scripts/generate-pdfa-corpus.mjs',
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
            producePdf('add_attachment', {
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
            producePdf('update_metadata', {
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
        produce: () =>
            producePdf('generate_basic_pdf', {
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
    // Prune PDFs left over from an older corpus layout so the validator's
    // "unlisted file" note only ever points at something unexpected.
    const current = new Set(CORPUS.map((e) => e.file));
    for (const stale of readdirSync(OUT_DIR).filter((f) => f.endsWith('.pdf') && !current.has(f))) {
        rmSync(join(OUT_DIR, stale));
        process.stdout.write(`  pruned ${stale}\n`);
    }

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
        // A file that makes no claim is never validated, so it has no compliance expectation.
        const expectCompliant = expectPdfAClaim && entry.expectCompliant !== false;
        manifest.push({ file: entry.file, tool: entry.tool, bytes: bytes.byteLength, expectPdfAClaim, expectCompliant });
        const note = !expectPdfAClaim ? ', no PDF/A claim expected' : !expectCompliant ? ', NEGATIVE canary — must fail veraPDF' : '';
        process.stdout.write(`  wrote  ${entry.file.padEnd(44)} ${String(bytes.byteLength).padStart(8)} B  (${entry.tool}${note})\n`);
    }

    const negatives = manifest.filter((m) => m.expectPdfAClaim && !m.expectCompliant).length;
    writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify({ generatedBy: 'scripts/generate-pdfa-corpus.mjs', files: manifest }, null, 2)}\n`);
    process.stdout.write(
        `\nPDF/A corpus: ${manifest.length} file(s), ${totalBytes} bytes, ${negatives} negative canar${negatives === 1 ? 'y' : 'ies'} → test-output/pdfa/ (manifest.json written)\n`,
    );
    return 0;
}

process.exit(await main());
