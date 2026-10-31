/**
 * PDFNATIVE_MCP_FONT_DIR (1.8.0): the operator font sandbox. The fixture face
 * is a real TrueType program recovered from a bundled Noto module (every
 * `*-data.js` carries its program as `ttfBase64`), written to a temp
 * directory — no binary fixture is committed.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { FONT_DIR_ENV, __resetCustomFonts, customFontSlugs, fontSlug, loadCustomFonts, resolveCustomFont } from '../src/font-dir.js';
import { importFontModule } from '../src/fonts.js';
import { callToolDirect, ensureCompressionReady, listToolsPayload } from '../src/server.js';
import { addInternationalText } from '../src/tools/add-international-text.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { inspectLayout } from '../src/tools/inspect-layout.js';
import { extractText } from '../src/tools/extract-text.js';

const PINNED = '2026-01-15T09:00:00Z';
let dir: string;
let ttf: Buffer;

beforeAll(async () => {
    await ensureCompressionReady();
    const mod = (await importFontModule('noto-polish-data.js')) as { ttfBase64: string };
    ttf = Buffer.from(mod.ttfBase64, 'base64');
    expect(ttf.subarray(0, 4).toString('latin1')).toMatch(/^\u0000\u0001\u0000\u0000|^OTTO|^true/);
});

function freshDir(): string {
    dir = mkdtempSync(path.join(tmpdir(), 'pdfnative-fonts-'));
    return dir;
}

afterEach(() => {
    __resetCustomFonts();
    delete process.env[FONT_DIR_ENV];
    if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('fontSlug — file names fold to stable slugs', () => {
    it.each([
        ['Brand Sans-Bold.ttf', 'brand-sans-bold'],
        ['NotoSans-VF.otf', 'notosans-vf'],
        ['  Été_Display.TTF', 't-display'],
        ['---.ttf', ''],
    ])('%s → %s', (file, slug) => {
        expect(fontSlug(file)).toBe(slug);
    });
});

describe('loadCustomFonts — the boot validator', () => {
    it('registers nothing when the variable is unset', () => {
        expect(loadCustomFonts({})).toEqual([]);
        expect(customFontSlugs()).toEqual([]);
    });

    it('registers every .ttf / .otf of the directory under its slug, in sorted order', () => {
        const d = freshDir();
        writeFileSync(path.join(d, 'Brand Sans.ttf'), ttf);
        writeFileSync(path.join(d, 'archive.otf'), ttf);
        writeFileSync(path.join(d, 'README.txt'), 'not a font');
        expect(loadCustomFonts({ [FONT_DIR_ENV]: d })).toEqual(['archive', 'brand-sans']);
        expect(resolveCustomFont('brand-sans')).toBe('custom:brand-sans');
    });

    it.each([
        ['a relative path', () => 'fonts', /must be an absolute path/],
        ['a missing directory', () => path.join(freshDir(), 'nope'), /existing, readable directory/],
        ['an empty directory', () => freshDir(), /holds no \.ttf/],
        ['a file that is not a font', () => { const d = freshDir(); writeFileSync(path.join(d, 'fake.ttf'), 'GIF89a'); return d; }, /not a TrueType \/ OpenType font/],
        ['two files folding to one slug', () => { const d = freshDir(); writeFileSync(path.join(d, 'Brand.ttf'), ttf); writeFileSync(path.join(d, 'brand.otf'), ttf); return d; }, /already taken by another file/],
        ['a file folding to no slug', () => { const d = freshDir(); writeFileSync(path.join(d, '___.ttf'), ttf); return d; }, /empty or invalid slug/],
    ])('refuses to start on %s', (_label, make, message) => {
        expect(() => loadCustomFonts({ [FONT_DIR_ENV]: make() })).toThrow(message);
        expect(customFontSlugs()).toEqual([]);
    });

    it('FONT_NOT_FOUND names the registered slugs, or says the variable is unset', () => {
        expect(() => resolveCustomFont('ghost')).toThrow(expect.objectContaining({ code: 'FONT_NOT_FOUND', message: expect.stringContaining('is unset') }));
        const d = freshDir();
        writeFileSync(path.join(d, 'brand.ttf'), ttf);
        loadCustomFonts({ [FONT_DIR_ENV]: d });
        expect(() => resolveCustomFont('ghost')).toThrow(expect.objectContaining({ code: 'FONT_NOT_FOUND', message: expect.stringContaining('brand') }));
    });
});

describe('the font input — static schema, runtime resolution', () => {
    it('is advertised on the three document tools with the slug pattern, and nowhere else', () => {
        const tools = listToolsPayload().tools;
        const withFont = tools.filter((t) => 'font' in ((t.inputSchema as { properties: Record<string, unknown> }).properties)).map((t) => t.name).sort();
        expect(withFont).toEqual(['add_international_text', 'generate_basic_pdf', 'inspect_layout']);
        const schema = (tools.find((t) => t.name === 'generate_basic_pdf')!.inputSchema as unknown as { properties: { font: { pattern: string } } }).properties.font;
        expect(schema.pattern).toBe('^[a-z0-9][a-z0-9-]{0,63}$');
    });

    it('generate_basic_pdf embeds the custom face as the primary program and the text extracts', async () => {
        const d = freshDir();
        writeFileSync(path.join(d, 'brand-sans.ttf'), ttf);
        loadCustomFonts({ [FONT_DIR_ENV]: d });
        const out = await generateBasicPdf({ title: 'F', blocks: [{ type: 'paragraph', text: 'Zażółć gęślą jaźń' }], font: 'brand-sans', creationDate: PINNED });
        const pdf = Buffer.from(out.base64!, 'base64').toString('latin1');
        expect(pdf).toMatch(/\/FontFile2\s+\d+\s+0\s+R/);
        expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSans/);
        expect((await extractText({ pdfBase64: out.base64! })).fullText).toContain('Zażółć');
        // With embedFonts too, the custom face stays /F3 and Noto Sans Latin follows as /F4.
        const both = await generateBasicPdf({ title: 'F', blocks: [{ type: 'paragraph', text: 'Both' }], font: 'brand-sans', embedFonts: true, creationDate: PINNED });
        expect((Buffer.from(both.base64!, 'base64').toString('latin1').match(/\/FontFile2\s+\d+\s+0\s+R/g) ?? []).length).toBe(2);
    });

    it('inspect_layout measures with the same face, and add_international_text draws it first', async () => {
        const d = freshDir();
        writeFileSync(path.join(d, 'brand-sans.ttf'), ttf);
        loadCustomFonts({ [FONT_DIR_ENV]: d });
        const layout = await inspectLayout({ title: 'F', blocks: [{ type: 'paragraph', text: 'Measured with the custom face.' }], font: 'brand-sans' });
        expect(layout.totalPages).toBe(1);
        const intl = await addInternationalText({ title: 'F', lang: 'latin', font: 'brand-sans', paragraphs: ['Dzień dobry'], creationDate: PINNED });
        const pdf = Buffer.from(intl.base64!, 'base64').toString('latin1');
        expect((pdf.match(/\/FontFile2\s+\d+\s+0\s+R/g) ?? []).length).toBe(2);
    });

    it('an unknown slug is FONT_NOT_FOUND through tools/call, and a malformed one is VALIDATION_ERROR', async () => {
        const d = freshDir();
        writeFileSync(path.join(d, 'brand-sans.ttf'), ttf);
        loadCustomFonts({ [FONT_DIR_ENV]: d });
        const unknown = await callToolDirect('generate_basic_pdf', { title: 'F', blocks: [{ type: 'paragraph', text: 'x' }], font: 'ghost' });
        expect(unknown.isError).toBe(true);
        expect((unknown.content[0] as { text: string }).text).toContain('[FONT_NOT_FOUND]');
        expect((unknown.content[0] as { text: string }).text).toContain('brand-sans');
        const malformed = await callToolDirect('generate_basic_pdf', { title: 'F', blocks: [{ type: 'paragraph', text: 'x' }], font: '../etc/passwd' });
        expect((malformed.content[0] as { text: string }).text).toContain('[VALIDATION_ERROR]');
    });

    it('without the input the build call is untouched (no fontEntries)', async () => {
        const plain = await generateBasicPdf({ title: 'F', blocks: [{ type: 'paragraph', text: 'x' }], creationDate: PINNED });
        expect(Buffer.from(plain.base64!, 'base64').toString('latin1')).not.toContain('/FontFile2');
    });
});
