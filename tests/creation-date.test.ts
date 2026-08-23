/**
 * `creationDate`: the opt-in reproducibility knob on
 * every document-producing tool. Pinned ⇒ two calls with identical inputs
 * return identical bytes; absent ⇒ the engine's wall-clock default applies and
 * the output is unchanged from before the option existed (byte-identity is
 * asserted by normalising only the date-bearing fields). The engine serialises
 * the instant in the host's local timezone, so reproducibility holds for the
 * same host TZ (documented in AGENTS.md).
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { PRINT_INPUT_PROPERTIES, toPrintLayout } from '../src/print.js';
import { ensureCompressionReady, listToolsPayload } from '../src/server.js';
import { addAttachment } from '../src/tools/add-attachment.js';
import { addBarcode } from '../src/tools/add-barcode.js';
import { addChart } from '../src/tools/add-chart.js';
import { addForm } from '../src/tools/add-form.js';
import { addInternationalText } from '../src/tools/add-international-text.js';
import { addTable } from '../src/tools/add-table.js';
import { embedImage } from '../src/tools/embed-image.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { prepareSignaturePlaceholder } from '../src/tools/prepare-signature-placeholder.js';
import type { OutputResult } from '../src/output.js';

const JPEG =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAARC' +
    'AABAAEDASIA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/a' +
    'AAwDAQACEQMRAD8AJQAB/9k=';
const PINNED = '2026-01-15T09:00:00Z';

type Handler = (input: unknown) => Promise<OutputResult>;
const DOCUMENT_TOOLS: Array<[string, Handler, Record<string, unknown>]> = [
    ['generate_basic_pdf', generateBasicPdf, { title: 'D', blocks: [{ type: 'paragraph', text: 'x' }] }],
    ['add_table', addTable, { title: 'T', headers: ['a'], rows: [['1']] }],
    ['add_form', addForm, { title: 'F', fields: [{ fieldType: 'text', name: 'n', label: 'N' }] }],
    ['add_international_text', addInternationalText, { title: 'I', lang: 'latin', paragraphs: ['héllo'] }],
    ['embed_image', embedImage, { title: 'E', imageBase64: JPEG, mimeType: 'image/jpeg' }],
    ['add_barcode', addBarcode, { format: 'qr', data: 'x' }],
    ['add_attachment', addAttachment, { title: 'A', blocks: [{ type: 'paragraph', text: 'x' }], attachments: [{ filename: 'a.txt', mimeType: 'text/plain', dataBase64: Buffer.from('a').toString('base64') }] }],
    ['add_chart', addChart, { chartType: 'bar', series: [{ label: 'a', values: [1, 2] }] }],
    // The /Sig /M entry is frozen at placeholder time too — pin it alongside creationDate.
    ['prepare_signature_placeholder', prepareSignaturePlaceholder, { title: 'P', blocks: [{ type: 'paragraph', text: 'x' }], signingTime: PINNED }],
];

beforeAll(async () => {
    delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
    await ensureCompressionReady();
});

/** Blank out the fields the engine derives from the clock (/CreationDate, /ModDate, XMP dates, /ID). */
function normalise(base64: string): string {
    return Buffer.from(base64, 'base64')
        .toString('latin1')
        .replace(/\/(CreationDate|ModDate|M)\s*\(D:[^)]*\)/g, '/$1(D:X)')
        .replace(/<xmp:(CreateDate|ModifyDate|MetadataDate)>[^<]*<\/xmp:\1>/g, '<xmp:$1>X</xmp:$1>')
        .replace(/\/ID\s*\[\s*<[0-9a-fA-F]+>\s*<[0-9a-fA-F]+>\s*\]/g, '/ID[X]');
}

describe('creationDate — shared fragment', () => {
    it('is advertised on every document tool with the same schema and a date-time format', () => {
        const tools = listToolsPayload().tools;
        for (const [name] of DOCUMENT_TOOLS) {
            const props = (tools.find((t) => t.name === name)?.inputSchema as { properties: Record<string, unknown> }).properties;
            expect(props['creationDate'], name).toEqual(PRINT_INPUT_PROPERTIES.creationDate);
        }
        expect(PRINT_INPUT_PROPERTIES.creationDate.format).toBe('date-time');
    });

    it('toPrintLayout converts the ISO string to a Date and emits nothing when absent', () => {
        expect(toPrintLayout({ creationDate: PINNED }).creationDate?.toISOString()).toBe('2026-01-15T09:00:00.000Z');
        expect(Object.keys(toPrintLayout({}))).toEqual([]);
    });

    it('rejects non ISO-8601 values with VALIDATION_ERROR and accepts timezone offsets', async () => {
        await expect(generateBasicPdf({ ...DOCUMENT_TOOLS[0]![2], creationDate: '15/01/2026' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        const out = await generateBasicPdf({ ...DOCUMENT_TOOLS[0]![2], creationDate: '2026-01-15T10:00:00+01:00' });
        expect(Buffer.from(out.base64!, 'base64').toString('latin1')).toMatch(/\/CreationDate\s*\(D:20260115/);
    });
});

describe('creationDate — reproducibility on every document tool', () => {
    for (const [name, handler, input] of DOCUMENT_TOOLS) {
        it(`${name}: pinned ⇒ byte-identical across calls; absent ⇒ unchanged default output`, async () => {
            const a = await handler({ ...input, creationDate: PINNED });
            const b = await handler({ ...input, creationDate: PINNED });
            expect(a.base64).toBeDefined();
            expect(a.base64).toBe(b.base64);
            expect(Buffer.from(a.base64!, 'base64').toString('latin1')).toMatch(/\/CreationDate\s*\(D:20260115/);

            const plain = await handler(input);
            expect(normalise(plain.base64!)).toBe(normalise(a.base64!));
        }, 30_000);
    }
});
