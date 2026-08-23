/**
 * Shared watermark schema + mapping for the document-producing tools.
 *
 * Exposes a single opt-in `watermark` input that maps to pdfnative's
 * `WatermarkOptions`: a rotated text watermark (`text`, since v1.2.0), an
 * image watermark (`image`, JPEG / PNG, since v1.6.0), or both together —
 * exactly the engine's contract ("provide either `text` or `image`, or both").
 * `position` picks whether the watermark is painted behind or above the page
 * content.
 *
 * Note: PDF/A-1b forbids transparency (ISO 19005-1 §6.4); an `opacity < 1.0`
 * watermark (text or image, including the 0.15 / 0.10 defaults) combined with
 * `pdfA: 'pdfa1b'` is rejected up-front by {@link assertWatermarkPdfACompatible}
 * with a stable `PDF_A_COMPLIANCE_VIOLATION` code, rather than surfacing
 * pdfnative's opaque throw.
 */
import { z } from 'zod';
import type { WatermarkImage, WatermarkOptions, WatermarkText } from 'pdfnative';
import { ToolError } from './errors.js';
import { IMAGE_BASE64_MAX_CHARS, decodeImageBase64 } from './image.js';

/** Default text-watermark opacity applied by pdfnative when `opacity` is omitted. */
const DEFAULT_WATERMARK_OPACITY = 0.15;
/** Default image-watermark opacity applied by pdfnative when `opacity` is omitted. */
const DEFAULT_IMAGE_WATERMARK_OPACITY = 0.1;
/** Upper bound on the decoded watermark image (keeps the per-page XObject bounded). */
const MAX_WATERMARK_IMAGE_BYTES = 8 * 1024 * 1024;

const MIME_TYPES = ['image/jpeg', 'image/png'] as const;

/** JSON-Schema fragment for the optional `watermark` property (text and/or image). */
export const WATERMARK_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    description:
        "Optional semi-transparent watermark rendered centred on every page: `text` (e.g. 'DRAFT'), `image` (JPEG/PNG), or both combined. At least one of text / image is required. opacity < 1.0 (text or image, including the defaults) is rejected under pdfA='pdfa1b' (ISO 19005-1 forbids transparency).",
    properties: {
        text: {
            type: 'string',
            minLength: 1,
            maxLength: 100,
            description: 'Watermark text. Optional when `image` is given.',
        },
        fontSize: {
            type: 'number',
            minimum: 6,
            maximum: 300,
            description: 'Text font size in points. Default 60, auto-fit to the page.',
        },
        opacity: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Text opacity 0.0–1.0. Default 0.15. (Image opacity is image.opacity.)',
        },
        angle: {
            type: 'number',
            minimum: -360,
            maximum: 360,
            description: 'Text rotation in degrees (counterclockwise). Default -45.',
        },
        color: {
            type: 'array',
            items: { type: 'number', minimum: 0, maximum: 1 },
            minItems: 3,
            maxItems: 3,
            description: 'Text RGB colour as a [r, g, b] triple in the 0.0–1.0 range. Default light gray [0.75, 0.75, 0.75].',
        },
        image: {
            type: 'object',
            additionalProperties: false,
            required: ['imageBase64', 'mimeType'],
            description:
                'Image watermark (JPEG or PNG) centred on every page, optionally combined with `text`. Bytes are validated against the JPEG/PNG magic numbers; mimeType must match.',
            properties: {
                imageBase64: {
                    type: 'string',
                    minLength: 4,
                    maxLength: IMAGE_BASE64_MAX_CHARS,
                    description: 'Base64-encoded JPEG or 8-bit opaque PNG bytes (max 8 MiB decoded; alpha-channel, palette and interlaced PNGs are rejected with a remedy). Plain base64, no data: URI prefix.',
                },
                mimeType: {
                    type: 'string',
                    enum: [...MIME_TYPES],
                    description: "'image/jpeg' or 'image/png' — must match the actual bytes.",
                },
                opacity: {
                    type: 'number',
                    minimum: 0,
                    maximum: 1,
                    description: 'Image opacity 0.0–1.0. Default 0.10.',
                },
                width: {
                    type: 'number',
                    exclusiveMinimum: 0,
                    maximum: 14400,
                    description: 'Display width in points (default: from the image pixel size).',
                },
                height: {
                    type: 'number',
                    exclusiveMinimum: 0,
                    maximum: 14400,
                    description: 'Display height in points (default: from the image pixel size).',
                },
            },
        },
        position: {
            type: 'string',
            enum: ['background', 'foreground'],
            default: 'background',
            description: "'background' (behind page content, default) or 'foreground' (above it). Applies to text and image alike.",
        },
    },
} as const;

