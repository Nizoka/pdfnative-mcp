/**
 * Shared typography fragment — pdfnative >= 1.8 `layout.typography`.
 *
 * One opt-in object on every document tool (and on inspect_layout, because it
 * moves blocks). Every key is off by default, so a call that omits
 * `typography` builds exactly what it built before.
 *
 * What a JSON boundary cannot carry, and is therefore NOT exposed:
 *   - `setHyphenationProvider()` is a function seam. No dictionary ships with
 *     the engine and none is installed here, so automatic hyphenation is not
 *     available: `hyphenationLanguage` is recorded for a provider that does not
 *     exist on this server. Soft hyphens (U+00AD) in the text ARE honoured.
 *
 * Engine facts worth stating in the schema, because an agent cannot guess them:
 *   - `kerning`, `fontFeatures` and the `'fr'` narrow no-break space need an
 *     embedded font (`embedFonts: true`, or add_international_text); base-14
 *     Helvetica has no GPOS / GSUB and no U+202F, and degrades to `'fr-CA'`.
 *   - `metrics: 'exact'` acts on base-14 text only.
 *   - `tnum` / `lnum` change nothing on the bundled Noto Sans (its default
 *     figures already are tabular and lining) → TYPOGRAPHY_FEATURE_INEFFECTIVE.
 */
import type { TypographyOptions } from 'pdfnative';
import { z } from 'zod';

/** OpenType single-substitution features the engine applies (src/fonts/font-features.ts). */
export const FONT_FEATURE_TAGS = ['tnum', 'pnum', 'lnum', 'onum', 'zero', 'ordn', 'sups', 'subs', 'smcp', 'c2sc', 'case'] as const;
export const PUNCTUATION_PRESETS = ['fr', 'fr-CA'] as const;
export const BASE14_METRICS = ['approximate', 'exact'] as const;

/** BCP 47, loosely: a 2–3 letter primary subtag, then 2–8 alphanumeric subtags. */
const LANGUAGE_TAG_PATTERN = '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$';
const LANGUAGE_TAG_RE = new RegExp(LANGUAGE_TAG_PATTERN);

const SHORT_TOKEN = { type: 'string', minLength: 1, maxLength: 16 } as const;
const LINE_QUOTA = { type: 'integer', minimum: 1, maximum: 10 } as const;

const PUNCTUATION_RULE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['char', 'side', 'space'],
    properties: {
        char: { type: 'string', minLength: 1, maxLength: 2 },
        side: { type: 'string', enum: ['before', 'after'] },
        space: { type: 'string', enum: ['nbsp', 'narrow'], description: "U+00A0 / U+202F (narrow needs embedFonts)." },
    },
} as const;

/**
 * The `typography` property — spread into a tool's `properties` through the
 * layout fragment. It is inlined in ten tools, so descriptions are terse; the
 * `typography` prompt and docs/guides/TYPOGRAPHY.md carry the long form.
 */
export const TYPOGRAPHY_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    description:
        "Fine typography, all opt-in (omitted = unchanged bytes). kerning, fontFeatures and the 'fr' narrow space need embedFonts:true. No hyphenation dictionary is installed: use soft hyphens (U+00AD). See the typography prompt.",
    properties: {
        splitParagraphs: { type: 'boolean', description: 'Paragraphs may break across pages at a line boundary (default: atomic).' },
        orphans: { ...LINE_QUOTA, description: 'Min lines left at a page foot (default 2; needs splitParagraphs).' },
        widows: { ...LINE_QUOTA, description: 'Min lines carried over (default 2; needs splitParagraphs).' },
        keepHeadingsWithNext: {
            anyOf: [{ type: 'boolean' }, { type: 'object', additionalProperties: false, properties: { minLines: LINE_QUOTA } }],
            description: 'Never strand a heading at a page foot. true = { minLines: 2 }.',
        },
        unitBinding: {
            anyOf: [{ type: 'boolean' }, { type: 'object', additionalProperties: false, properties: { units: { type: 'array', maxItems: 100, items: SHORT_TOKEN } } }],
            description: "No-break space between a number and its unit ('150 €', '12 kg'); units replaces the built-in list.",
        },
        bindShortWords: {
            anyOf: [
                { type: 'boolean' },
                { type: 'object', additionalProperties: false, properties: { maxLength: { type: 'integer', minimum: 1, maximum: 3 }, words: { type: 'array', maxItems: 100, items: SHORT_TOKEN } } },
            ],
            description: "Never end a line on a short word: up to maxLength letters (default 1), or exactly the listed words.",
        },
        punctuationSpacing: {
            anyOf: [{ type: 'string', enum: [...PUNCTUATION_PRESETS] }, { type: 'array', maxItems: 32, items: PUNCTUATION_RULE_SCHEMA }],
            description: "No-break spaces next to punctuation (existing spaces only). 'fr': narrow before ; ! ?, no-break before ':' and inside « ». 'fr-CA': ':' and « » only. Or explicit rules.",
        },
        opticalMargins: { type: 'boolean', description: "Hang punctuation into the margin of align:'justify' text." },
        metrics: { type: 'string', enum: [...BASE14_METRICS], description: "Base-14 text: 'exact' uses the AFM widths (different wraps). Default 'approximate'." },
        fontFeatures: {
            type: 'array',
            maxItems: FONT_FEATURE_TAGS.length,
            uniqueItems: true,
            items: { type: 'string', enum: [...FONT_FEATURE_TAGS] },
            description: 'OpenType features, later wins. tnum / lnum are no-ops on Noto Sans (TYPOGRAPHY_FEATURE_INEFFECTIVE).',
        },
        kerning: { type: 'boolean', description: 'Pair kerning (GPOS).' },
        hyphenationLanguage: { type: 'string', maxLength: 35, pattern: LANGUAGE_TAG_PATTERN, description: 'BCP 47 tag; no effect here (no hyphenation provider installed).' },
    },
} as const;

