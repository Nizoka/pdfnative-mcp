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

/** JSON Schema properties of an image payload (spread into a tool or block schema). */
export const IMAGE_PAYLOAD_PROPERTIES = {
    imageBase64: {
        type: 'string',
        minLength: 4,
        maxLength: IMAGE_BASE64_MAX_CHARS,
        description: 'Base64 image bytes. JPEG (baseline, 1/3/4 components) or PNG (8-bit, non-interlaced, no palette). No data: URI.',
    },
    mimeType: {
        type: 'string',
        enum: [...IMAGE_MIME_ENUM],
        description: 'MIME type of the image. Must match the actual encoding of imageBase64 (magic bytes are checked).',
    },
} as const;

/** Zod counterpart of {@link IMAGE_PAYLOAD_PROPERTIES}. */
export const ImagePayloadShape = {
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
    }
    return bytes;
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
