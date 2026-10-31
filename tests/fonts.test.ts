/**
 * Tests for math-symbol rendering (pdfnative v1.5 'math' font) exposed as an
 * explicit `lang` in add_international_text, plus the shared font-dir helper.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { ensureCompressionReady } from '../src/server.js';
import { getFontsDir } from '../src/fonts.js';
import { addInternationalText, ADD_INTERNATIONAL_TEXT_INPUT_SCHEMA } from '../src/tools/add-international-text.js';
import { assertValidPdf } from './_pdf-assert.js';

const MATH_TEXT = 'For all x \u2208 \u211d: \u221a(x\u00b2)=|x|, \u2211 i, \u222b f dx, \u221e, \u00b1\u03b5';

describe('math symbols (pdfnative v1.5 math font)', () => {
    beforeAll(async () => {
        delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
        await ensureCompressionReady();
    });

    it("advertises 'math' as a supported lang in the input schema", () => {
        const langSchema = (ADD_INTERNATIONAL_TEXT_INPUT_SCHEMA.properties as unknown as Record<string, { anyOf?: Array<{ enum?: readonly string[] }> }>).lang;
        const singleEnum = langSchema.anyOf?.[0]?.enum ?? [];
        expect(singleEnum).toContain('math');
    });

    it('renders math symbols via lang:[latin,math] and produces a valid PDF', async () => {
        const result = await addInternationalText({
            title: 'Math',
            lang: ['latin', 'math'],
            paragraphs: [MATH_TEXT],
        });
        expect(result.mode).toBe('base64');
        assertValidPdf(result.base64 as string, 1);
    });

    it('embeds the math font as a second program (pdfnative 1.9.0 subsets by used glyph, so size alone no longer tells)', async () => {
        const latinOnly = await addInternationalText({ title: 'M', lang: 'latin', paragraphs: [MATH_TEXT] });
        const withMath = await addInternationalText({ title: 'M', lang: ['latin', 'math'], paragraphs: [MATH_TEXT] });
        const programs = (out: { base64?: string }): number => (Buffer.from(out.base64!, 'base64').toString('latin1').match(/\/FontFile2\s+\d+\s+0\s+R/g) ?? []).length;
        expect(programs(latinOnly)).toBe(1);
        expect(programs(withMath)).toBe(2);
        // The subset is tagged (ABCDEF+NotoSansMath…, C21): the math face is really there.
        expect(Buffer.from(withMath.base64!, 'base64').toString('latin1')).toMatch(/[A-Z]{6}\+NotoSansMath/);
    });

    it('exposes a resolvable bundled fonts directory', () => {
        const dir = getFontsDir();
        expect(typeof dir).toBe('string');
        expect(dir.length).toBeGreaterThan(0);
    });
});

describe('colour-emoji flag & ZWJ sequences (pdfnative 1.7 bundled font, no API change)', () => {
    beforeAll(async () => {
        delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
        await ensureCompressionReady();
    });

    it('renders a flag (regional-indicator pair) and a ZWJ family as valid colour-emoji output', async () => {
        const result = await addInternationalText({
            title: 'Flags & families',
            lang: ['latin', 'emoji'],
            paragraphs: ['France \u{1F1EB}\u{1F1F7} and the EU \u{1F1EA}\u{1F1FA}', 'Family \u{1F468}‍\u{1F469}‍\u{1F467}, hearts ❤️'],
        });
        assertValidPdf(result.base64 as string, 1);
        const pdf = Buffer.from(result.base64 as string, 'base64').toString('latin1');
        // COLRv1 emoji render through the embedded colour font.
        expect(pdf).toMatch(/NotoColorEmoji|Noto Color Emoji/i);
    });

    it('is deterministic and differs from the per-codepoint fallback text', async () => {
        // creationDate pinned: /CreationDate and the trailer /ID otherwise follow the wall clock.
        const seq = { title: 'S', lang: ['emoji'], paragraphs: ['\u{1F1EB}\u{1F1F7}'], creationDate: '2026-01-15T09:00:00Z' };
        // Strip the wall-clock /CreationDate so a second boundary between calls cannot flake.
        const norm = (b64: string | undefined): string =>
            Buffer.from(b64 ?? '', 'base64').toString('latin1').replace(/D:\d{14}[^)]*\)/g, 'D:X)');
        const a = await addInternationalText(seq);
        const b = await addInternationalText(seq);
        expect(norm(a.base64)).toBe(norm(b.base64));
        const split = await addInternationalText({ title: 'S', lang: ['emoji'], paragraphs: ['\u{1F1EB} \u{1F1F7}'], creationDate: '2026-01-15T09:00:00Z' });
        expect(norm(split.base64)).not.toBe(norm(a.base64));
    });
});
