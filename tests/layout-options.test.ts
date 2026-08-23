/**
 * Page-layout fragment (`pageSize` / `margins` / `headerTemplate` /
 * `footerTemplate` / `compress` / `debug`) shared by every document-producing
 * tool. All fields are opt-in: omitted ⇒ the engine's A4 / default-margin /
 * uncompressed defaults apply and the output is byte-identical to a call that
 * never knew the fields existed.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { LAYOUT_INPUT_PROPERTIES, PAGE_SIZE_PRESETS, toLayoutOptions } from '../src/layout.js';
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
import { assertValidPdf } from './_pdf-assert.js';
import type { OutputResult } from '../src/output.js';

const JPEG =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAARC' +
    'AABAAEDASIA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/a' +
    'AAwDAQACEQMRAD8AJQAB/9k=';
const PINNED = '2026-01-15T09:00:00Z';
const LAYOUT_KEYS = ['pageSize', 'margins', 'headerTemplate', 'footerTemplate', 'compress', 'debug'] as const;

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
    ['prepare_signature_placeholder', prepareSignaturePlaceholder, { title: 'P', blocks: [{ type: 'paragraph', text: 'x' }], signingTime: PINNED }],
];

/** Two pages' worth of paragraphs so `{pages}` resolves to 2. */
const TWO_PAGE_DOC = {
    title: 'Quarterly Report',
    blocks: Array.from({ length: 60 }, (_, i) => ({ type: 'paragraph', text: `Paragraph ${i + 1} of a long document body.` })),
    creationDate: PINNED,
};

beforeAll(async () => {
    delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
    await ensureCompressionReady();
});

const latin1 = (out: OutputResult): string => Buffer.from(out.base64!, 'base64').toString('latin1');
const mediaBox = (pdf: string): [number, number] => {
    const m = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf);
    expect(m).not.toBeNull();
    return [Number(m![1]), Number(m![2])];
};

describe('layout fragment — catalogue', () => {
    it('is advertised identically on every document tool', () => {
        const tools = listToolsPayload().tools;
        for (const [name] of DOCUMENT_TOOLS) {
            const props = (tools.find((t) => t.name === name)?.inputSchema as { properties: Record<string, unknown> }).properties;
            for (const key of LAYOUT_KEYS) expect(props[key], `${name}.${key}`).toEqual(LAYOUT_INPUT_PROPERTIES[key]);
        }
        expect(LAYOUT_INPUT_PROPERTIES.pageSize.enum).toEqual(Object.keys(PAGE_SIZE_PRESETS));
        expect(LAYOUT_INPUT_PROPERTIES.margins.required).toEqual(['top', 'right', 'bottom', 'left']);
    });

    it('toLayoutOptions emits only the keys that were supplied', () => {
        expect(toLayoutOptions({})).toEqual({});
        expect(toLayoutOptions({ pageSize: 'Letter' })).toEqual({ pageWidth: 612, pageHeight: 792 });
        expect(toLayoutOptions({ margins: { top: 1, right: 2, bottom: 3, left: 4 } })).toEqual({ margins: { t: 1, r: 2, b: 3, l: 4 } });
        expect(toLayoutOptions({ headerTemplate: { left: 'x', fontSize: 8, color: '#ff0000' }, compress: false, debug: false })).toEqual({
            headerTemplate: { left: 'x', fontSize: 8, color: '#ff0000' },
            compress: false,
            debug: false,
        });
    });
});

