/**
 * add_international_text against the REAL pdfnative engine and the bundled
 * Noto font modules — no `vi.mock` anywhere (the sibling
 * `add-international-text.test.ts` stubs the engine to test the wiring).
 *
 * Covers: real shaping / embedding for RTL (Arabic, Hebrew), CJK (Japanese)
 * and a Latin + Math combination; the un-mocked `UNSUPPORTED_LANG` path; and
 * `FONT_LOAD_FAILED` driven through pdfnative's public font registry.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearFontCache, openPdf, registerFont } from 'pdfnative';

import { addInternationalText } from '../src/tools/add-international-text.js';
import { inspectPdf } from '../src/tools/inspect-pdf.js';
import { importFontModule } from '../src/fonts.js';
import { ensureCompressionReady } from '../src/server.js';
import { assertValidPdf } from './_pdf-assert.js';

function latin1(b64: string): string {
    return Buffer.from(b64, 'base64').toString('latin1');
}

describe('add_international_text — real engine rendering', () => {
    beforeAll(async () => {
        await ensureCompressionReady();
    });

    it.each([
        { lang: 'ar', title: 'Arabic', paragraphs: ['مرحبا بالعالم', 'هذا نص عربي للاختبار'] },
        { lang: 'he', title: 'Hebrew', paragraphs: ['שלום עולם'] },
        { lang: 'ja', title: 'Japanese', paragraphs: ['こんにちは世界', '日本語のテキスト'] },
    ])('renders $lang with an embedded CIDFont and Identity-H encoding', async ({ lang, title, paragraphs }) => {
        const result = await addInternationalText({ title, lang, paragraphs });
        expect(result.mode).toBe('base64');
        expect(result.sizeBytes).toBeGreaterThan(1000);
        assertValidPdf(result.base64!);
        const text = latin1(result.base64!);
        expect(text).toContain('/Identity-H');
        expect(text).toContain('/CIDFontType2');
        expect(text).toContain('/FontFile2');
        expect(text).toContain('/F3');
    }, 120_000);

    it("renders ['latin','math'] with one embedded font per script and emits an extra font resource", async () => {
        const result = await addInternationalText({
            title: 'Math',
            lang: ['latin', 'math'],
            paragraphs: ['For all x: ∀x ∃y (x < y) — √2 ≈ 1.414, ∑ and ∫ over ℝ'],
        });
        assertValidPdf(result.base64!);
        const text = latin1(result.base64!);
        expect(text).toContain('/F3');
        expect(text).toContain('/F4');
        expect((text.match(/\/FontFile2/g) ?? []).length).toBeGreaterThanOrEqual(2);
    }, 120_000);

    it('produces a parseable multi-page document when paragraphs overflow a page', async () => {
        const result = await addInternationalText({ title: 'Long', lang: 'he', paragraphs: Array.from({ length: 80 }, (_, i) => `שורה מספר ${i + 1} בעברית`) });
        const pages = assertValidPdf(result.base64!, 2);
        expect(openPdf(new Uint8Array(Buffer.from(result.base64!, 'base64'))).pageCount).toBe(pages);
    }, 120_000);

    it('renders a PDF/A-2b document with the Latin fallback auto-registered', async () => {
        const result = await addInternationalText({ title: 'Archive', lang: 'ar', pdfA: 'pdfa2b', paragraphs: ['مرحبا — “quoted”'], includeDiagnostics: true });
        assertValidPdf(result.base64!);
        expect(result.diagnostics).toEqual([]);
        const report = await inspectPdf({ pdfBase64: result.base64! });
        expect(report.pdfA).toBe('2B');
    }, 120_000);

    it('rejects an unknown code with UNSUPPORTED_LANG without touching the engine (no mocks)', async () => {
        // 'zz' passes the schema's comma-separated-string branch and is refused by the lang resolver.
        await expect(addInternationalText({ title: 'Bad', lang: 'zz', paragraphs: ['x'] })).rejects.toMatchObject({
            code: 'UNSUPPORTED_LANG',
            message: expect.stringContaining("Unsupported lang 'zz'") as string,
        });
        await expect(addInternationalText({ title: 'Bad', lang: 'ar,nope', paragraphs: ['x'] })).rejects.toMatchObject({ code: 'UNSUPPORTED_LANG' });
        // A list that is all separators resolves to zero codes.
        await expect(addInternationalText({ title: 'Bad', lang: ', ,', paragraphs: ['x'] })).rejects.toMatchObject({ code: 'UNSUPPORTED_LANG' });
    });
});

describe('add_international_text — FONT_LOAD_FAILED through the real font registry', () => {
    // The tool registers each lang's loader once per process; afterwards pdfnative's
    // public registry is the only thing consulted, so swapping the loader there (a
    // supported engine API, not a module mock) and clearing the data cache makes the
    // engine's own retry-then-null path return null to the tool.
    afterAll(() => {
        registerFont('ko', async () => importFontModule('noto-kr-data.js') as Promise<Awaited<ReturnType<Parameters<typeof registerFont>[1]>>>);
        clearFontCache();
    });

    it('maps a loader that keeps failing to FONT_LOAD_FAILED', async () => {
        // First call: the tool registers the real 'ko' loader and renders normally.
        const ok = await addInternationalText({ title: 'Korean', lang: 'ko', paragraphs: ['안녕하세요'] });
        assertValidPdf(ok.base64!);

        registerFont('ko', () => Promise.reject(new Error('simulated missing font module')));
        clearFontCache();
        await expect(addInternationalText({ title: 'Korean', lang: 'ko', paragraphs: ['안녕하세요'] })).rejects.toMatchObject({
            code: 'FONT_LOAD_FAILED',
            message: "Failed to load font data for lang 'ko'.",
        });
    }, 120_000);
});
