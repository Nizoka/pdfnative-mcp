/**
 * The built server, as a script sees it.
 *
 * Scripts never import `src/`: they load `dist/server.js` — what `npm publish`
 * ships — and call its `callToolDirect()`, the same function the `tools/call`
 * request handler delegates to. A path that resolves in source but not in the
 * emitted tree therefore fails here, before a release.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { REPO_ROOT, SAMPLE_CREATION_ISO } from './io.js';

export const SERVER_MODULE = join(REPO_ROOT, 'dist', 'server.js');

interface ContentBlock {
    readonly type: string;
    readonly text?: string;
    readonly resource?: { readonly blob?: string; readonly mimeType?: string };
}

export interface ToolResult {
    readonly isError?: boolean;
    readonly content?: readonly ContentBlock[];
    readonly structuredContent?: Readonly<Record<string, unknown>>;
}

export interface ToolListing {
    readonly name: string;
    readonly inputSchema: { readonly properties?: Readonly<Record<string, unknown>> };
}

export interface BuiltServer {
    readonly callToolDirect: (name: string, args: unknown) => Promise<ToolResult>;
    readonly ensureCompressionReady: () => Promise<void>;
    readonly listToolsPayload: () => { readonly tools: readonly ToolListing[] };
    /** `SERVER_INSTRUCTIONS`, re-exported for the size budget of `scripts/tool-shape.ts --check`. */
    readonly __serverInstructions: string;
}

/** Null when `dist/` is absent — callers print the build hint and exit 2. */
export async function loadBuiltServer(): Promise<BuiltServer | null> {
    if (!existsSync(SERVER_MODULE)) return null;
    const mod = (await import(pathToFileURL(SERVER_MODULE).href)) as unknown as BuiltServer;
    await mod.ensureCompressionReady();
    return mod;
}

/** Input properties that carry an instant, and therefore change bytes when left to the wall clock. */
export const INSTANT_FIELDS = ['creationDate', 'signingTime', 'modDate'] as const;

/**
 * Pin every instant the tool's LIVE input schema declares and the caller left
 * unset. Derived from `tools/list`, not hand-kept: a tool that gains
 * `creationDate` is pinned the day it ships.
 */
export function pinArgs(
    tools: readonly ToolListing[],
    tool: string,
    args: Readonly<Record<string, unknown>>,
    instant: string = SAMPLE_CREATION_ISO,
): Record<string, unknown> {
    const props = tools.find((t) => t.name === tool)?.inputSchema.properties ?? {};
    const pinned: Record<string, unknown> = { ...args };
    for (const field of INSTANT_FIELDS) {
        if (field in props && pinned[field] === undefined) pinned[field] = instant;
    }
    return pinned;
}

function errorText(name: string, result: ToolResult): string {
    const first = result.content?.[0];
    return `${name}: ${first?.type === 'text' && first.text !== undefined ? first.text : 'unknown error'}`;
}

/** Call a tool with pinned instants; throws with the tool's error text when `isError` is set. */
export async function callPinned(server: BuiltServer, name: string, args: Readonly<Record<string, unknown>>): Promise<ToolResult> {
    const result = await server.callToolDirect(name, pinArgs(server.listToolsPayload().tools, name, args));
    if (result.isError === true) throw new Error(errorText(name, result));
    return result;
}

/** The base64 PDF of the embedded resource block, or null for a JSON-only result. */
export function pdfBase64Of(result: ToolResult): string | null {
    const block = (result.content ?? []).find((c) => c.type === 'resource' && typeof c.resource?.blob === 'string' && c.resource.blob.length > 0);
    return block?.resource?.blob ?? null;
}

/** Every base64 PDF of the result, in order (split_pdf returns several). */
export function pdfBlobsOf(result: ToolResult): string[] {
    const blobs: string[] = [];
    for (const c of result.content ?? []) {
        if (c.type === 'resource' && typeof c.resource?.blob === 'string' && c.resource.blob.length > 0) blobs.push(c.resource.blob);
    }
    return blobs;
}

/** Call a tool and return its PDF bytes as base64. */
export async function producePdf(server: BuiltServer, name: string, args: Readonly<Record<string, unknown>>): Promise<string> {
    const blob = pdfBase64Of(await callPinned(server, name, args));
    if (blob === null) throw new Error(`${name}: no embedded PDF resource in the tool result.`);
    return blob;
}
