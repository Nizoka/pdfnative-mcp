/**
 * Shared colour fragment (src/color.ts): DeviceCMYK on every colour input
 * (pdfnative 1.8.0), JSON Schema ↔ Zod lock-step for the two CMYK forms, and
 * the 0.0–1.0 triple fix — until 1.7.0 a documented `[1, 0, 0]` watermark or
 * annotation colour reached the engine as a 0–255 tuple and rendered near-black.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
    CMYK_STRING_PATTERN,
    CMYK_STRING_SCHEMA,
    CMYK_TUPLE_SCHEMA,
    CmykStringSchema,
    CmykTupleSchema,
    colorSchema,
    colorZod,
    freeStringColorSchema,
    freeStringColorZod,
    toEngineColor,
} from '../src/color.js';
import { ensureCompressionReady, listToolsPayload } from '../src/server.js';
import { addChart } from '../src/tools/add-chart.js';
import { addTable } from '../src/tools/add-table.js';
import { annotatePdf } from '../src/tools/annotate-pdf.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import type { OutputResult } from '../src/output.js';

const latin1 = (out: OutputResult): string => Buffer.from(out.base64!, 'base64').toString('latin1');
const DOC = { title: 'Colour', blocks: [{ type: 'paragraph', text: 'Body text.' }], creationDate: '2026-01-15T09:00:00Z' };

beforeAll(async () => {
    await ensureCompressionReady();
});

describe('CMYK forms — JSON Schema and Zod agree', () => {
    const pattern = new RegExp(CMYK_STRING_PATTERN);
    const strings: Array<[string, boolean]> = [
        ['1 0.6 0 0.1', true],
        ['0 0 0 1', true],
        ['1.0 0.50 0.25 0', true],
        ['0 0 0', false], // three operands: RGB, not CMYK
        ['1 0.6 0 0.1 0', false],
        ['1.2 0 0 0', false],
        ['-0.1 0 0 0', false],
        ['1e-3 0 0 0', false], // the engine grammar has no exponent
        ['1  0 0 0', false],
        ['#112233', false],
        ['', false],
    ];
    it.each(strings)('string %j → %s', (value, ok) => {
        expect(pattern.test(value)).toBe(ok);
        expect(CmykStringSchema.safeParse(value).success).toBe(ok);
    });

    const tuples: Array<[unknown, boolean]> = [
        [[100, 60, 0, 10], true],
        [[0, 0, 0, 0], true],
        [[12.5, 0, 0, 100], true],
        [[100, 60, 0], false],
        [[100, 60, 0, 10, 0], false],
        [[101, 0, 0, 0], false],
        [[-1, 0, 0, 0], false],
        [['100', 0, 0, 0], false],
    ];
    it.each(tuples)('tuple %j → %s', (value, ok) => {
        const items = CMYK_TUPLE_SCHEMA.items;
        const json =
            Array.isArray(value) &&
            value.length >= CMYK_TUPLE_SCHEMA.minItems &&
            value.length <= CMYK_TUPLE_SCHEMA.maxItems &&
            value.every((v) => typeof v === 'number' && v >= items.minimum && v <= items.maximum);
        expect(json).toBe(ok);
        expect(CmykTupleSchema.safeParse(value).success).toBe(ok);
    });

    it('colorSchema keeps the historical member first, verbatim, and appends the two CMYK forms', () => {
        const legacy = { type: 'string', pattern: '^#[0-9a-f]{6}$' } as const;
        const schema = colorSchema(legacy, 'Hex colour.');
        expect(schema.anyOf[0]).toBe(legacy);
        expect(schema.anyOf.slice(1)).toEqual([CMYK_STRING_SCHEMA, CMYK_TUPLE_SCHEMA]);
        // The wrapper keeps the property's own description; the CMYK members document themselves (token budget).
        expect(schema.description).toBe('Hex colour.');
        const zod = colorZod(z.string().regex(/^#[0-9a-f]{6}$/));
        for (const ok of ['#aabbcc', '0 0 0 1', [0, 0, 0, 100]]) expect(zod.safeParse(ok).success, JSON.stringify(ok)).toBe(true);
        for (const bad of ['red', '0 0 0', [0, 0, 0], [0, 0, 0, 101]]) expect(zod.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    });

    it('freeStringColorSchema adds only the tuple (a free string already admits the CMYK operands)', () => {
        const legacy = { type: 'string' } as const;
        const schema = freeStringColorSchema(legacy, 'Any colour string.');
        expect(schema.anyOf).toEqual([legacy, CMYK_TUPLE_SCHEMA]);
        const zod = freeStringColorZod(z.string().min(1));
        expect(zod.safeParse('1 0.6 0 0.1').success).toBe(true);
        expect(zod.safeParse([100, 60, 0, 10]).success).toBe(true);
        expect(zod.safeParse([1, 0, 0]).success).toBe(false);
    });
});

describe('toEngineColor', () => {
    it('passes strings and CMYK tuples through unchanged', () => {
        expect(toEngineColor('#2563eb')).toBe('#2563eb');
        expect(toEngineColor('1 0.6 0 0.1')).toBe('1 0.6 0 0.1');
        expect(toEngineColor([100, 60, 0, 10])).toEqual([100, 60, 0, 10]);
    });

    it('turns the documented 0.0–1.0 triple into RGB operands (the engine reads a bare triple as 0–255)', () => {
        expect(toEngineColor([1, 0, 0])).toBe('1 0 0');
        expect(toEngineColor([0.75, 0.75, 0.75])).toBe('0.75 0.75 0.75');
        expect(toEngineColor([1 / 3, 0.00001, 0.123456])).toBe('0.3333 0 0.1235');
    });

    it('leaves a triple that cannot be 0.0–1.0 to the engine, as a 0–255 tuple', () => {
        expect(toEngineColor([255, 128, 0])).toEqual([255, 128, 0]);
    });
});

describe('catalogue: every colour property advertises the CMYK tuple', () => {
    it('finds the CMYK tuple beside each colour property of tools/list', () => {
        const hits: string[] = [];
        const misses: string[] = [];
        const hasCmykTuple = (node: Record<string, unknown>): boolean =>
            (['anyOf', 'oneOf'] as const).some((k) => Array.isArray(node[k]) && (node[k] as Array<Record<string, unknown>>).some((m) => m['type'] === 'array' && m['minItems'] === 4 && m['maxItems'] === 4));
        const walk = (node: unknown, at: string): void => {
            if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${at}[${i}]`));
            if (node === null || typeof node !== 'object') return;
            for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
                const here = `${at}.${key}`;
                if (/^(color|interiorColor|fill|stroke)$/.test(key) && value !== null && typeof value === 'object' && at.endsWith('.properties')) {
                    (hasCmykTuple(value as Record<string, unknown>) ? hits : misses).push(here);
                }
                walk(value, here);
            }
        };
        for (const tool of listToolsPayload().tools) walk(tool.inputSchema, tool.name);
        expect(misses).toEqual([]);
        // watermark ×7 document tools at least, templates, outline, borders, link, svg, annotations.
        expect(hits.length).toBeGreaterThan(30);
    });
});

describe('CMYK reaches the content stream as k / K operators', () => {
    it('watermark: CMYK string and tuple paint with `k`; hex-free RGB triple paints with `rg`', async () => {
        const cmykString = latin1(await generateBasicPdf({ ...DOC, watermark: { text: 'DRAFT', opacity: 1, color: '0 1 1 0' } }));
        expect(cmykString).toMatch(/\b0 1 1 0 k\b/);
        const cmykTuple = latin1(await generateBasicPdf({ ...DOC, watermark: { text: 'DRAFT', opacity: 1, color: [0, 100, 100, 0] } }));
        expect(cmykTuple).toMatch(/\b0 1 1 0 k\b/);
    });

    it('watermark: the documented 0.0–1.0 red triple now renders red, not 1/255 red', async () => {
        const pdf = latin1(await generateBasicPdf({ ...DOC, watermark: { text: 'DRAFT', opacity: 1, color: [1, 0, 0] } }));
        expect(pdf).toMatch(/\b1 0 0 rg\b/);
        expect(pdf).not.toMatch(/\b0\.004 0 0 rg\b/);
    });

    it('header/footer template, link and svg colours accept CMYK', async () => {
        const pdf = latin1(
            await generateBasicPdf({
                ...DOC,
                headerTemplate: { left: '{title}', color: '0 0 0 0.8' },
                blocks: [
                    { type: 'link', text: 'site', url: 'https://example.com', color: [100, 60, 0, 10] },
                    { type: 'svg', data: 'M0 0 L10 10 L0 10 Z', viewBox: [0, 0, 10, 10], width: 40, height: 40, fill: '0 0.5 1 0', stroke: [0, 0, 0, 100] },
                ],
            }),
        );
        expect(pdf).toMatch(/\b0 0 0 0\.8 k\b/);
        expect(pdf).toMatch(/\b1 0\.6 0 0\.1 (k|K)\b/);
        expect(pdf).toMatch(/\b0 0\.5 1 0 k\b/);
        expect(pdf).toMatch(/\b0 0 0 1 K\b/);
    });

    it('charts: series colour and palette accept CMYK; bare hex is still normalised', async () => {
        const chart = { chartType: 'bar', categories: ['a', 'b'], creationDate: DOC.creationDate };
        const cmyk = latin1(await addChart({ ...chart, series: [{ label: 's', values: [1, 2], color: '1 0 0 0' }] }));
        expect(cmyk).toMatch(/\b1 0 0 0 k\b/);
        const palette = latin1(await addChart({ ...chart, series: [{ label: 's', values: [1, 2] }], colors: [[0, 100, 0, 0]] }));
        expect(palette).toMatch(/\b0 1 0 0 k\b/);
        const hex = latin1(await addChart({ ...chart, series: [{ label: 's', values: [1, 2], color: 'ff0000' }] }));
        expect(hex).toMatch(/\b1 0 0 rg\b/);
    });

    it('table cell borders and outline labels accept the CMYK tuple', async () => {
        const table = latin1(await addTable({ title: 'T', headers: ['a'], rows: [['1']], cellBorders: { all: true, color: [0, 0, 0, 50] }, creationDate: DOC.creationDate }));
        expect(table).toMatch(/\b0 0 0 0\.5 K\b/);
        // /C of an outline item is RGB by definition: the engine converts, the call succeeds.
        const outlined = await generateBasicPdf({ ...DOC, blocks: [{ type: 'heading', text: 'H', level: 1 }], outline: [{ title: 'H', pageIndex: 0, color: [100, 0, 0, 0] }] });
        expect(latin1(outlined)).toMatch(/\/C \[0 1 1\]/);
    });

    it('rejects malformed colours with VALIDATION_ERROR at every widened site', async () => {
        await expect(generateBasicPdf({ ...DOC, watermark: { text: 'x', color: [0, 0, 0, 101] } })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(generateBasicPdf({ ...DOC, watermark: { text: 'x', color: '2 0 0 0' } })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(generateBasicPdf({ ...DOC, headerTemplate: { left: 'x', color: 'red' } })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(addChart({ chartType: 'bar', series: [{ label: 's', values: [1], color: '0 0 0' }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});

describe('annotate_pdf colours', () => {
    const rect = [50, 700, 250, 740];
    const source = async (): Promise<string> => (await generateBasicPdf(DOC)).base64!;

    it('0.0–1.0 triples are honoured (red /C, not 1/255 red); CMYK tuple and string are accepted', async () => {
        const pdfBase64 = await source();
        const red = latin1(await annotatePdf({ pdfBase64, annotations: [{ type: 'square', page: 0, rect, color: [1, 0, 0], interiorColor: [0, 0, 1] }] }));
        expect(red).toMatch(/\/C \[1 0 0\]/);
        expect(red).toMatch(/\/IC \[0 0 1\]/);
        const cmyk = latin1(await annotatePdf({ pdfBase64, annotations: [{ type: 'square', page: 0, rect, color: [0, 100, 100, 0], interiorColor: '0 0 1 0' }] }));
        expect(cmyk).toMatch(/\/C \[0 1 1 0\]/);
        expect(cmyk).toMatch(/\/IC \[0 0 1 0\]/);
    });

    it('a triple above 1 keeps its historical 0–255 reading', async () => {
        const pdf = latin1(await annotatePdf({ pdfBase64: await source(), annotations: [{ type: 'square', page: 0, rect, color: [255, 0, 0] }] }));
        expect(pdf).toMatch(/\/C \[1 0 0\]/);
    });
});
