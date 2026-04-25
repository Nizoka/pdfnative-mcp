import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SecurityError, ToolError } from './errors.js';

/**
 * Environment variable controlling the allow-listed output directory.
 * If unset, file output is disabled entirely (only base64 inline output is allowed).
 */
const OUTPUT_DIR_ENV = 'PDFNATIVE_MPC_OUTPUT_DIR';

/**
 * Detect Windows absolute and UNC paths even when running on POSIX CI.
 */
const WINDOWS_ABSOLUTE_OR_UNC = /^(?:[A-Za-z]:[\\/]|\\\\)/;

/**
 * Maximum allowed file size when writing to disk (50 MB).
 */
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;

/**
 * Returns the configured output sandbox directory, or `null` if file output is disabled.
 */
export function getOutputSandbox(): string | null {
    const raw = process.env[OUTPUT_DIR_ENV];
    if (raw === undefined || raw.trim() === '') {
        return null;
    }
    return path.resolve(raw);
}

/**
 * Resolves a user-supplied file path against the sandbox and ensures it stays within it.
 *
 * @throws {SecurityError} when file output is disabled or the path escapes the sandbox.
 */
export function resolveSandboxedPath(userPath: string): string {
    const sandbox = getOutputSandbox();
    if (sandbox === null) {
        throw new SecurityError(
            `File output is disabled. Set ${OUTPUT_DIR_ENV} to an allow-listed directory to enable saving PDFs to disk, or use outputMode='base64'.`,
        );
    }

    if (typeof userPath !== 'string' || userPath.length === 0) {
        throw new ToolError('INVALID_PATH', 'outputPath must be a non-empty string.');
    }

    // Reject NUL bytes and absolute paths outright — only relative paths inside the sandbox are allowed.
    if (userPath.includes('\0')) {
        throw new SecurityError('outputPath contains a NUL byte.');
    }
    if (path.isAbsolute(userPath) || WINDOWS_ABSOLUTE_OR_UNC.test(userPath)) {
        throw new SecurityError('outputPath must be relative to the configured sandbox directory.');
    }

    const resolved = path.resolve(sandbox, userPath);
    const relative = path.relative(sandbox, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new SecurityError(`outputPath '${userPath}' escapes the sandbox directory.`);
    }

    if (!resolved.toLowerCase().endsWith('.pdf')) {
        throw new ToolError('INVALID_EXTENSION', 'outputPath must end with the .pdf extension.');
    }

    return resolved;
}

/**
 * Output mode: either return PDF as base64 in the response, or write to a sandboxed file.
 */
export type OutputMode = 'base64' | 'file';

export interface OutputResult {
    /** The output mode that was used. */
    mode: OutputMode;
    /** Number of bytes in the produced PDF. */
    sizeBytes: number;
    /** Absolute file path (when `mode === 'file'`). */
    filePath?: string;
    /** Base64-encoded PDF (when `mode === 'base64'`). */
    base64?: string;
}

/**
 * Produces the final tool output: either a base64 string (inline) or writes to a sandboxed file path.
 */
export async function emitPdf(
    bytes: Uint8Array,
    options: { mode: OutputMode; outputPath?: string },
): Promise<OutputResult> {
    if (bytes.byteLength > MAX_OUTPUT_BYTES) {
        throw new ToolError(
            'OUTPUT_TOO_LARGE',
            `Generated PDF (${bytes.byteLength} bytes) exceeds the maximum allowed size (${MAX_OUTPUT_BYTES} bytes).`,
        );
    }

    if (options.mode === 'file') {
        if (options.outputPath === undefined) {
            throw new ToolError('MISSING_OUTPUT_PATH', "outputPath is required when outputMode='file'.");
        }
        const resolved = resolveSandboxedPath(options.outputPath);
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, bytes, { flag: 'wx' });
        return { mode: 'file', sizeBytes: bytes.byteLength, filePath: resolved };
    }

    return {
        mode: 'base64',
        sizeBytes: bytes.byteLength,
        base64: Buffer.from(bytes).toString('base64'),
    };
}
