import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SecurityError, ToolError } from './errors.js';

/**
 * Canonical environment variable controlling the allow-listed output directory
 * for outputMode='file'. Introduced in v1.0.0 to correct the historical typo
 * in {@link DEPRECATED_OUTPUT_DIR_ENV}.
 */
const OUTPUT_DIR_ENV = 'PDFNATIVE_MCP_OUTPUT_DIR';

/**
 * Deprecated alias preserved for backward compatibility with pdfnative-mcp
 * v0.1.0–v0.3.0 configurations (Claude Desktop / Cursor / Continue setups).
 * Still respected when the canonical name is unset, but emits a one-shot
 * warning to stderr on first use. Will be removed in v2.0.0.
 */
const DEPRECATED_OUTPUT_DIR_ENV = 'PDFNATIVE_MPC_OUTPUT_DIR';

let _deprecationWarned = false;

/** Test-only hook to reset the one-shot deprecation warning latch. */
export function __resetDeprecationWarning(): void {
    _deprecationWarned = false;
}

/**
 * Optional public base URL of the sandbox (1.8.0, issue #66): when the operator
 * serves `PDFNATIVE_MCP_OUTPUT_DIR` over HTTP (a static location behind their
 * own authentication), every file-mode result also carries `url` — the base
 * plus the sandbox-relative path, each segment percent-encoded — and the text
 * block names that URL instead of the server's filesystem path, which is
 * meaningless to a remote user and discloses the host's layout. Pure string
 * formatting: the server never requests that URL (the offline guarantee holds).
 *
 * Read at boot by the CLI (`assertOutputBaseUrl()`): an absolute `http:` /
 * `https:` URL with no credentials, query or fragment, normalised to a trailing
 * slash; any other value — or a base URL without an output directory — refuses
 * to start. Per call it is re-read through the same validator, so a result can
 * never carry a URL the boot check would have refused.
 */
const OUTPUT_BASE_URL_ENV = 'PDFNATIVE_MCP_OUTPUT_BASE_URL';
/** The variable's name, for boot logs. */
export const OUTPUT_BASE_URL_ENV_NAME = OUTPUT_BASE_URL_ENV;

/**
 * Validate and normalise the base URL, or `null` when unset. Throws a plain
 * `Error` (a boot refusal, not a tool error) on an invalid value.
 */
export function readOutputBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
    const raw = env[OUTPUT_BASE_URL_ENV];
    if (raw === undefined || raw.trim() === '') return null;
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        throw new Error(`${OUTPUT_BASE_URL_ENV} must be an absolute http: or https: URL (e.g. https://files.example.com/pdf/); got "${raw}".`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`${OUTPUT_BASE_URL_ENV} must use http: or https:; got "${url.protocol}".`);
    }
    if (url.username !== '' || url.password !== '') {
        throw new Error(`${OUTPUT_BASE_URL_ENV} must not carry credentials.`);
    }
    if (url.search !== '' || url.hash !== '') {
        throw new Error(`${OUTPUT_BASE_URL_ENV} must not carry a query string or a fragment; got "${raw}".`);
    }
    if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
    return url.href;
}

/**
 * Boot-time check: the base URL must be valid and must accompany an output
 * directory (a URL that maps nothing is a misconfiguration, not a no-op).
 * Returns the normalised URL, or `null` when unset.
 */
export function assertOutputBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
    const base = readOutputBaseUrl(env);
    if (base !== null && getOutputSandbox() === null) {
        throw new Error(`${OUTPUT_BASE_URL_ENV} is set but ${OUTPUT_DIR_ENV} is not: the base URL maps the output directory, set both or neither.`);
    }
    return base;
}

/**
 * Public URL of a file written inside the sandbox, or `undefined` when no
 * base URL is configured: the base plus the sandbox-relative path, one
 * percent-encoded segment per directory level (`reports/Q3 plan.pdf` →
 * `…/reports/Q3%20plan.pdf`).
 */
export function publicUrlFor(resolvedPath: string): string | undefined {
    const base = readOutputBaseUrl();
    const sandbox = getOutputSandbox();
    if (base === null || sandbox === null) return undefined;
    const relative = path.relative(sandbox, resolvedPath).split(path.sep);
    return base + relative.map((segment) => encodeURIComponent(segment)).join('/');
}

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
 *
 * Resolution order:
 *   1. `PDFNATIVE_MCP_OUTPUT_DIR` (canonical, v1.0.0+)
 *   2. `PDFNATIVE_MPC_OUTPUT_DIR` (deprecated typo alias; emits one warning)
 */
