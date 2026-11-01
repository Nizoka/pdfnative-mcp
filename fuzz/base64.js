/**
 * pdfnative-mcp — fuzz target: the base64 boundary
 * ================================================
 * `decodePdfBase64` / `decodeBase64Field` (src/base64.ts) are the first thing
 * every `pdfBase64`, DER and ICC payload meets: a `data:` URI is tolerated,
 * PEM armour, a doubled encoding and an empty payload are refused with a
 * hint. The input bytes are read as the base64 text a model would send.
 *
 * Contract: a `ToolError` is a result (the boundary said no, with a code);
 * a `TypeError`, `RangeError`, … is a bug and is rethrown. See fuzz/tool-call.js
 * for the specifier.
 *
 * @module fuzz/base64
 */

import { decodeBase64Field, decodePdfBase64, ToolError } from '../dist/fuzz-surface.js';

/** @param {() => unknown} step */
function attempt(step) {
    try {
        step();
    } catch (error) {
        if (!(error instanceof ToolError)) throw error;
    }
}

/** @param {Buffer} data Bytes chosen by the fuzzer. */
export function fuzz(data) {
    const text = data.toString('latin1');
    attempt(() => decodePdfBase64(text, 'pdfBase64'));
    attempt(() => decodeBase64Field(text, 'certDerBase64'));
    attempt(() => decodeBase64Field(data.toString('utf8'), 'iccProfileBase64'));
}
