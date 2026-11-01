/**
 * pdfnative-mcp — fuzz target: the tools/call boundary
 * ====================================================
 * Coverage-guided fuzzing of `callToolDirect` as a host reaches it: the
 * input bytes are read as a JSON document `{ "tool": <name>, "args": <object> }`
 * (anything that is not one picks a tool from the first byte and uses the
 * rest as a raw string argument), so the fuzzer explores the Zod boundary,
 * the shared mappers and the engine behind them.
 *
 * Contract (shared by every target in this directory): a tool result — a
 * success, or `isError: true` carrying a documented `[CODE]` — is a result;
 * a `TypeError`, `RangeError`, `ReferenceError`, `SyntaxError` or `URIError`
 * escaping the server is a bug and is rethrown. `callToolDirect` already
 * classifies any escaped failure of a PDF-taking tool as `PDF_PARSE_FAILED`
 * (`classifyUnexpected`), so what this target can still find is a failure
 * that escapes a tool WITHOUT PDF input, or a result whose text carries no
 * code — both are findings.
 *
 * The specifier is relative to the built tree on purpose: the container
 * fuzzes `dist/` (what `npm install pdfnative-mcp` delivers), and vitest
 * aliases the same path to `src/`.
 *
 * @module fuzz/tool-call
 */

import { callToolDirect, ensureCompressionReady, listToolsPayload } from '../dist/fuzz-surface.js';

/** @param {unknown} error @returns {boolean} */
function isBug(error) {
    return error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError
        || error instanceof SyntaxError || error instanceof URIError;
}

const TOOLS = listToolsPayload().tools.map((t) => t.name);
const CODE_RE = /^[a-z_]+ failed \[[A-Z_]+\]: /;
let ready = false;

/**
 * @param {Buffer} data Bytes chosen by the fuzzer.
 * @returns {Promise<void>}
 */
export async function fuzz(data) {
    if (!ready) {
        await ensureCompressionReady();
        ready = true;
    }
    let tool = TOOLS[(data[0] ?? 0) % TOOLS.length];
    /** @type {unknown} */
    let args = data.subarray(1).toString('utf8');
    try {
        const parsed = JSON.parse(data.toString('utf8'));
        if (parsed !== null && typeof parsed === 'object' && typeof parsed.tool === 'string') {
            tool = parsed.tool;
            args = parsed.args;
        }
    } catch {
        // Not JSON: the raw-string form above.
    }
    // An unknown tool name is a JSON-RPC -32602 at the protocol layer, not a
    // tool result; the direct call reports it without a tool code by design.
    if (!TOOLS.includes(tool)) return;
    let result;
    try {
        result = await callToolDirect(tool, args);
    } catch (error) {
        if (isBug(error)) throw error;
        return;
    }
    if (result.isError === true) {
        const text = result.content.find((c) => c.type === 'text');
        if (text === undefined || !CODE_RE.test(text.text)) {
            throw new Error(`uncoded failure from ${tool}: ${text === undefined ? '(no text)' : text.text.slice(0, 200)}`);
        }
    }
}
