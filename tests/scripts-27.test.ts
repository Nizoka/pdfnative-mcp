/**
 * add_international_text across the 27 scripts of pdfnative 1.8.0 (22 + Lao,
 * Tai Tham, New Tai Lue, Tai Le, Cham) and the four Latin aliases (Hausa,
 * Yoruba, Igbo, Swahili). Real fonts, no mock: each script is rendered with
 * its embedded Noto font, and the text is read back out of the file.
 *
 * Reading back is where the engine has documented limits. `extractText()`
 * walks the content stream, so a script whose glyphs are not drawn in logical
 * order comes back in VISUAL order (right-to-left runs, pre-base vowel signs),
 * and a few stacked clusters map to U+FFFD. Those scripts are pinned with
 * `it.fails` — the pdfnative-cli convention: the day the engine returns them
 * in logical order the marker turns the suite red, and it is deleted. Rendering
 * is unaffected; this is about extraction only (ROADMAP, "Blocked upstream").
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { ensureCompressionReady, listToolsPayload } from '../src/server.js';
import { LANG_ALIASES, SCRIPT_CODES, addInternationalText } from '../src/tools/add-international-text.js';
import { extractText } from '../src/tools/extract-text.js';
import type { OutputResult } from '../src/output.js';
import { ALIAS_SAMPLES, SCRIPT_SAMPLES } from './_script-text.js';
import { assertValidPdf } from './_pdf-assert.js';

const PINNED = '2026-01-15T09:00:00Z';
const bytesOf = (out: OutputResult): Uint8Array => new Uint8Array(Buffer.from(out.base64!, 'base64'));
const latin1 = (out: OutputResult): string => Buffer.from(out.base64!, 'base64').toString('latin1');
/** Compare text without the spacing and joiners an extractor may normalise. */
const squash = (s: string): string => s.normalize('NFC').replace(/[\s\u200b\u200c\u200d\u00ad]/gu, '');
/** Base letters only: compatibility forms folded, combining marks dropped. */
const letters = (s: string): string => s.normalize('NFKD').replace(/[\p{M}\s\u200b\u200c\u200d]/gu, '');

const NEW_IN_1_8 = ['lo', 'nod', 'khb', 'tdd', 'cjm'];

/**
 * Scripts whose extracted text is not the logical string (engine limit, see
 * the header). The value is the reason, shown in the test title.
 */
const EXTRACTION_LIMITS: Readonly<Record<string, string>> = {
    ar: 'right-to-left run extracted in visual order, as presentation forms',
    he: 'right-to-left run extracted in visual order',
    th: 'sara am / tone-mark glyph order',
    hi: 'pre-base vowel sign extracted in visual order',
    bn: 'pre-base vowel sign in visual order; a conjunct maps to U+FFFD',
    si: 'split vowel signs in visual order; U+FFFD for composed signs',
    km: 'stacked subscripts map to U+FFFD',
    my: 'kinzi / stacked consonants map to U+FFFD',
    nod: 'pre-base vowel in visual order; one cluster maps to U+FFFD',
    yo: 'a combining mark attached by GPOS is emitted after the next glyph',
    ig: 'a combining mark attached by GPOS is emitted after the next glyph',
};

beforeAll(async () => {
    await ensureCompressionReady();
});

async function render(code: string, text: string, extra: Record<string, unknown> = {}): Promise<OutputResult> {
    return addInternationalText({ title: 'T', lang: code, paragraphs: [text], creationDate: PINNED, ...extra });
}

describe('lang — 27 scripts and four aliases', () => {
    it('SCRIPT_CODES is the 27-script list, and every code has a native sample', () => {
        expect(SCRIPT_CODES).toHaveLength(27);
        expect([...SCRIPT_CODES].sort()).toEqual(Object.keys(SCRIPT_SAMPLES).sort());
        for (const code of NEW_IN_1_8) expect(SCRIPT_CODES).toContain(code);
        expect(LANG_ALIASES).toEqual({ ha: 'latin', yo: 'latin', ig: 'latin', sw: 'latin' });
        expect(Object.keys(ALIAS_SAMPLES).sort()).toEqual(Object.keys(LANG_ALIASES).sort());
    });

    it('the catalogue enum lists the 30 font-backed codes and the 4 aliases, for the scalar and the array form', () => {
        const tool = listToolsPayload().tools.find((t) => t.name === 'add_international_text')!;
        const lang = (tool.inputSchema as unknown as { properties: { lang: { anyOf: Array<{ enum?: string[]; maxItems?: number; items?: { enum?: string[] } }> } } }).properties.lang;
        const scalar = lang.anyOf[0]!.enum!;
        expect(scalar).toHaveLength(34);
        expect(scalar).toEqual(expect.arrayContaining([...SCRIPT_CODES, 'latin', 'emoji', 'math', 'ha', 'yo', 'ig', 'sw']));
        expect(lang.anyOf[1]!.items!.enum).toEqual(scalar);
        expect(lang.anyOf[1]!.maxItems).toBe(34);
    });

    it('every pinned extraction limit names a real code', () => {
        const known = new Set([...SCRIPT_CODES, ...Object.keys(LANG_ALIASES)]);
        expect(Object.keys(EXTRACTION_LIMITS).filter((c) => !known.has(c))).toEqual([]);
    });
});

