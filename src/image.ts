/**
 * Shared raster-image fragment used by `embed_image`, the `image` block of
 * `generate_basic_pdf` and image watermarks: base64 boundary decoding with
 * magic-byte verification against the declared MIME type, plus the per-call
 * byte budget that keeps a single `tools/call` from inflating memory through
 * many embedded pictures.
 */
import { z } from 'zod';

import { decodeBase64Field } from './base64.js';
import { ToolError } from './errors.js';

export const IMAGE_MIME_ENUM = ['image/jpeg', 'image/png'] as const;
export type ImageMime = (typeof IMAGE_MIME_ENUM)[number];

/** Longest accepted base64 payload for one image (≈ 9 MiB decoded). */
export const IMAGE_BASE64_MAX_CHARS = 12_000_000;
/** Decoded bytes a single call may embed across all its images (24 MiB). */
export const IMAGE_BYTE_BUDGET = 24 * 1024 * 1024;

/**
 * JSON Schema properties of an image payload. `embed_image` (1.5.0 contract)
 * never bounded the base64 length, so the unbounded form is the base; the
 * inline `image` block and watermark images add the per-field cap (they can
 * appear many times per call and feed the per-call byte budget).
 */
export const IMAGE_PAYLOAD_PROPERTIES = {
    imageBase64: {
        type: 'string',
        minLength: 4,
        description: 'Base64 image bytes. JPEG (baseline; 1, 3 or 4 components — CMYK raises PDFA_DEVICE_CMYK_IMAGE under PDF/A) or PNG (8-bit greyscale/RGB, non-interlaced; alpha-channel and palette PNGs are rejected with a remedy). No data: URI.',
    },
    mimeType: {
        type: 'string',
        enum: [...IMAGE_MIME_ENUM],
        description: 'MIME type of the image. Must match the actual encoding of imageBase64 (magic bytes are checked).',
    },
} as const;

/** Zod counterpart of {@link IMAGE_PAYLOAD_PROPERTIES}. */
export const ImagePayloadShape = {
    imageBase64: z.string().min(4),
    mimeType: z.enum(IMAGE_MIME_ENUM),
} as const;

/** Bounded variant for inline blocks / watermarks (≤ {@link IMAGE_BASE64_MAX_CHARS} characters). */
export const BOUNDED_IMAGE_PAYLOAD_PROPERTIES = {
    imageBase64: { ...IMAGE_PAYLOAD_PROPERTIES.imageBase64, maxLength: IMAGE_BASE64_MAX_CHARS },
    mimeType: IMAGE_PAYLOAD_PROPERTIES.mimeType,
} as const;

export const BoundedImagePayloadShape = {
    imageBase64: z.string().min(4).max(IMAGE_BASE64_MAX_CHARS),
    mimeType: z.enum(IMAGE_MIME_ENUM),
} as const;

/**
 * Decode a base64 image and verify its magic bytes against `mimeType`.
 * `field` names the input in error messages (e.g. `blocks[3].imageBase64`).
 */
export function decodeImageBase64(imageBase64: string, mimeType: ImageMime, field = 'imageBase64'): Uint8Array {
    const bytes = decodeBase64Field(imageBase64, field);
    if (bytes.length < 8) {
        throw new ToolError('VALIDATION_ERROR', `${field} decodes to ${bytes.length} byte(s) — too small to be a JPEG or PNG.`);
    }
    if (mimeType === 'image/jpeg') {
        if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
            throw new ToolError('VALIDATION_ERROR', `${field} does not match mimeType 'image/jpeg' (missing JPEG magic bytes FF D8).`);
        }
    } else if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
        throw new ToolError('VALIDATION_ERROR', `${field} does not match mimeType 'image/png' (missing PNG magic bytes 89 50 4E 47).`);
    } else {
        assertPngSupported(bytes, field);
    }
    return bytes;
}

/**
 * The engine's PNG decoder (pdfnative parsePNG) accepts 8-bit, non-interlaced,
 * greyscale or RGB images only. Read the IHDR chunk (always first, fixed
 * layout: width, height, bit depth, colour type, compression, filter,
 * interlace) so the unsupported variants fail here with a remedy instead of
 * surfacing as an opaque GENERATION_FAILED.
 */
function assertPngSupported(bytes: Uint8Array, field: string): void {
    // 8-byte signature + 4-byte length + 'IHDR' + 13 data bytes.
    if (bytes.length < 29 || bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return; // let the engine report a malformed file
    const bitDepth = bytes[24];
    const colourType = bytes[25];
    const interlace = bytes[28];
    if (colourType === 4 || colourType === 6) {
        throw new ToolError('VALIDATION_ERROR', `${field}: PNG with an alpha channel (colour type ${colourType}) is not supported — flatten the transparency onto a background (or export as JPEG / opaque PNG) and retry.`);
    }
    if (colourType === 3) {
        throw new ToolError('VALIDATION_ERROR', `${field}: palette (indexed-colour) PNG is not supported — re-export as 8-bit RGB or greyscale PNG, or as JPEG.`);
    }
    if (bitDepth !== 8) {
        throw new ToolError('VALIDATION_ERROR', `${field}: PNG bit depth ${bitDepth} is not supported — re-export as 8-bit PNG.`);
    }
    if (interlace !== 0) {
        throw new ToolError('VALIDATION_ERROR', `${field}: interlaced (Adam7) PNG is not supported — re-export without interlacing.`);
    }
}

/** Running total of decoded image bytes for one call; throws once the budget is exceeded. */
export class ImageByteBudget {
    private used = 0;

    constructor(private readonly limit = IMAGE_BYTE_BUDGET) {}

    add(bytes: Uint8Array, field: string): void {
        this.used += bytes.length;
        if (this.used > this.limit) {
            throw new ToolError(
                'VALIDATION_ERROR',
                `${field}: the images of this call total ${this.used} decoded bytes, over the ${this.limit}-byte budget (${Math.round(this.limit / 1024 / 1024)} MiB). Downscale or split the document.`,
            );
        }
    }
}