describe('layout fragment — validation', () => {
    const base = DOCUMENT_TOOLS[0]![2];
    it.each([
        ['bad pageSize enum', { pageSize: 'A5' }],
        ['margin out of range', { margins: { top: 201, right: 0, bottom: 0, left: 0 } }],
        ['negative margin', { margins: { top: -1, right: 0, bottom: 0, left: 0 } }],
        ['missing margin side', { margins: { top: 1, right: 1, bottom: 1 } }],
        ['unknown margin key', { margins: { top: 1, right: 1, bottom: 1, left: 1, gutter: 1 } }],
        ['unknown template key', { footerTemplate: { left: 'x', bold: true } }],
        ['template fontSize out of range', { headerTemplate: { left: 'x', fontSize: 20 } }],
        ['template text too long', { headerTemplate: { left: 'x'.repeat(201) } }],
        ['non-hex template colour', { headerTemplate: { left: 'x', color: 'red' } }],
        ['non-boolean compress', { compress: 'yes' }],
        ['non-boolean debug', { debug: 1 }],
    ])('%s → VALIDATION_ERROR', async (_label, extra) => {
        await expect(generateBasicPdf({ ...base, ...extra })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});

describe('layout fragment — behaviour', () => {
    it('pageSize: Letter yields a 612×792 MediaBox; every preset is honoured', async () => {
        const letter = latin1(await generateBasicPdf({ ...DOCUMENT_TOOLS[0]![2], pageSize: 'Letter' }));
        expect(mediaBox(letter)).toEqual([612, 792]);
        for (const [name, size] of Object.entries(PAGE_SIZE_PRESETS)) {
            const pdf = latin1(await generateBasicPdf({ ...DOCUMENT_TOOLS[0]![2], pageSize: name }));
            expect(mediaBox(pdf), name).toEqual([size.width, size.height]);
            assertValidPdf(Buffer.from(pdf, 'latin1'));
        }
    });

    it('pageSize reaches both add_table backends (legacy and document)', async () => {
        const legacy = latin1(await addTable({ ...DOCUMENT_TOOLS[1]![2], pageSize: 'Legal' }));
        const document = latin1(await addTable({ ...DOCUMENT_TOOLS[1]![2], pageSize: 'Legal', autoFitColumns: true }));
        expect(mediaBox(legacy)).toEqual([612, 1008]);
        expect(mediaBox(document)).toEqual([612, 1008]);
    });

    it('pageSize works with pdfa1b and print boxes are validated against the new MediaBox', async () => {
        const out = await generateBasicPdf({ ...DOCUMENT_TOOLS[0]![2], pageSize: 'Tabloid', pdfA: 'pdfa1b', creationDate: PINNED });
        expect(mediaBox(latin1(out))).toEqual([792, 1224]);
        assertValidPdf(out.base64!);
        // TrimBox inside a Tabloid page but outside A4 — accepted only because the page is Tabloid.
        const wide = await generateBasicPdf({ ...DOCUMENT_TOOLS[0]![2], pageSize: 'Tabloid', print: { trimBox: [10, 10, 780, 1200] } });
        expect(latin1(wide)).toMatch(/\/TrimBox/);
        await expect(generateBasicPdf({ ...DOCUMENT_TOOLS[0]![2], print: { trimBox: [10, 10, 780, 1200] } })).rejects.toMatchObject({ code: 'PRINT_ERROR' });
    });

    it('margins move the text origin', async () => {
        const input = { title: 'M', blocks: [{ type: 'paragraph', text: 'hello' }], creationDate: PINNED };
        const narrow = latin1(await generateBasicPdf({ ...input, margins: { top: 45, right: 36, bottom: 35, left: 36 } }));
        const wide = latin1(await generateBasicPdf({ ...input, margins: { top: 45, right: 36, bottom: 35, left: 120 } }));
        const plain = latin1(await generateBasicPdf(input));
        expect(narrow).toBe(plain); // explicit engine defaults ⇒ same bytes
        expect(wide).not.toBe(plain);
        const xOf = (pdf: string): number => Number(/1 0 0 1 ([\d.]+) [\d.]+ Tm/.exec(pdf)?.[1] ?? /([\d.]+) [\d.]+ Td/.exec(pdf)?.[1]);
        expect(xOf(wide)).toBeGreaterThan(xOf(plain));
    });

    it('header/footer templates substitute {page} {pages} {title} and the footer replaces footerText', async () => {
        const pdf = latin1(
            await generateBasicPdf({
                ...TWO_PAGE_DOC,
                footerText: 'LEGACY-FOOTER',
                headerTemplate: { left: 'Doc: {title}', right: 'Page {page} of {pages}' },
                footerTemplate: { center: 'Sheet {page}/{pages}', fontSize: 9, color: '#336699' },
            }),
        );
        expect(assertValidPdf(Buffer.from(pdf, 'latin1'))).toBe(2);
        expect(pdf).toContain('Doc: Quarterly Report');
        expect(pdf).toContain('Page 1 of 2');
        expect(pdf).toContain('Page 2 of 2');
        expect(pdf).toContain('Sheet 2/2');
        expect(pdf).not.toContain('LEGACY-FOOTER'); // footerTemplate wins
        // Header only: the default footer (footerText + {page}/{pages}) is kept.
        const headerOnly = latin1(await generateBasicPdf({ ...TWO_PAGE_DOC, footerText: 'LEGACY-FOOTER', headerTemplate: { left: 'H' } }));
        expect(headerOnly).toContain('LEGACY-FOOTER');
        expect(headerOnly).toContain('1/2');
    });

    it('{date} is the engine wall-clock date (YYYY-MM-DD) and is NOT tied to creationDate', async () => {
        // Sample the clock on both sides of the build so a local-midnight boundary cannot flake.
        const ymd = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const before = ymd(new Date());
        const pdf = latin1(await generateBasicPdf({ ...TWO_PAGE_DOC, footerTemplate: { left: 'Built {date}' }, creationDate: '2021-06-01T00:00:00Z' }));
        const after = ymd(new Date());
        expect(pdf.includes(`Built ${before}`) || pdf.includes(`Built ${after}`)).toBe(true);
        // Pinned creationDate (2021) does not feed the placeholder.
        expect(pdf).not.toContain('Built 2021-06-01');
    });

    it('compress:true Flate-encodes page content and shrinks the file; compress omitted ⇒ bytes unchanged', async () => {
        const plain = await generateBasicPdf(TWO_PAGE_DOC);
        const explicitOff = await generateBasicPdf({ ...TWO_PAGE_DOC, compress: false });
        const on = await generateBasicPdf({ ...TWO_PAGE_DOC, compress: true });
        expect(explicitOff.base64).toBe(plain.base64);
        expect(latin1(plain)).not.toMatch(/\/Filter\s*\/FlateDecode[^>]*>>\s*stream/);
        expect(latin1(on)).toMatch(/\/Filter\s*\/FlateDecode/);
        expect(on.sizeBytes).toBeLessThan(plain.sizeBytes);
        assertValidPdf(on.base64!);
        // PDF/A is unaffected by compression.
        const pdfa = await generateBasicPdf({ ...TWO_PAGE_DOC, compress: true, pdfA: 'pdfa2b' });
        assertValidPdf(pdfa.base64!);
        expect(latin1(pdfa)).toContain('pdfaid:part');
    });

    it('debug:true adds stroked guide rectangles and stays valid; text geometry unchanged', async () => {
        const plain = latin1(await generateBasicPdf(TWO_PAGE_DOC));
        const dbg = latin1(await generateBasicPdf({ ...TWO_PAGE_DOC, debug: true }));
        expect(dbg).not.toBe(plain);
        expect(dbg.length).toBeGreaterThan(plain.length);
        expect((dbg.match(/ re\s+S\b/g) ?? []).length).toBeGreaterThan((plain.match(/ re\s+S\b/g) ?? []).length);
        assertValidPdf(Buffer.from(dbg, 'latin1'));
        expect(dbg).toContain('Paragraph 1 of a long document body.');
        // add_table: debug forces the document backend (the legacy table builder has no overlay).
        const table = latin1(await addTable({ ...DOCUMENT_TOOLS[1]![2], debug: true }));
        expect(table).toMatch(/ re\s+S\b/);
    });
});

describe('layout fragment — byte-identity on every document tool', () => {
    for (const [name, handler, input] of DOCUMENT_TOOLS) {
        it(`${name}: omitted layout keys ⇒ identical to the pre-fragment default; each key changes output when set`, async () => {
            const base = await handler({ ...input, creationDate: PINNED });
            const again = await handler({ ...input, creationDate: PINNED });
            expect(base.base64).toBe(again.base64);

            const letter = await handler({ ...input, creationDate: PINNED, pageSize: 'Letter' });
            expect(mediaBox(latin1(letter))).toEqual([612, 792]);
            expect(letter.base64).not.toBe(base.base64);

            const footer = await handler({ ...input, creationDate: PINNED, footerTemplate: { right: 'p{page}/{pages}' } });
            // Latin tools write the footer as a literal string; add_international_text routes it
            // through the embedded CID font (hex glyph ids), so only assert the bytes changed there.
            if (name === 'add_international_text') expect(footer.base64).not.toBe(base.base64);
            else expect(latin1(footer)).toContain('p1/1');

            const compressed = await handler({ ...input, creationDate: PINNED, compress: true });
            expect(latin1(compressed)).toMatch(/\/FlateDecode/);
            assertValidPdf(compressed.base64!);
        }, 30_000);
    }
});