describe('every script renders: valid PDF, embedded font, extractable text', () => {
    it.each(Object.entries(SCRIPT_SAMPLES))('%s', async (code, sample) => {
        const out = await render(code, sample.text);
        assertValidPdf(bytesOf(out));
        // The Noto font of the script is embedded as a TrueType subset.
        expect(latin1(out)).toMatch(/\/FontFile2\s+\d+\s+0\s+R/);
        const extracted = await extractText({ pdfBase64: out.base64! });
        expect(extracted.extractable, sample.name).toBe(true);
        // Whatever the order, the glyphs map back to the script: most base letters of the sample are there.
        const want = new Set(letters(sample.text));
        const got = new Set(letters(extracted.fullText));
        const found = [...want].filter((ch) => got.has(ch)).length;
        expect(found / want.size, `${sample.name}: ${found}/${want.size} distinct letters recovered`).toBeGreaterThanOrEqual(0.6);
    }, 60_000);
});

describe('text survives a round trip in logical order', () => {
    for (const [code, sample] of Object.entries({ ...SCRIPT_SAMPLES, ...ALIAS_SAMPLES })) {
        const limit = EXTRACTION_LIMITS[code];
        const run = limit === undefined ? it : it.fails;
        run(`${code} (${sample.name})${limit === undefined ? '' : ` — engine limit: ${limit}`}`, async () => {
            const out = await render(code, sample.text);
            const { fullText } = await extractText({ pdfBase64: out.base64! });
            expect(squash(fullText)).toContain(squash(sample.text));
        }, 60_000);
    }
});

describe('tagged output extracts the SOURCE text: extract_text honours /ActualText (pdfnative 1.8.0)', () => {
    // Under a PDF/A claim the engine tags the content and attaches the original string to each
    // marked span; extractText() 1.8.0 reads it back. So the scripts whose untagged extraction is
    // in visual order (above) round-trip exactly once the document is tagged.
    it.each(Object.keys(EXTRACTION_LIMITS))('%s', async (code) => {
        const sample = (SCRIPT_SAMPLES[code] ?? ALIAS_SAMPLES[code])!;
        const out = await render(code, sample.text, { pdfA: 'pdfa2u' });
        expect(latin1(out)).toContain('/ActualText');
        const { fullText } = await extractText({ pdfBase64: out.base64! });
        expect(squash(fullText)).toContain(squash(sample.text));
    }, 60_000);
});

describe('the five scripts added by pdfnative 1.8.0', () => {
    it.each(NEW_IN_1_8)('%s holds a PDF/A-2u claim under strict (every font embedded, Unicode mapped)', async (code) => {
        const out = await render(code, SCRIPT_SAMPLES[code]!.text, { pdfA: 'pdfa2u', strict: true, includeDiagnostics: true });
        expect(out.diagnostics).toEqual([]);
    }, 60_000);

    it('mix in one document with Latin and emoji (multi-font run splitting)', async () => {
        const paragraphs = NEW_IN_1_8.map((code) => `${SCRIPT_SAMPLES[code]!.name}: ${SCRIPT_SAMPLES[code]!.text} ✅`);
        const out = await addInternationalText({ title: 'South-East Asia', lang: [...NEW_IN_1_8, 'latin', 'emoji'], paragraphs, creationDate: PINNED });
        const { fullText } = await extractText({ pdfBase64: out.base64! });
        for (const code of NEW_IN_1_8.filter((c) => EXTRACTION_LIMITS[c] === undefined)) expect(squash(fullText), code).toContain(squash(SCRIPT_SAMPLES[code]!.text));
        expect(fullText).toContain('Tai Tham');
    }, 60_000);
});

describe('colour emoji — skin-tone sequences (pdfnative 1.8.0: 150 bundled sequences)', () => {
    it('each of the five Fitzpatrick tones of one gesture draws its own glyph', async () => {
        const tones = ['🏻', '🏼', '🏽', '🏾', '🏿'];
        const outputs = new Set<string>();
        for (const tone of tones) {
            const out = await addInternationalText({ title: 'Tone', lang: ['latin', 'emoji'], paragraphs: [`Wave 👋${tone}`], creationDate: PINNED });
            assertValidPdf(bytesOf(out));
            outputs.add(out.base64!);
        }
        expect(outputs.size).toBe(5);
        const plain = await addInternationalText({ title: 'Tone', lang: ['latin', 'emoji'], paragraphs: ['Wave 👋'], creationDate: PINNED });
        expect(outputs.has(plain.base64!)).toBe(false);
    }, 60_000);
});

describe('Latin aliases — Hausa, Yoruba, Igbo, Swahili', () => {
    it.each(Object.entries(ALIAS_SAMPLES))('%s renders through the latin module and keeps every base letter', async (code, sample) => {
        const out = await render(code, sample.text);
        const { fullText } = await extractText({ pdfBase64: out.base64! });
        expect(letters(fullText)).toContain(letters(sample.text));
    }, 60_000);

    it('an alias is the latin module: same bytes as lang:latin, and it de-duplicates against it', async () => {
        const text = ALIAS_SAMPLES['yo']!.text;
        const viaLatin = await render('latin', text);
        expect((await render('yo', text)).base64).toBe(viaLatin.base64);
        const mixed = await addInternationalText({ title: 'T', lang: ['yo', 'latin', 'sw', 'ha'], paragraphs: [text], creationDate: PINNED });
        expect(mixed.base64).toBe(viaLatin.base64);
        expect((await render('ig,latin', text)).base64).toBe(viaLatin.base64);
    }, 60_000);

    it('an unknown code is refused, and the message names the aliases', async () => {
        await expect(addInternationalText({ title: 'X', lang: 'xx,latin', paragraphs: ['x'] })).rejects.toMatchObject({
            code: 'UNSUPPORTED_LANG',
            message: expect.stringMatching(/aliases of latin: ha, yo, ig, sw/),
        });
    });
});