const lineQuota = z.number().int().min(1).max(10);
const shortToken = z.string().min(1).max(16);

const PunctuationRuleSchema = z.strictObject({
    char: z.string().min(1).max(2),
    side: z.enum(['before', 'after']),
    space: z.enum(['nbsp', 'narrow']),
});

/** Zod counterpart of {@link TYPOGRAPHY_INPUT_SCHEMA}. */
export const TypographySchema = z.strictObject({
    splitParagraphs: z.boolean().optional(),
    orphans: lineQuota.optional(),
    widows: lineQuota.optional(),
    keepHeadingsWithNext: z.union([z.boolean(), z.strictObject({ minLines: lineQuota.optional() })]).optional(),
    unitBinding: z.union([z.boolean(), z.strictObject({ units: z.array(shortToken).max(100).optional() })]).optional(),
    bindShortWords: z
        .union([z.boolean(), z.strictObject({ maxLength: z.number().int().min(1).max(3).optional(), words: z.array(shortToken).max(100).optional() })])
        .optional(),
    punctuationSpacing: z.union([z.enum(PUNCTUATION_PRESETS), z.array(PunctuationRuleSchema).max(32)]).optional(),
    opticalMargins: z.boolean().optional(),
    metrics: z.enum(BASE14_METRICS).optional(),
    fontFeatures: z
        .array(z.enum(FONT_FEATURE_TAGS))
        .max(FONT_FEATURE_TAGS.length)
        .refine((tags) => new Set(tags).size === tags.length, { message: 'fontFeatures must not repeat a tag.' })
        .optional(),
    kerning: z.boolean().optional(),
    hyphenationLanguage: z.string().max(35).regex(LANGUAGE_TAG_RE).optional(),
});

export type TypographyInput = z.infer<typeof TypographySchema>;

/** Every key of the engine's `TypographyOptions`, as exposed here (tests hold the two lists together). */
export const TYPOGRAPHY_KEYS = Object.keys(TYPOGRAPHY_INPUT_SCHEMA.properties) as ReadonlyArray<keyof typeof TYPOGRAPHY_INPUT_SCHEMA.properties>;

/**
 * Map the validated input to the engine option. Only the keys the caller set
 * are emitted, and an empty object is dropped, so an absent or empty
 * `typography` leaves the engine defaults — and the output bytes — untouched.
 */
export function toTypographyOptions(input: TypographyInput | undefined): TypographyOptions | undefined {
    if (input === undefined) return undefined;
    const out: { -readonly [K in keyof TypographyOptions]: TypographyOptions[K] } = {};
    if (input.splitParagraphs !== undefined) out.splitParagraphs = input.splitParagraphs;
    if (input.orphans !== undefined) out.orphans = input.orphans;
    if (input.widows !== undefined) out.widows = input.widows;
    if (input.keepHeadingsWithNext !== undefined) {
        const k = input.keepHeadingsWithNext;
        out.keepHeadingsWithNext = typeof k === 'boolean' ? k : { ...(k.minLines !== undefined ? { minLines: k.minLines } : {}) };
    }
    if (input.unitBinding !== undefined) {
        const u = input.unitBinding;
        out.unitBinding = typeof u === 'boolean' ? u : { ...(u.units !== undefined ? { units: u.units } : {}) };
    }
    if (input.bindShortWords !== undefined) {
        const b = input.bindShortWords;
        out.bindShortWords = typeof b === 'boolean' ? b : { ...(b.maxLength !== undefined ? { maxLength: b.maxLength } : {}), ...(b.words !== undefined ? { words: b.words } : {}) };
    }
    if (input.punctuationSpacing !== undefined) out.punctuationSpacing = input.punctuationSpacing;
    if (input.opticalMargins !== undefined) out.opticalMargins = input.opticalMargins;
    if (input.metrics !== undefined) out.metrics = input.metrics;
    if (input.fontFeatures !== undefined) out.fontFeatures = input.fontFeatures;
    if (input.kerning !== undefined) out.kerning = input.kerning;
    if (input.hyphenationLanguage !== undefined) out.hyphenationLanguage = input.hyphenationLanguage;
    return Object.keys(out).length > 0 ? out : undefined;
}