const unitInterval = z.number().min(0).max(1);

const WatermarkImageSchema = z.strictObject({
    imageBase64: z.string().min(4).max(IMAGE_BASE64_MAX_CHARS),
    mimeType: z.enum(MIME_TYPES),
    opacity: unitInterval.optional(),
    width: z.number().gt(0).max(14400).optional(),
    height: z.number().gt(0).max(14400).optional(),
});

/** Zod validator mirroring {@link WATERMARK_INPUT_SCHEMA}. */
export const WatermarkSchema = z
    .strictObject({
        text: z.string().min(1).max(100).optional(),
        fontSize: z.number().min(6).max(300).optional(),
        opacity: unitInterval.optional(),
        angle: z.number().min(-360).max(360).optional(),
        color: z.tuple([unitInterval, unitInterval, unitInterval]).optional(),
        image: WatermarkImageSchema.optional(),
        position: z.enum(['background', 'foreground']).optional(),
    })
    .refine((w) => w.text !== undefined || w.image !== undefined, {
        message: 'watermark requires at least one of `text` or `image`.',
    });

export type WatermarkInput = z.infer<typeof WatermarkSchema>;

/**
 * Reject the one PDF/A-incompatible watermark combination *before* handing it to
 * pdfnative, so callers get a stable `ToolError` code instead of an opaque library
 * throw. PDF/A-1b (ISO 19005-1 §6.4) forbids transparency, so a semi-transparent
 * watermark (`opacity < 1.0`, including the 0.15 text / 0.10 image defaults)
 * cannot coexist with `pdfA: 'pdfa1b'`. PDF/A-2b and PDF/A-3b permit transparency
 * and are unaffected.
 */
export function assertWatermarkPdfACompatible(
    watermark: WatermarkInput | undefined,
    pdfA: string | undefined,
): void {
    if (watermark === undefined || pdfA !== 'pdfa1b') return;
    const textOpaque = watermark.text === undefined || (watermark.opacity ?? DEFAULT_WATERMARK_OPACITY) >= 1;
    const imageOpaque = watermark.image === undefined || (watermark.image.opacity ?? DEFAULT_IMAGE_WATERMARK_OPACITY) >= 1;
    if (!textOpaque || !imageOpaque) {
        throw new ToolError(
            'PDF_A_COMPLIANCE_VIOLATION',
            "Watermark opacity < 1.0 is not permitted under pdfA='pdfa1b' (ISO 19005-1 §6.4 forbids transparency). Set watermark.opacity (and watermark.image.opacity) to 1.0, or target pdfA='pdfa2b'/'pdfa3b' which allow transparency.",
        );
    }
}

/**
 * Decode and validate the watermark image at the boundary: base64 → bytes,
 * size bound, and the magic number must agree with the declared `mimeType`
 * (so a PNG mislabelled as JPEG fails with a coded error instead of an engine throw).
 */
export function decodeWatermarkImage(image: NonNullable<WatermarkInput['image']>): Uint8Array {
    const bytes = decodeImageBase64(image.imageBase64, image.mimeType, 'watermark.image.imageBase64');
    if (bytes.length > MAX_WATERMARK_IMAGE_BYTES) {
        throw new ToolError('VALIDATION_ERROR', `watermark.image.imageBase64 decodes to ${bytes.length} bytes; the limit is ${MAX_WATERMARK_IMAGE_BYTES} bytes.`);
    }
    return bytes;
}

/** Map a validated `watermark` input to pdfnative's `WatermarkOptions`. */
export function toWatermarkOptions(input: WatermarkInput): WatermarkOptions {
    const options: { -readonly [K in keyof WatermarkOptions]: WatermarkOptions[K] } = {};
    if (input.text !== undefined) {
        const text: { -readonly [K in keyof WatermarkText]: WatermarkText[K] } = { text: input.text };
        if (input.fontSize !== undefined) text.fontSize = input.fontSize;
        if (input.opacity !== undefined) text.opacity = input.opacity;
        if (input.angle !== undefined) text.angle = input.angle;
        if (input.color !== undefined) text.color = input.color;
        options.text = text;
    }
    if (input.image !== undefined) {
        const image: { -readonly [K in keyof WatermarkImage]: WatermarkImage[K] } = { data: decodeWatermarkImage(input.image) };
        if (input.image.opacity !== undefined) image.opacity = input.image.opacity;
        if (input.image.width !== undefined) image.width = input.image.width;
        if (input.image.height !== undefined) image.height = input.image.height;
        options.image = image;
    }
    if (input.position !== undefined) options.position = input.position;
    return options;
}
