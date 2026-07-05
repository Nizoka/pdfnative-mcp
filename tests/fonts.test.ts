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
        const langSchema = (ADD_INTERNATIONAL_TEXT_INPUT_SCHEMA.properties as unknown as Record<string, { oneOf?: Array<{ enum?: readonly string[] }> }>).lang;
        const singleEnum = langSchema.oneOf?.[0]?.enum ?? [];
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

    it('embeds the math font (math run is materially larger than latin-only)', async () => {
        const latinOnly = await addInternationalText({ title: 'M', lang: 'latin', paragraphs: [MATH_TEXT] });
        const withMath = await addInternationalText({ title: 'M', lang: ['latin', 'math'], paragraphs: [MATH_TEXT] });
        // Noto Sans Math is a full font program — embedding it clearly grows the file.
        expect(withMath.sizeBytes).toBeGreaterThan(latinOnly.sizeBytes + 10000);
    });

    it('exposes a resolvable bundled fonts directory', () => {
        const dir = getFontsDir();
        expect(typeof dir).toBe('string');
        expect(dir.length).toBeGreaterThan(0);
    });
});
