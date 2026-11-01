/**
 * Client-side constraints on the advertised catalogue.
 *
 * llama.cpp's `llama-server` compiles every tool schema of a request into one
 * GBNF grammar, and its converter turns an array with `maxItems: N` into a
 * repetition whose rule count times N must stay under its sane-default
 * threshold (2000): `prepare_signature_placeholder.blocks` at 2000 broke every
 * chat the tool was enabled in (issue #65, measured: ≤ 1000 and 5000 pass,
 * 1999 and 2000 fail). The catalogue therefore keeps every array bound at
 * 1000 or below — the convention of the rest of the tool set — or at exactly
 * 5000, the measured-good bound of the document `blocks`, table `rows` and
 * extract_pages `pages` arrays. A new bound in between must be measured
 * against the real server before it ships.
 */
import { describe, expect, it } from 'vitest';

import { listToolsPayload } from '../src/server.js';

type Schema = Record<string, unknown>;

/** Every `maxItems` of a schema tree with its JSON path. */
function arrayBounds(schema: Schema, at: string, out: Array<{ at: string; maxItems: number }>): void {
    if (typeof schema['maxItems'] === 'number') out.push({ at, maxItems: schema['maxItems'] });
    for (const [key, value] of Object.entries(schema)) {
        if (value === null || typeof value !== 'object') continue;
        if (Array.isArray(value)) value.forEach((member, i) => member !== null && typeof member === 'object' && arrayBounds(member as Schema, `${at}.${key}[${i}]`, out));
        else arrayBounds(value as Schema, `${at}.${key}`, out);
    }
}

describe('llama.cpp grammar compatibility (issue #65)', () => {
    const bounds: Array<{ at: string; maxItems: number }> = [];
    for (const tool of listToolsPayload().tools) arrayBounds(tool.inputSchema as unknown as Schema, tool.name, bounds);

    it('finds the array bounds of the catalogue', () => {
        expect(bounds.length).toBeGreaterThan(50);
    });

    it('every maxItems is at most 1000, or exactly 5000 (the measured-good bound of blocks, rows and pages)', () => {
        const offenders = bounds.filter((b) => b.maxItems > 1000 && b.maxItems !== 5000);
        expect(offenders).toEqual([]);
        const big = bounds.filter((b) => b.maxItems === 5000).map((b) => b.at.replace(/\.items\.oneOf\[\d+\]/, '.…'));
        expect([...new Set(big.map((at) => at.split('.').pop()))].sort()).toEqual(['blocks', 'pages', 'rows']);
    });

    it('prepare_signature_placeholder.blocks shares the 5000 bound of generate_basic_pdf (was 2000, which llama.cpp refused)', () => {
        const of = (tool: string): number | undefined => bounds.find((b) => b.at === `${tool}.properties.blocks`)?.maxItems;
        expect(of('prepare_signature_placeholder')).toBe(5000);
        expect(of('generate_basic_pdf')).toBe(5000);
    });
});
