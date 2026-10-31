/**
 * pdfnative-mcp — fuzz target: the output sandbox
 * ===============================================
 * `resolveSandboxedPath` (src/output.ts) is the only way a tool argument
 * becomes a path on disk: relative, inside `PDFNATIVE_MCP_OUTPUT_DIR`, no NUL,
 * no `..`, the right extension. The input bytes are the `outputPath` a model
 * would send. The invariant is stronger than "no crash": every path the
 * function RETURNS must lie inside the sandbox — a return outside it is a
 * sandbox escape, reported as a bug whatever the exception policy says.
 *
 * The sandbox is a fixed, non-existent directory: the function resolves and
 * checks, it never touches the disk.
 *
 * @module fuzz/output-path
 */

import path from 'node:path';

import { resolveSandboxedPath, ToolError } from '../dist/fuzz-surface.js';

const SANDBOX = path.resolve('/pdfnative-mcp-fuzz-sandbox');
process.env.PDFNATIVE_MCP_OUTPUT_DIR = SANDBOX;

/** @param {Buffer} data Bytes chosen by the fuzzer. */
export function fuzz(data) {
    const userPath = data.toString('utf8');
    for (const extension of ['.pdf', '.md']) {
        let resolved;
        try {
            resolved = resolveSandboxedPath(userPath, extension);
        } catch (error) {
            if (!(error instanceof ToolError)) throw error;
            continue;
        }
        const relative = path.relative(SANDBOX, resolved);
        if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error(`sandbox escape: ${JSON.stringify(userPath)} resolved to ${resolved}`);
        }
        if (!resolved.toLowerCase().endsWith(extension)) {
            throw new Error(`extension not enforced: ${JSON.stringify(userPath)} resolved to ${resolved}`);
        }
    }
}
