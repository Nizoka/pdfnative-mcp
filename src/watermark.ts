/**
 * Shared text-watermark schema + mapping for the document-producing tools.
 *
 * Exposes a single opt-in `watermark` input (text only in v1.2.0) that maps to
 * pdfnative's `WatermarkOptions`. Image watermarks are intentionally out of
 * scope for this release.
 *
 * Note: PDF/A-1b forbids transparency (ISO 19005-1 §6.4); a `opacity < 1.0`
 * watermark combined with `tagged: 'pdfa1b'` is rejected up-front by
 * {@link assertWatermarkPdfACompatible} with a stable `PDF_A_COMPLIANCE_VIOLATION`
 * code, rather than surfacing pdfnative's opaque throw.
 */
import { z } from 'zod';
import type { WatermarkOptions, WatermarkText } from 'pdfnative';
import { ToolError } from './errors.js';

/** Default watermark opacity applied by pdfnative when `opacity` is omitted. */
const DEFAULT_WATERMARK_OPACITY = 0.15;

/** JSON-Schema fragment for the optional `watermark` property (text watermark). */
export const WATERMARK_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    description:
        "Optional semi-transparent text watermark rendered on every page (e.g. 'DRAFT', 'CONFIDENTIAL'). Text only in this version. opacity < 1.0 is rejected under pdfA='pdfa1b' (ISO 19005-1 forbids transparency).",
    properties: {
        text: {
            type: 'string',
            minLength: 1,
            maxLength: 100,
            description: 'Watermark text.',
        },
        fontSize: {
            type: 'number',
            minimum: 6,
            maximum: 300,
            description: 'Font size in points. Default 60, auto-fit to the page.',
        },
        opacity: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Opacity 0.0–1.0. Default 0.15.',
        },
        angle: {
            type: 'number',
            minimum: -360,
            maximum: 360,
            description: 'Rotation in degrees (counterclockwise). Default -45.',
        },
        color: {
            type: 'array',
            items: { type: 'number', minimum: 0, maximum: 1 },
            minItems: 3,
            maxItems: 3,
            description: 'RGB colour as a [r, g, b] triple in the 0.0–1.0 range. Default light gray [0.75, 0.75, 0.75].',
        },
        position: {
            type: 'string',
            enum: ['background', 'foreground'],
            default: 'background',
            description: "'background' (behind page content, default) or 'foreground' (above it).",
        },
    },
} as const;

/** Zod validator mirroring {@link WATERMARK_INPUT_SCHEMA}. */
export const WatermarkSchema = z.object({
    text: z.string().min(1).max(100),
    fontSize: z.number().min(6).max(300).optional(),
    opacity: z.number().min(0).max(1).optional(),
    angle: z.number().min(-360).max(360).optional(),
    color: z
        .tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)])
        .optional(),
    position: z.enum(['background', 'foreground']).optional(),
});

export type WatermarkInput = z.infer<typeof WatermarkSchema>;

/**
 * Reject the one PDF/A-incompatible watermark combination *before* handing it to
 * pdfnative, so callers get a stable `ToolError` code instead of an opaque library
 * throw. PDF/A-1b (ISO 19005-1 §6.4) forbids transparency, so a semi-transparent
 * watermark (`opacity < 1.0`, including the 0.15 default) cannot coexist with
 * `pdfA: 'pdfa1b'`. PDF/A-2b and PDF/A-3b permit transparency and are unaffected.
 */
export function assertWatermarkPdfACompatible(
    watermark: WatermarkInput | undefined,
    pdfA: string | undefined,
): void {
    if (watermark === undefined || pdfA !== 'pdfa1b') return;
    const opacity = watermark.opacity ?? DEFAULT_WATERMARK_OPACITY;
    if (opacity < 1) {
        throw new ToolError(
            'PDF_A_COMPLIANCE_VIOLATION',
            "Watermark opacity < 1.0 is not permitted under pdfA='pdfa1b' (ISO 19005-1 §6.4 forbids transparency). Set watermark.opacity to 1.0, or target pdfA='pdfa2b'/'pdfa3b' which allow transparency.",
        );
    }
}

/** Map a validated `watermark` input to pdfnative's `WatermarkOptions`. */
export function toWatermarkOptions(input: WatermarkInput): WatermarkOptions {
    const text: { -readonly [K in keyof WatermarkText]: WatermarkText[K] } = { text: input.text };
    if (input.fontSize !== undefined) text.fontSize = input.fontSize;
    if (input.opacity !== undefined) text.opacity = input.opacity;
    if (input.angle !== undefined) text.angle = input.angle;
    if (input.color !== undefined) text.color = input.color;
    const options: { -readonly [K in keyof WatermarkOptions]: WatermarkOptions[K] } = { text };
    if (input.position !== undefined) options.position = input.position;
    return options;
}