export function getOutputSandbox(): string | null {
    const canonical = process.env[OUTPUT_DIR_ENV];
    if (canonical !== undefined && canonical.trim() !== '') {
        return path.resolve(canonical);
    }
    const legacy = process.env[DEPRECATED_OUTPUT_DIR_ENV];
    if (legacy !== undefined && legacy.trim() !== '') {
        if (!_deprecationWarned) {
            _deprecationWarned = true;
            process.stderr.write(
                `[pdfnative-mcp] WARN: environment variable '${DEPRECATED_OUTPUT_DIR_ENV}' is deprecated and will be removed in v2.0.0. ` +
                `Please rename it to '${OUTPUT_DIR_ENV}' in your MCP client configuration (Claude Desktop, Cursor, Continue, Zed, …).\n`,
            );
        }
        return path.resolve(legacy);
    }
    return null;
}

/**
 * Resolves a user-supplied file path against the sandbox and ensures it stays within it.
 *
 * @param userPath  Relative path supplied by the caller.
 * @param extension Required lower-case file extension including the dot
 *                  (default `.pdf`; `draft_governance_issue` passes `.md`).
 * @throws {SecurityError} when file output is disabled or the path escapes the sandbox.
 */
export function resolveSandboxedPath(userPath: string, extension = '.pdf'): string {
    const sandbox = getOutputSandbox();
    if (sandbox === null) {
        throw new SecurityError(
            `File output is disabled. Set ${OUTPUT_DIR_ENV} to an allow-listed directory to enable saving files to disk, or use outputMode='base64'.`,
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

    if (!resolved.toLowerCase().endsWith(extension)) {
        throw new ToolError('INVALID_EXTENSION', `outputPath must end with the ${extension} extension.`);
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
    /** Public URL of the file (file mode, only when `PDFNATIVE_MCP_OUTPUT_BASE_URL` is set). */
    url?: string;
    /** Base64-encoded PDF (when `mode === 'base64'`). */
    base64?: string;
    /** PDF/A conformance diagnostics (only when the caller opted in via `includeDiagnostics`). */
    diagnostics?: ReadonlyArray<{ readonly code: string; readonly message: string; readonly severity: 'warning' }>;
    /** Tool-specific summary echoed into `structuredContent.summary` (e.g. LTV material counts). */
    summary?: Readonly<Record<string, unknown>>;
}

/** One PDF part of a {@link MultiOutputResult}. */
export interface MultiOutputPart {
    /** 0-based position of this PDF within the produced sequence. */
    index: number;
    /** Number of bytes in this PDF. */
    sizeBytes: number;
    /** Absolute file path (when `mode === 'file'`). */
    filePath?: string;
    /** Public URL of the file (file mode, only when `PDFNATIVE_MCP_OUTPUT_BASE_URL` is set). */
    url?: string;
    /** Base64-encoded PDF (when `mode === 'base64'`). */
    base64?: string;
}

/** Result of a tool that produces several PDFs at once (e.g. `split_pdf`). */
export interface MultiOutputResult {
    /** The output mode that was used. */
    mode: OutputMode;
    /** Number of PDFs produced. */
    count: number;
    /** Combined byte size of every produced PDF. */
    totalBytes: number;
    /** The individual PDFs, in order. */
    parts: MultiOutputPart[];
}

/**
 * Maximum combined byte size when producing several PDFs at once (200 MiB).
 * Each individual PDF is additionally capped at {@link MAX_OUTPUT_BYTES}.
 */
const MAX_MULTI_OUTPUT_BYTES = 200 * 1024 * 1024;

/**
 * Derives an indexed sibling path from a base `.pdf` path by inserting a
 * 1-based suffix before the extension: `report.pdf` → `report-1.pdf`.
 */
function indexedOutputPath(basePath: string, oneBasedIndex: number): string {
    return basePath.replace(/\.pdf$/i, `-${oneBasedIndex}.pdf`);
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
        const url = publicUrlFor(resolved);
        return { mode: 'file', sizeBytes: bytes.byteLength, filePath: resolved, ...(url !== undefined ? { url } : {}) };
    }

    return {
        mode: 'base64',
        sizeBytes: bytes.byteLength,
        base64: Buffer.from(bytes).toString('base64'),
    };
}

/**
 * Produces output for a tool that yields several PDFs at once (e.g. `split_pdf`).
 *
 * In `base64` mode every PDF is returned inline. In `file` mode each PDF is
 * written to a 1-based indexed sibling of `outputPath` (`out.pdf` →
 * `out-1.pdf`, `out-2.pdf`, …); every derived path is independently validated
 * against the sandbox.
 *
 * @throws {ToolError} when any PDF — or the combined output — exceeds the size caps.
 */
export async function emitPdfMulti(
    parts: readonly Uint8Array[],
    options: { mode: OutputMode; outputPath?: string },
): Promise<MultiOutputResult> {
    let totalBytes = 0;
    for (const bytes of parts) {
        if (bytes.byteLength > MAX_OUTPUT_BYTES) {
            throw new ToolError(
                'OUTPUT_TOO_LARGE',
                `A produced PDF (${bytes.byteLength} bytes) exceeds the maximum allowed size (${MAX_OUTPUT_BYTES} bytes).`,
            );
        }
        totalBytes += bytes.byteLength;
    }
    if (totalBytes > MAX_MULTI_OUTPUT_BYTES) {
        throw new ToolError(
            'OUTPUT_TOO_LARGE',
            `The combined output (${totalBytes} bytes) exceeds the maximum allowed size (${MAX_MULTI_OUTPUT_BYTES} bytes).`,
        );
    }

    if (options.mode === 'file') {
        if (options.outputPath === undefined) {
            throw new ToolError('MISSING_OUTPUT_PATH', "outputPath is required when outputMode='file'.");
        }
        // Validate the base path up-front so a bad path fails before any write.
        resolveSandboxedPath(options.outputPath);
        const resultParts: MultiOutputPart[] = [];
        for (let i = 0; i < parts.length; i++) {
            const resolved = resolveSandboxedPath(indexedOutputPath(options.outputPath, i + 1));
            await fs.mkdir(path.dirname(resolved), { recursive: true });
            await fs.writeFile(resolved, parts[i] as Uint8Array, { flag: 'wx' });
            const url = publicUrlFor(resolved);
            resultParts.push({ index: i, sizeBytes: (parts[i] as Uint8Array).byteLength, filePath: resolved, ...(url !== undefined ? { url } : {}) });
        }
        return { mode: 'file', count: parts.length, totalBytes, parts: resultParts };
    }

    return {
        mode: 'base64',
        count: parts.length,
        totalBytes,
        parts: parts.map((bytes, i) => ({
            index: i,
            sizeBytes: bytes.byteLength,
            base64: Buffer.from(bytes).toString('base64'),
        })),
    };
}

/**
 * Writes a UTF-8 text artifact (e.g. a Markdown governance draft) to a
 * sandboxed path. Reuses {@link resolveSandboxedPath} — including its NUL /
 * absolute-path / traversal / extension guards — so text output enjoys the same
 * defence-in-depth as PDF output. The write uses the exclusive `wx` flag so an
 * existing file is never clobbered.
 *
 * @throws {ToolError}     `OUTPUT_TOO_LARGE` when the text exceeds the size cap.
 * @throws {SecurityError} when file output is disabled or the path escapes the sandbox.
 */
export async function writeSandboxedText(
    text: string,
    outputPath: string,
    extension = '.md',
): Promise<{ filePath: string; sizeBytes: number; url?: string }> {
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.byteLength > MAX_OUTPUT_BYTES) {
        throw new ToolError(
            'OUTPUT_TOO_LARGE',
            `The text artifact (${bytes.byteLength} bytes) exceeds the maximum allowed size (${MAX_OUTPUT_BYTES} bytes).`,
        );
    }
    const resolved = resolveSandboxedPath(outputPath, extension);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, bytes, { flag: 'wx' });
    const url = publicUrlFor(resolved);
    return { filePath: resolved, sizeBytes: bytes.byteLength, ...(url !== undefined ? { url } : {}) };
}
