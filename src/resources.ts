/**
 * Native MCP resources — expose generated PDFs as re-referenceable resource URIs.
 *
 * When the host enables file output (`PDFNATIVE_MCP_OUTPUT_DIR`), every PDF a
 * tool writes to that sandbox becomes an addressable MCP resource under the
 * `pdfnative://output/<relative-path>` scheme, discoverable via `resources/list`
 * and fetchable via `resources/read`. PDF-producing tools additionally emit a
 * `resource_link` to the just-written file so a client can re-reference the
 * artifact across calls (roadmap: "Native MCP resources").
 *
 * State is intentionally minimal and bounded: the server holds no in-memory
 * registry — `resources/list` reflects the live contents of the sandbox
 * directory, and every read is re-validated to stay inside it (the same
 * traversal / extension guards as {@link resolveSandboxedPath}). When file
 * output is disabled, there are simply no resources.
 */
import { promises as fs, type Dirent, type Stats } from 'node:fs';
import path from 'node:path';

import { getOutputSandbox, resolveSandboxedPath } from './output.js';
import { ToolError } from './errors.js';

/** URI scheme + authority for sandboxed PDF resources. */
export const RESOURCE_URI_PREFIX = 'pdfnative://output/';

/** Maximum number of resources returned by a single `resources/list`. */
const MAX_LISTED_RESOURCES = 1000;

/** Maximum directory-walk depth when enumerating the sandbox. */
const MAX_WALK_DEPTH = 8;

/** Maximum size of a single `resources/read` payload (mirrors the 50 MiB output cap). */
const MAX_RESOURCE_READ_BYTES = 50 * 1024 * 1024;

export interface ResourceDescriptor {
    readonly uri: string;
    readonly name: string;
    readonly title: string;
    readonly description: string;
    readonly mimeType: string;
    readonly size: number;
}

export interface ResourceContents {
    readonly uri: string;
    readonly mimeType: string;
    readonly blob: string;
}

/** Convert an absolute sandbox path to its `pdfnative://output/…` URI (POSIX separators). */
function uriForRelative(relative: string): string {
    return RESOURCE_URI_PREFIX + relative.split(path.sep).join('/');
}

/**
 * Build the resource URI for an absolute file path if (and only if) it lives
 * inside the configured sandbox; otherwise `null`. Used by the output layer to
 * attach a `resource_link` after a file-mode write.
 */
export function resourceUriForPath(absPath: string): string | null {
    const sandbox = getOutputSandbox();
    if (sandbox === null) return null;
    const relative = path.relative(sandbox, absPath);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return uriForRelative(relative);
}

/**
 * Build a `resource_link` descriptor (uri + human-readable name + title) for an
 * absolute sandbox path, or `null` when it is outside the sandbox. `name` is the
 * POSIX-relative path (matching {@link listResources}); `title` is the basename.
 */
export function resourceLinkForPath(absPath: string): { uri: string; name: string; title: string } | null {
    const uri = resourceUriForPath(absPath);
    if (uri === null) return null;
    const relative = uri.slice(RESOURCE_URI_PREFIX.length);
    return { uri, name: relative, title: relative.split('/').pop() ?? relative };
}

/** Recursively collect `.pdf` files under `dir`, relative to `sandbox`. */
async function walkPdfs(sandbox: string, dir: string, depth: number, out: string[]): Promise<void> {
    if (depth > MAX_WALK_DEPTH || out.length >= MAX_LISTED_RESOURCES) return;
    let entries: Dirent[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
        /* v8 ignore next 3 -- unreadable directory is skipped defensively. */
    } catch {
        return;
    }
    for (const entry of entries) {
        if (out.length >= MAX_LISTED_RESOURCES) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            await walkPdfs(sandbox, full, depth + 1, out);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
            out.push(path.relative(sandbox, full));
        }
    }
}

