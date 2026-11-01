/**
 * Shared colour fragment: DeviceCMYK on every colour input (pdfnative >= 1.8),
 * spot colours and ink mixes (pdfnative >= 1.9).
 *
 * The engine takes a colour in seven forms and reads the space from the
 * component count — three is DeviceRGB, four is DeviceCMYK — or from the
 * object shape:
 *   - hex string            '#2563eb'
 *   - RGB operand string    '0.145 0.388 0.922'   (0.0–1.0)
 *   - RGB tuple             [37, 99, 235]         (0–255)
 *   - CMYK operand string   '1 0.6 0 0.1'         (0.0–1.0)
 *   - CMYK tuple            [100, 60, 0, 10]      (percent, 0–100)
 *   - spot colour           { spot: 'PANTONE 300 C', tint: 0.5 }   (/Separation)
 *   - ink mix               { inks: { 'PANTONE 300 C': 1, Varnish: 0.3 } }   (/DeviceN)
 * The two object forms name inks declared in `print.spotColours`; the engine
 * refuses an undeclared ink by name (mapped to VALIDATION_ERROR).
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

/** Ink name as declared in `print.spotColours` — `'PANTONE 300 C'`, `'Varnish'`. */
const INK_NAME = { type: 'string', minLength: 1, maxLength: 100 } as const;
const InkName = z.string().min(1).max(100);
const tint = z.number().min(0).max(1);

/**
 * Spot colour (pdfnative 1.9.0): one ink declared in `print.spotColours`,
 * painted at `tint` (0–1, default 1) — a `/Separation` colour space named
 * after the ink, with the declared alternate for proofing.
 */
export const SPOT_COLOR_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['spot'],
    properties: {
        spot: INK_NAME,
        tint: { type: 'number', minimum: 0, maximum: 1 },
    },
    // Terse on purpose: this member is inlined at every colour site of the catalogue
    // (tools/list budget); the long form is on print.spotColours and in the guide.
    description: 'Spot ink of print.spotColours, tint 0–1.',
} as const;

/**
 * Ink mix (pdfnative 1.9.0): several declared spot inks, each at a tint 0–1 —
 * a `/DeviceN` colour space over those inks.
 */
export const INK_MIX_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['inks'],
    properties: {
        inks: {
            type: 'object',
            minProperties: 1,
            maxProperties: 8,
            additionalProperties: { type: 'number', minimum: 0, maximum: 1 },
        },
    },
    description: 'Mix of spot inks (name → tint).',
} as const;

export const SpotColorSchema = z.strictObject({ spot: InkName, tint: tint.optional() });
export const InkMixSchema = z.strictObject({
    inks: z.record(InkName, tint).refine((inks) => {
        const n = Object.keys(inks).length;
        return n >= 1 && n <= 8;
    }, { message: 'inks needs 1 to 8 declared inks.' }),
});

/**
 * JSON Schema for a colour property: the tool's historical member first
 * (verbatim), then the CMYK string and tuple, then the spot colour and the
 * ink mix (1.9.0).
 */
export function colorSchema<L extends object>(
    legacy: L,
    description: string,
): { readonly anyOf: readonly [L, typeof CMYK_STRING_SCHEMA, typeof CMYK_TUPLE_SCHEMA, typeof SPOT_COLOR_SCHEMA, typeof INK_MIX_SCHEMA]; readonly description: string } {
    return { anyOf: [legacy, CMYK_STRING_SCHEMA, CMYK_TUPLE_SCHEMA, SPOT_COLOR_SCHEMA, INK_MIX_SCHEMA], description };
}

/**
 * Same, for a property whose historical member is an unconstrained string:
 * it already admits `'C M Y K'`, so only the tuple and the two spot forms
 * are added (a second string member would make the two indistinguishable).
 */
export function freeStringColorSchema<L extends object>(
    legacy: L,
    description: string,
): { readonly anyOf: readonly [L, typeof CMYK_TUPLE_SCHEMA, typeof SPOT_COLOR_SCHEMA, typeof INK_MIX_SCHEMA]; readonly description: string } {
    return { anyOf: [legacy, CMYK_TUPLE_SCHEMA, SPOT_COLOR_SCHEMA, INK_MIX_SCHEMA], description };
}

/** Zod twin of {@link colorSchema}. */
export function colorZod<T extends z.ZodType>(legacy: T): z.ZodUnion<[T, typeof CmykStringSchema, typeof CmykTupleSchema, typeof SpotColorSchema, typeof InkMixSchema]> {
    return z.union([legacy, CmykStringSchema, CmykTupleSchema, SpotColorSchema, InkMixSchema]);
}

/** Zod twin of {@link freeStringColorSchema}. */
export function freeStringColorZod<T extends z.ZodType>(legacy: T): z.ZodUnion<[T, typeof CmykTupleSchema, typeof SpotColorSchema, typeof InkMixSchema]> {
    return z.union([legacy, CmykTupleSchema, SpotColorSchema, InkMixSchema]);
}

/** A spot colour or ink mix after validation (object forms, passed to the engine as-is). */
export type SpotColorInput = z.infer<typeof SpotColorSchema> | z.infer<typeof InkMixSchema>;

/** A value any colour property of this server can carry after validation. */
export type ColorInput = string | readonly number[] | SpotColorInput;

/** Operand formatting: at most four decimals, never an exponent (the engine rejects `1e-7`). */
function operand(value: number): string {
    return String(Number(value.toFixed(4)));
}

/**
 * Translate a validated colour into what the engine expects.
 *
 *   - string          → unchanged (hex, RGB operands, CMYK operands)
 *   - object          → unchanged ({ spot, tint } or { inks }; the engine
 *                       refuses an ink that print.spotColours does not declare)
 *   - four numbers    → unchanged (CMYK percent tuple)
 *   - three numbers   → the documented 0.0–1.0 triple becomes the operand
 *                       string 'R G B'. A triple with a component above 1
 *                       cannot be 0.0–1.0; it is handed over as the engine's
 *                       0–255 tuple, which is how it has always been read.
 */
export function toEngineColor(value: ColorInput): PdfColor {
    if (typeof value === 'string') return value;
    if (!Array.isArray(value)) {
        const spot = value as SpotColorInput;
        if ('spot' in spot) return spot.tint !== undefined ? { spot: spot.spot, tint: spot.tint } : { spot: spot.spot };
        return { inks: { ...spot.inks } };
    }
    if (value.length === 4) return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 0];
    const [r = 0, g = 0, b = 0] = value;
    if (r > 1 || g > 1 || b > 1) return [r, g, b];
    return `${operand(r)} ${operand(g)} ${operand(b)}`;
}
