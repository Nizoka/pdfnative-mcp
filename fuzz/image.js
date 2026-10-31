/**
 * pdfnative-mcp — fuzz target: the image boundary
 * ===============================================
 * `decodeImageBase64` (src/image.ts) checks the magic bytes of a JPEG, PNG or
 * JPEG 2000 payload against its declared MIME type and reads the PNG IHDR to
 * refuse what the engine's decoder cannot take. The first byte picks the MIME
 * type, the rest is the image, base64-encoded here so the fuzzer mutates
 * bytes rather than base64 alphabet.
 *
 * Contract: a `ToolError` is a result; anything else escaping is a bug. See
 * fuzz/tool-call.js for the specifier.
 *
 * @module fuzz/image
 */

import { decodeImageBase64, IMAGE_MIME_ENUM, ToolError } from '../dist/fuzz-surface.js';

/** @param {Buffer} data Bytes chosen by the fuzzer. */
export function fuzz(data) {
    const mime = IMAGE_MIME_ENUM[(data[0] ?? 0) % IMAGE_MIME_ENUM.length];
    const payload = data.subarray(1).toString('base64');
    try {
        decodeImageBase64(payload, mime, 'imageBase64');
    } catch (error) {
        if (!(error instanceof ToolError)) throw error;
    }
}
