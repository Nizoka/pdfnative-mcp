/**
 * Shared colour fragment: DeviceCMYK on every colour input (pdfnative >= 1.8).
 *
 * The engine takes a colour in five forms and reads the space from the
 * component count — three is DeviceRGB, four is DeviceCMYK:
 *   - hex string            '#2563eb'
 *   - RGB operand string    '0.145 0.388 0.922'   (0.0–1.0)
 *   - RGB tuple             [37, 99, 235]         (0–255)
 *   - CMYK operand string   '1 0.6 0 0.1'         (0.0–1.0)
 *   - CMYK tuple            [100, 60, 0, 10]      (percent, 0–100)
 *
 * Each tool keeps the colour form it has always accepted — hex on charts and
 * templates, a free string on outlines and borders, a 0.0–1.0 triple on
 * watermarks and annotations — as the FIRST `anyOf` member, verbatim, so every
 * published input still validates (tests/catalogue-superset.test.ts), and gains
 * the two CMYK forms beside it. JSON Schema and Zod are built from the same
 * constants, which is what keeps the two in lock-step.
 *
 * The 0.0–1.0 triple needs translating: the engine reads a three-number tuple
 * as 0–255, so until 1.7.0 a documented `[1, 0, 0]` reached it as 1/255 red
 * and rendered near-black. `toEngineColor()` hands such a triple over as the
 * equivalent operand string instead.
 */
import type { PdfColor } from 'pdfnative';
import { z } from 'zod';

/** One PDF operand in [0, 1]: `0`, `1`, `0.25`, `1.0` — no sign, no exponent (the engine's own grammar). */
const UNIT_OPERAND = '(?:0(?:\\.\\d+)?|1(?:\\.0+)?)';

/** `"C M Y K"`: exactly four operands, single spaces. */
export const CMYK_STRING_PATTERN = `^${UNIT_OPERAND}(?: ${UNIT_OPERAND}){3}$`;
const CMYK_STRING_RE = new RegExp(CMYK_STRING_PATTERN);

export const CMYK_STRING_SCHEMA = {
    type: 'string',
    pattern: CMYK_STRING_PATTERN,
    description: "DeviceCMYK operands 'C M Y K', each 0.0–1.0.",
} as const;

export const CMYK_TUPLE_SCHEMA = {
    type: 'array',
    items: { type: 'number', minimum: 0, maximum: 100 },
    minItems: 4,
    maxItems: 4,
    description: 'DeviceCMYK ink percentages [c, m, y, k], each 0–100.',
} as const;

const percent = z.number().min(0).max(100);
export const CmykStringSchema = z.string().regex(CMYK_STRING_RE);
export const CmykTupleSchema = z.tuple([percent, percent, percent, percent]);

/**
 * JSON Schema for a colour property: the tool's historical member first
 * (verbatim), then the CMYK string and tuple.
 */
export function colorSchema<L extends object>(legacy: L, description: string): { readonly anyOf: readonly [L, typeof CMYK_STRING_SCHEMA, typeof CMYK_TUPLE_SCHEMA]; readonly description: string } {
    return { anyOf: [legacy, CMYK_STRING_SCHEMA, CMYK_TUPLE_SCHEMA], description };
}

/**
 * Same, for a property whose historical member is an unconstrained string:
 * it already admits `'C M Y K'`, so only the tuple is added (a second string
 * member would make the two indistinguishable).
 */
export function freeStringColorSchema<L extends object>(legacy: L, description: string): { readonly anyOf: readonly [L, typeof CMYK_TUPLE_SCHEMA]; readonly description: string } {
    return { anyOf: [legacy, CMYK_TUPLE_SCHEMA], description };
}

/** Zod twin of {@link colorSchema}. */
export function colorZod<T extends z.ZodType>(legacy: T): z.ZodUnion<[T, typeof CmykStringSchema, typeof CmykTupleSchema]> {
    return z.union([legacy, CmykStringSchema, CmykTupleSchema]);
}

/** Zod twin of {@link freeStringColorSchema}. */
export function freeStringColorZod<T extends z.ZodType>(legacy: T): z.ZodUnion<[T, typeof CmykTupleSchema]> {
    return z.union([legacy, CmykTupleSchema]);
}

/** A value any colour property of this server can carry after validation. */
export type ColorInput = string | readonly number[];

/** Operand formatting: at most four decimals, never an exponent (the engine rejects `1e-7`). */
function operand(value: number): string {
    return String(Number(value.toFixed(4)));
}

/**
 * Translate a validated colour into what the engine expects.
 *
 *   - string          → unchanged (hex, RGB operands, CMYK operands)
 *   - four numbers    → unchanged (CMYK percent tuple)
 *   - three numbers   → the documented 0.0–1.0 triple becomes the operand
 *                       string 'R G B'. A triple with a component above 1
 *                       cannot be 0.0–1.0; it is handed over as the engine's
 *                       0–255 tuple, which is how it has always been read.
 */
export function toEngineColor(value: ColorInput): PdfColor {
    if (typeof value === 'string') return value;
    if (value.length === 4) return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 0];
    const [r = 0, g = 0, b = 0] = value;
    if (r > 1 || g > 1 || b > 1) return [r, g, b];
    return `${operand(r)} ${operand(g)} ${operand(b)}`;
}
