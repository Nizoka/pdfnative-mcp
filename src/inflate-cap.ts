/**
 * Operator-configurable inflate cap (`PDFNATIVE_MCP_MAX_INFLATE_BYTES`).
 *
 * pdfnative bounds every FlateDecode expansion with a global decompressed-size
 * cap (CWE-400 zip-bomb mitigation, `DEFAULT_MAX_INFLATE_OUTPUT` = 100 MiB).
 * This module lets the operator raise or lower that cap once at startup —
 * e.g. tighten it on a shared host, or lift it for a trusted archive of
 * large scanned documents. The value is read from the environment exactly
 * once in `src/cli.ts`; tool arguments can never change it.
 *
 * An unparsable value refuses to start the server (mirrors
 * `readHttpToken`): a typo must not silently run with the default cap while
 * the operator believes a stricter one is in force.
 */
import { DEFAULT_MAX_INFLATE_OUTPUT, setMaxInflateOutputSize } from 'pdfnative';
import { ToolError } from './errors.js';

export const MAX_INFLATE_ENV = 'PDFNATIVE_MCP_MAX_INFLATE_BYTES';

/** Smallest cap that still lets a minimal FlateDecode xref / object stream open. */
export const MAX_INFLATE_MIN_BYTES = 1024;

/**
 * Parse the configured cap. `null` when unset / empty (engine default stays in
 * force); throws on anything that is not a positive integer number of bytes.
 */
export function readInflateCap(env: NodeJS.ProcessEnv = process.env): number | null {
    const raw = env[MAX_INFLATE_ENV];
    if (raw === undefined || raw === '') return null;
    if (!/^\d{1,15}$/.test(raw.trim())) {
        throw new Error(`${MAX_INFLATE_ENV} must be a positive integer number of bytes (e.g. 268435456 for 256 MiB); got "${raw}".`);
    }
    const value = Number(raw.trim());
    if (!Number.isSafeInteger(value) || value < MAX_INFLATE_MIN_BYTES) {
        throw new Error(`${MAX_INFLATE_ENV} must be an integer >= ${MAX_INFLATE_MIN_BYTES} bytes; got "${raw}".`);
    }
    return value;
}

/**
 * Read the env var and apply it to the engine. Returns the cap now in force
 * (the engine default when the variable is unset).
 */
export function applyInflateCap(env: NodeJS.ProcessEnv = process.env): number {
    const cap = readInflateCap(env);
    if (cap === null) return DEFAULT_MAX_INFLATE_OUTPUT;
    setMaxInflateOutputSize(cap);
    return cap;
}

/**
 * Matches the engine's own cap message (`pdf-inflate.ts`, pure-JS path) and
 * Node's `ERR_BUFFER_TOO_LARGE` / `maxOutputLength` failures (native zlib
 * path) — the two ways an exceeded cap surfaces from `inflateSync`.
 */
const INFLATE_CAP_RE = /zip bomb|exceeds maximum of \d+ bytes|ERR_BUFFER_TOO_LARGE|Cannot create a Buffer larger than|maxOutputLength/i;

/** True when `err` is an inflate-cap failure from the engine. */
export function isInflateCapError(err: unknown): boolean {
    const message = err instanceof Error ? `${err.message} ${(err as { code?: unknown }).code ?? ''}` : String(err);
    return INFLATE_CAP_RE.test(message);
}

/**
 * Rethrow an inflate-cap failure as a coded `ToolError` naming the remedy;
 * returns normally for every other error so callers can fall through to
 * their usual mapper.
 */
export function throwIfInflateCapError(err: unknown): void {
    if (!isInflateCapError(err)) return;
    const message = err instanceof Error ? err.message : String(err);
    throw new ToolError(
        'PDF_PARSE_FAILED',
        `A compressed stream in the PDF expands beyond the configured decompression cap (${message}). Raise ${MAX_INFLATE_ENV} on the server if the document is trusted.`,
    );
}