/** List every sandboxed PDF as an MCP resource. Empty when file output is disabled. */
export async function listResources(): Promise<ResourceDescriptor[]> {
    const sandbox = getOutputSandbox();
    if (sandbox === null) return [];
    const relatives: string[] = [];
    await walkPdfs(sandbox, sandbox, 0, relatives);
    relatives.sort();

    const descriptors: ResourceDescriptor[] = [];
    for (const relative of relatives) {
        let size = 0;
        try {
            size = (await fs.stat(path.join(sandbox, relative))).size;
            /* v8 ignore next 1 -- racing deletion between walk and stat. */
        } catch { /* keep size 0 */ }
        const posix = relative.split(path.sep).join('/');
        descriptors.push({
            uri: uriForRelative(relative),
            name: posix,
            title: path.basename(relative),
            description: `Generated PDF at ${posix} (${size} bytes) in the pdfnative-mcp output sandbox.`,
            mimeType: 'application/pdf',
            size,
        });
    }
    return descriptors;
}

/**
 * Read a `pdfnative://output/<relative>` resource and return its bytes as a
 * base64 blob. Re-validates the path against the sandbox (traversal / extension
 * guards) before reading.
 *
 * @throws {ToolError} `UNKNOWN_RESOURCE` for a bad scheme or a missing file;
 *         `SECURITY_VIOLATION` when the path escapes the sandbox;
 *         `INVALID_EXTENSION` when the URI does not end in `.pdf`;
 *         `OUTPUT_TOO_LARGE` when the file exceeds the read cap.
 */
export async function readResource(uri: string): Promise<ResourceContents> {
    if (!uri.startsWith(RESOURCE_URI_PREFIX)) {
        throw new ToolError('UNKNOWN_RESOURCE', `Unsupported resource URI: ${uri}`);
    }
    const relative = decodeURIComponent(uri.slice(RESOURCE_URI_PREFIX.length));
    if (relative.length === 0) {
        throw new ToolError('UNKNOWN_RESOURCE', 'Resource URI is missing a path.');
    }
    // resolveSandboxedPath enforces: sandbox configured, no NUL, no absolute
    // path, no traversal, and the `.pdf` extension.
    const resolved = resolveSandboxedPath(relative);
    let stat: Stats;
    try {
        stat = await fs.stat(resolved);
    } catch {
        throw new ToolError('UNKNOWN_RESOURCE', `No resource found at ${uri}.`);
    }
    if (stat.size > MAX_RESOURCE_READ_BYTES) {
        throw new ToolError(
            'OUTPUT_TOO_LARGE',
            `Resource ${uri} (${stat.size} bytes) exceeds the maximum read size (${MAX_RESOURCE_READ_BYTES} bytes).`,
        );
    }
    const bytes = await fs.readFile(resolved);
    return { uri, mimeType: 'application/pdf', blob: bytes.toString('base64') };
}

/** MCP resource template describing the sandbox address space (`resources/templates/list`). */
export interface ResourceTemplate {
    readonly uriTemplate: string;
    readonly name: string;
    readonly title: string;
    readonly description: string;
    readonly mimeType: string;
}

/**
 * Static resource-template list: advertises the `pdfnative://output/{path}`
 * address space so clients understand how to construct/read generated-PDF URIs
 * (RFC 6570 template). Empty when file output is disabled.
 */
export function listResourceTemplates(): ResourceTemplate[] {
    if (getOutputSandbox() === null) return [];
    return [
        {
            // RFC 6570 reserved expansion: `/` in nested paths is not percent-encoded,
            // matching the concrete URIs returned by resources/list.
            uriTemplate: `${RESOURCE_URI_PREFIX}{+path}`,
            name: 'sandbox-pdf',
            title: 'Generated PDF (output sandbox)',
            description:
                'A PDF written by a tool in outputMode="file", addressed by its path relative to PDFNATIVE_MCP_OUTPUT_DIR. Enumerate concrete URIs with resources/list.',
            mimeType: 'application/pdf',
        },
    ];
}
