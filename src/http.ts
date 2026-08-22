/**
 * Minimal bridge between `node:http` and the web-standard `Request` /
 * `Response` pair consumed by the MCP SDK v2 HTTP handler
 * (`createMcpHandler(...).fetch`). Deliberately dependency-free: the
 * `@modelcontextprotocol/node` adapter would pull in an HTTP framework, which
 * this project's zero-dependency policy forbids.
 *
 * Also hosts the loopback guard (DNS-rebinding protection): the endpoint binds
 * to 127.0.0.1 only, so Host and Origin are pinned to loopback authorities and
 * any foreign value is answered with 403 before the request reaches MCP.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

import {
    hostHeaderValidationResponse,
    localhostAllowedHostnames,
    localhostAllowedOrigins,
    originValidationResponse,
} from '@modelcontextprotocol/server';

/** Methods that carry a body per RFC 9110 (GET/HEAD/DELETE must not pass one to `Request`). */
const BODY_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Convert a Node request into a web-standard `Request`. The body is buffered
 * (MCP JSON-RPC bodies are small) so the SDK can clone it for era detection;
 * headers are copied verbatim (array values joined with `, `), and the
 * request is aborted when the client connection closes so long-lived
 * `subscriptions/listen` streams are torn down promptly.
 */
export async function toWebRequest(req: IncomingMessage, origin: string): Promise<Request> {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
    const method = (req.method ?? 'GET').toUpperCase();
    const controller = new AbortController();
    req.once('close', () => {
        if (!req.readableEnded || !req.complete) controller.abort();
    });
    const init: RequestInit = { method, headers, signal: controller.signal };
    if (BODY_METHODS.has(method)) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
        }
        init.body = new Uint8Array(Buffer.concat(chunks));
    }
    return new Request(new URL(req.url ?? '/', origin), init);
}

/**
 * Write a web-standard `Response` to a Node response. Streams (SSE) are piped
 * chunk by chunk; the Node side closing cancels the web stream.
 */
export async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
        headers[key] = value;
    });
    res.writeHead(response.status, headers);
    if (response.body === null) {
        res.end();
        return;
    }
    const body = response.body;
    const nodeStream = Readable.fromWeb(body as unknown as NodeReadableStream);
    res.once('close', () => {
        if (!res.writableFinished) nodeStream.destroy();
    });
    await new Promise<void>((resolve, reject) => {
        nodeStream.once('error', reject);
        res.once('finish', resolve);
        res.once('close', resolve);
        nodeStream.pipe(res);
    });
}

/**
 * DNS-rebinding / Origin protection. Returns a 403 `Response` when the Host or
 * Origin header names anything other than a loopback authority, `undefined`
 * when the request may proceed. Missing Origin (non-browser clients) passes.
 */
export function guardLoopback(request: Request): Response | undefined {
    return (
        hostHeaderValidationResponse(request, localhostAllowedHostnames()) ??
        originValidationResponse(request, localhostAllowedOrigins())
    );
}
