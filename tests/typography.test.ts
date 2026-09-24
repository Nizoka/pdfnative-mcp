/**
 * `typography` (pdfnative 1.8.0 `layout.typography`) on the document tools and
 * inspect_layout, plus the block-level `align` / `keepWithNext` / `splittable`.
 *
 * One named test per engine key — tests/engine-surface.test.ts holds the list
 * of keys to this file — and the contract that matters most: omitted (or
 * empty) typography changes nothing.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { TypographyOptions } from 'pdfnative';

import { ensureCompressionReady, listToolsPayload } from '../src/server.js';
import { TYPOGRAPHY_INPUT_SCHEMA, TYPOGRAPHY_KEYS, TypographySchema, FONT_FEATURE_TAGS, toTypographyOptions } from '../src/typography.js';
import { addInternationalText } from '../src/tools/add-international-text.js';
import { addTable } from '../src/tools/add-table.js';
import { extractText } from '../src/tools/extract-text.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { inspectLayout } from '../src/tools/inspect-layout.js';
import type { OutputResult } from '../src/output.js';

const PINNED = '2026-01-15T09:00:00Z';
const latin1 = (out: OutputResult): string => Buffer.from(out.base64!, 'base64').toString('latin1');
const pageCount = (out: OutputResult): number => (latin1(out).match(/\/Type\s*\/Page[^s]/g) ?? []).length;

const SENTENCE = 'The quick brown fox jumps over the lazy dog while the archivist files every report in the correct folder. ';
const LONG_PARAGRAPH = SENTENCE.repeat(14).trim();
// Five 116 pt paragraphs leave ~150 pt at the foot of page 1: too little for LONG_PARAGRAPH (200 pt) whole, enough for a slice.
const FILLER = Array.from({ length: 5 }, (_, i) => ({ type: 'paragraph', text: `Filler ${i + 1}. ${SENTENCE.repeat(8).trim()}` }));

const QUOTED = '"Wait," she said, "well-known, first-rate, state-of-the-art." '.repeat(12).trim();

type Doc = Record<string, unknown>;
const doc = (blocks: unknown[], extra: Doc = {}): Doc => ({ title: 'Typography', blocks, creationDate: PINNED, ...extra });

beforeAll(async () => {
    await ensureCompressionReady();
});

describe('typography — schema', () => {
    it('exposes exactly the keys of the engine TypographyOptions (12), JSON Schema and Zod in lock-step', () => {
        // A compile-time witness: adding a key to the engine type breaks this record until it is listed.
        const engineKeys: Record<keyof TypographyOptions, true> = {
            splitParagraphs: true, orphans: true, widows: true, keepHeadingsWithNext: true, unitBinding: true, bindShortWords: true,
            punctuationSpacing: true, opticalMargins: true, metrics: true, fontFeatures: true, kerning: true, hyphenationLanguage: true,
        };
        expect([...TYPOGRAPHY_KEYS].sort()).toEqual(Object.keys(engineKeys).sort());
        expect(Object.keys(TypographySchema.shape).sort()).toEqual(Object.keys(engineKeys).sort());
        expect(TYPOGRAPHY_INPUT_SCHEMA.additionalProperties).toBe(false);
        expect(TYPOGRAPHY_INPUT_SCHEMA.properties.fontFeatures.items.enum).toEqual([...FONT_FEATURE_TAGS]);
    });

    it('is offered by the nine document tools and by inspect_layout', () => {
        const withTypography = listToolsPayload().tools.filter((t) => 'typography' in ((t.inputSchema as { properties?: Doc }).properties ?? {})).map((t) => t.name).sort();
        expect(withTypography).toEqual([
            'add_attachment', 'add_barcode', 'add_chart', 'add_form', 'add_international_text', 'add_table', 'embed_image',
            'generate_basic_pdf', 'inspect_layout', 'prepare_signature_placeholder',
        ]);
    });

    it('rejects unknown keys, bad bounds and repeated features with VALIDATION_ERROR', async () => {
        const bad: Doc[] = [
            { unknownKey: true },
            { orphans: 0 },
            { widows: 11 },
            { keepHeadingsWithNext: { minLines: 0 } },
            { keepHeadingsWithNext: { lines: 2 } },
            { bindShortWords: { maxLength: 4 } },
            { unitBinding: { units: [''] } },
            { punctuationSpacing: 'de' },
            { punctuationSpacing: [{ char: ';', side: 'left', space: 'nbsp' }] },
            { punctuationSpacing: [{ char: ';', side: 'before' }] },
            { metrics: 'afm' },
            { fontFeatures: ['liga'] },
            { fontFeatures: ['onum', 'onum'] },
            { hyphenationLanguage: 'not a tag' },
        ];
        for (const typography of bad) {
            await expect(generateBasicPdf(doc([{ type: 'paragraph', text: 'x' }], { typography })), JSON.stringify(typography)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        }
        await expect(generateBasicPdf(doc([{ type: 'paragraph', text: 'x', align: 'justified' }]))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(generateBasicPdf(doc([{ type: 'heading', text: 'x', level: 1, splittable: true }]))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('maps only what was set; an empty object maps to nothing', () => {
        expect(toTypographyOptions(undefined)).toBeUndefined();
        expect(toTypographyOptions({})).toBeUndefined();
        expect(toTypographyOptions({ kerning: true, keepHeadingsWithNext: { minLines: 3 }, unitBinding: {}, bindShortWords: { words: ['a'] } })).toEqual({
            kerning: true, keepHeadingsWithNext: { minLines: 3 }, unitBinding: {}, bindShortWords: { words: ['a'] },
        });
    });
});

describe('typography — omitted means unchanged', () => {
    it('an absent or empty typography object leaves the bytes untouched', async () => {
        const blocks = [{ type: 'heading', text: 'H', level: 1 }, { type: 'paragraph', text: LONG_PARAGRAPH }];
        const plain = await generateBasicPdf(doc(blocks));
        expect((await generateBasicPdf(doc(blocks, { typography: {} }))).base64).toBe(plain.base64);
        const table = { title: 'T', headers: ['a'], rows: [['1']], creationDate: PINNED };
        expect((await addTable({ ...table, typography: {} })).base64).toBe((await addTable(table)).base64);
    });
});

describe('typography — pagination keys', () => {
    const tall = [...FILLER, { type: 'paragraph', text: LONG_PARAGRAPH }];

    it('splitParagraphs: a paragraph breaks at a line boundary instead of moving whole', async () => {
        const atomic = await inspectLayout({ title: 'Typography', blocks: tall });
        const split = await inspectLayout({ title: 'Typography', blocks: tall, typography: { splitParagraphs: true } });
        const lastPageBlocks = (l: typeof atomic): number => l.pages[l.pages.length - 1]!.blocks.length;
        // Atomic: the long paragraph sits alone on the last page. Split: it appears on two pages.
        const slices = (l: typeof atomic): number => l.pages.flatMap((p) => p.blocks).filter((b) => b.type === 'paragraph').length;
        expect(slices(split)).toBeGreaterThan(slices(atomic));
        expect(lastPageBlocks(atomic)).toBeGreaterThanOrEqual(1);
        expect((await generateBasicPdf(doc(tall, { typography: { splitParagraphs: true } }))).base64).not.toBe((await generateBasicPdf(doc(tall))).base64);
    });

    it('orphans / widows constrain where a split paragraph may break', async () => {
        const base = { title: 'Typography', blocks: tall };
        const loose = await inspectLayout({ ...base, typography: { splitParagraphs: true, orphans: 1, widows: 1 } });
        const strict = await inspectLayout({ ...base, typography: { splitParagraphs: true, orphans: 10, widows: 10 } });
        const firstSlice = (l: typeof loose): number => {
            const page = l.pages.find((p) => p.blocks.some((b) => b.type === 'paragraph' && b.height > 100));
            return page?.blocks.filter((b) => b.type === 'paragraph').at(-1)?.height ?? 0;
        };
        expect(firstSlice(loose)).not.toBe(firstSlice(strict));
    });

    it('keepHeadingsWithNext moves a stranded heading to the next page with its paragraph', async () => {
        // Fill the page so that only the heading would fit at its foot.
        const blocks = [...FILLER, { type: 'heading', text: 'Stranded heading', level: 2 }, { type: 'paragraph', text: LONG_PARAGRAPH }];
        const pageOfHeading = async (typography?: Doc): Promise<number> => {
            const layout = await inspectLayout({ title: 'Typography', blocks, ...(typography ? { typography } : {}) });
            return layout.pages.flatMap((p) => p.blocks).find((b) => b.type === 'heading')!.page;
        };
        const paragraphPage = async (typography?: Doc): Promise<number> => {
            const layout = await inspectLayout({ title: 'Typography', blocks, ...(typography ? { typography } : {}) });
            return layout.pages.flatMap((p) => p.blocks).filter((b) => b.type === 'paragraph').at(-1)!.page;
        };
        expect(await pageOfHeading({ keepHeadingsWithNext: true })).toBe(await paragraphPage({ keepHeadingsWithNext: true }));
        expect(await pageOfHeading({ keepHeadingsWithNext: { minLines: 3 } })).toBe(await paragraphPage({ keepHeadingsWithNext: { minLines: 3 } }));
    });

    it('block-level keepWithNext and splittable override the document setting', async () => {
        const blocks = [...FILLER, { type: 'heading', text: 'Kept', level: 2, keepWithNext: true }, { type: 'paragraph', text: LONG_PARAGRAPH }];
        const layout = await inspectLayout({ title: 'Typography', blocks });
        const flat = layout.pages.flatMap((p) => p.blocks);
        expect(flat.find((b) => b.type === 'heading')!.page).toBe(flat.filter((b) => b.type === 'paragraph').at(-1)!.page);

        const tallBlocks = (splittable: boolean): unknown[] => [...FILLER, { type: 'paragraph', text: LONG_PARAGRAPH, splittable }];
        const forbidden = await inspectLayout({ title: 'Typography', blocks: tallBlocks(false), typography: { splitParagraphs: true } });
        const allowed = await inspectLayout({ title: 'Typography', blocks: tallBlocks(true) });
        const paragraphs = (l: typeof forbidden): number => l.pages.flatMap((p) => p.blocks).filter((b) => b.type === 'paragraph').length;
        expect(paragraphs(allowed)).toBeGreaterThan(paragraphs(forbidden));
    });

    it('inspect_layout and generate_basic_pdf agree on the page count under every pagination setting', async () => {
        // The last setting is the 1.8.0 fix: keepHeadingsWithNext and splitParagraphs together.
        for (const typography of [{ splitParagraphs: true }, { splitParagraphs: true, orphans: 4, widows: 4 }, { keepHeadingsWithNext: true }, { splitParagraphs: true, keepHeadingsWithNext: { minLines: 3 } }]) {
            const input = { title: 'Typography', blocks: [...tall, { type: 'heading', text: 'Tail', level: 2 }, ...FILLER], typography };
            const layout = await inspectLayout(input);
            expect(layout.totalPages, JSON.stringify(typography)).toBe(pageCount(await generateBasicPdf({ ...input, creationDate: PINNED })));
        }
    });
});

describe('typography — text refinements', () => {
    const textOf = async (out: OutputResult): Promise<string> => (await extractText({ pdfBase64: out.base64! })).fullText;

    it('unitBinding binds a number to its unit with a no-break space', async () => {
        const blocks = [{ type: 'paragraph', text: 'Total 150 € for 12 kg and 30 % of 150 personnes.' }];
        const bound = await generateBasicPdf(doc(blocks, { typography: { unitBinding: true }, embedFonts: true }));
        const text = await textOf(bound);
        expect(text).toContain('150\u00a0€');
        expect(text).toContain('12\u00a0kg');
        expect(text).toContain('150 personnes'); // a word is not a unit
        const custom = await textOf(await generateBasicPdf(doc(blocks, { typography: { unitBinding: { units: ['personnes'] } }, embedFonts: true })));
        expect(custom).toContain('150\u00a0personnes');
        expect(custom).toContain('150 €');
    });

    it('bindShortWords keeps a short word with the next one', async () => {
        const blocks = [{ type: 'paragraph', text: 'Spotkanie w Krakowie i w Gdansku z ekspertami.' }];
        const text = await textOf(await generateBasicPdf(doc(blocks, { typography: { bindShortWords: true }, embedFonts: true })));
        expect(text).toContain('w\u00a0Krakowie');
        expect(text).toContain('i\u00a0w\u00a0Gdansku');
        const listed = await textOf(await generateBasicPdf(doc(blocks, { typography: { bindShortWords: { words: ['z'] } }, embedFonts: true })));
        expect(listed).toContain('z\u00a0ekspertami');
        expect(listed).toContain('w Krakowie');
        const wider = await textOf(await generateBasicPdf(doc([{ type: 'paragraph', text: 'Go to the lab at once.' }], { typography: { bindShortWords: { maxLength: 2 } }, embedFonts: true })));
        expect(wider).toContain('to\u00a0the');
    });

    it("punctuationSpacing: 'fr' binds ; ! ? with a narrow no-break space (embedded font), 'fr-CA' binds the colon and guillemets only; rules are honoured", async () => {
        const blocks = [{ type: 'paragraph', text: 'Vraiment ? Oui ! Voici : « un exemple » ; fin.' }];
        const fr = await textOf(await generateBasicPdf(doc(blocks, { typography: { punctuationSpacing: 'fr' }, embedFonts: true })));
        expect(fr).toContain('Vraiment\u202f?');
        expect(fr).toContain('Voici\u00a0:');
        const frCa = await textOf(await generateBasicPdf(doc(blocks, { typography: { punctuationSpacing: 'fr-CA' }, embedFonts: true })));
        // Canadian French sets no space rule before ; ! ? — only the colon and the guillemets are bound.
        expect(frCa).toContain('Vraiment ?');
        expect(frCa).toContain('Voici\u00a0:');
        expect(frCa).toContain('«\u00a0un');
        const rules = await textOf(await generateBasicPdf(doc(blocks, { typography: { punctuationSpacing: [{ char: ';', side: 'before', space: 'nbsp' }] }, embedFonts: true })));
        expect(rules).toContain('»\u00a0;');
        expect(rules).toContain('Vraiment ?');
    });

    it("align: 'justify' sets a line as one TJ array; opticalMargins changes the justified output", async () => {
        const left = latin1(await generateBasicPdf(doc([{ type: 'paragraph', text: LONG_PARAGRAPH }])));
        const justified = await generateBasicPdf(doc([{ type: 'paragraph', text: LONG_PARAGRAPH, align: 'justify' }]));
        expect(latin1(justified)).toMatch(/\] TJ/);
        expect(left).not.toMatch(/\] TJ/);
        const optical = await generateBasicPdf(doc([{ type: 'paragraph', text: QUOTED, align: 'justify' }], { typography: { opticalMargins: true } }));
        const plain = await generateBasicPdf(doc([{ type: 'paragraph', text: QUOTED, align: 'justify' }]));
        expect(optical.base64).not.toBe(plain.base64);
        for (const align of ['left', 'right', 'center']) {
            await expect(generateBasicPdf(doc([{ type: 'paragraph', text: 'Aligned.', align }]))).resolves.toMatchObject({ base64: expect.any(String) });
        }
    });

    it('a multi-line paragraph keeps its alignment on every segment and keepWithNext on the last only', async () => {
        const out = latin1(await generateBasicPdf(doc([{ type: 'paragraph', text: `${LONG_PARAGRAPH}\n${LONG_PARAGRAPH}`, align: 'justify', keepWithNext: true }, { type: 'paragraph', text: 'Tail.' }])));
        expect((out.match(/\] TJ/g) ?? []).length).toBeGreaterThan(4);
    });

    it("metrics: 'exact' measures base-14 text with the AFM widths (different wraps or positions)", async () => {
        const blocks = [{ type: 'paragraph', text: LONG_PARAGRAPH, align: 'right' }];
        const approx = await generateBasicPdf(doc(blocks, { typography: { metrics: 'approximate' } }));
        const exact = await generateBasicPdf(doc(blocks, { typography: { metrics: 'exact' } }));
        expect(exact.base64).not.toBe(approx.base64);
        expect(approx.base64).toBe((await generateBasicPdf(doc(blocks))).base64);
    });

    it('soft hyphens are honoured as break opportunities and never drawn mid-word', async () => {
        const word = 'Donau\u00addampf\u00adschiff\u00adfahrts\u00adgesell\u00adschaft';
        const out = await generateBasicPdf(doc([{ type: 'paragraph', text: `${word} `.repeat(30).trim() }], { embedFonts: true }));
        const text = await textOf(out);
        expect(text.replace(/[\s\u00ad-]/g, '')).toContain('Donaudampfschifffahrtsgesellschaft');
    });

    it('hyphenationLanguage is accepted and has no effect here: no provider is installed on this server', async () => {
        const blocks = [{ type: 'paragraph', text: LONG_PARAGRAPH }];
        const tagged = await generateBasicPdf(doc(blocks, { typography: { hyphenationLanguage: 'en-GB' } }));
        expect(pageCount(tagged)).toBe(1);
        expect(latin1(tagged)).toContain('quick brown fox');
    });
});

describe('typography — font-level keys need an embedded font', () => {
    const blocks = [{ type: 'paragraph', text: 'AVATAR Wave To Yo. Figures 0123456789, 1st 2nd, H2O.' }];

    it('kerning changes the embedded-font output (pair adjustments in TJ arrays)', async () => {
        const off = await generateBasicPdf(doc(blocks, { embedFonts: true }));
        const on = await generateBasicPdf(doc(blocks, { embedFonts: true, typography: { kerning: true } }));
        expect(on.base64).not.toBe(off.base64);
        expect(latin1(on)).toMatch(/\] TJ/);
    });

    it('fontFeatures: onum / smcp substitute glyphs; tnum / lnum are reported as ineffective on Noto Sans', async () => {
        const base = await generateBasicPdf(doc(blocks, { embedFonts: true }));
        const oldStyle = await generateBasicPdf(doc(blocks, { embedFonts: true, typography: { fontFeatures: ['onum', 'smcp'] } }));
        expect(oldStyle.base64).not.toBe(base.base64);
        const noop = await generateBasicPdf(doc(blocks, { embedFonts: true, includeDiagnostics: true, typography: { fontFeatures: ['tnum', 'lnum'] } }));
        expect(noop.diagnostics?.map((d) => d.code)).toContain('TYPOGRAPHY_FEATURE_INEFFECTIVE');
    });

    it('add_international_text takes the same typography object (embedded Noto fonts)', async () => {
        const input = { title: 'I', lang: 'latin', paragraphs: ['Prix : 150 € ; vraiment ?'], creationDate: PINNED };
        const plain = await addInternationalText(input);
        const refined = await addInternationalText({ ...input, typography: { unitBinding: true, punctuationSpacing: 'fr', kerning: true } });
        expect(refined.base64).not.toBe(plain.base64);
        expect((await extractText({ pdfBase64: refined.base64! })).fullText).toContain('150\u00a0€');
    });
});
