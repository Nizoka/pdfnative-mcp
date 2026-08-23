import { describe, it, expect, afterEach } from 'vitest';
import { createServer as createHttpServer, request as httpRequest, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { guardLoopback, sendWebResponse, toWebRequest } from '../src/http.js';

/** Unit tests for the dependency-free node:http ↔ web Request/Response bridge. */
describe('src/http.ts bridge', () => {
    let server: HttpServer | undefined;
    afterEach(async () => {
        if (server !== undefined) {
            await new Promise<void>((resolve) => server!.close(() => resolve()));
            server = undefined;
        }
    });

    async function serve(handler: (request: Request) => Promise<Response> | Response): Promise<number> {
        server = createHttpServer((req, res) => {
            void (async () => {
                const origin = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
                const request = await toWebRequest(req, origin, res);
                await sendWebResponse(res, await handler(request));
            })();
        });
        await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
        return (server.address() as AddressInfo).port;
    }

    function raw(
        port: number,
        opts: { method: string; path?: string; headers?: Record<string, string | string[]>; body?: string },
    ): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
        return new Promise((resolve, reject) => {
            const req = httpRequest({ host: '127.0.0.1', port, path: opts.path ?? '/', method: opts.method, headers: opts.headers }, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
            });
            req.on('error', reject);
            req.end(opts.body);
        });
    }

    it('converts method, URL, headers (array values joined) and buffered body', async () => {
        let seen: { method: string; url: string; accept: string | null; body: string } | undefined;
        const port = await serve(async (request) => {
            seen = { method: request.method, url: request.url, accept: request.headers.get('accept'), body: await request.text() };
            return new Response('ok', { status: 201, headers: { 'x-test': '1' } });
        });
        const r = await raw(port, { method: 'POST', path: '/mcp?x=1', headers: { accept: ['application/json', 'text/event-stream'], 'content-type': 'text/plain' }, body: 'payload' });
        expect(r.status).toBe(201);
        expect(r.headers['x-test']).toBe('1');
        expect(r.text).toBe('ok');
        expect(seen?.method).toBe('POST');
        expect(seen?.url).toBe(`http://127.0.0.1:${port}/mcp?x=1`);
        expect(seen?.accept).toBe('application/json, text/event-stream');
        expect(seen?.body).toBe('payload');
    });

    it('passes GET without a body and writes an empty response for a null body', async () => {
        const port = await serve((request) => new Response(null, { status: 204, headers: { 'x-method': request.method } }));
        const r = await raw(port, { method: 'GET' });
        expect(r.status).toBe(204);
        expect(r.headers['x-method']).toBe('GET');
        expect(r.text).toBe('');
    });

    it('streams a ReadableStream body (SSE-style) to the Node response', async () => {
        const port = await serve(() => {
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('event: a\ndata: 1\n\n'));
                    controller.enqueue(new TextEncoder().encode('event: b\ndata: 2\n\n'));
                    controller.close();
                },
            });
            return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        });
        const r = await raw(port, { method: 'GET' });
        expect(r.status).toBe(200);
        expect(r.headers['content-type']).toBe('text/event-stream');
        expect(r.text).toContain('data: 1');
        expect(r.text).toContain('data: 2');
    });

    it('guardLoopback rejects foreign Host/Origin and accepts loopback', () => {
        const ok = new Request('http://127.0.0.1:1234/mcp', { method: 'POST', headers: { host: '127.0.0.1:1234', origin: 'http://localhost:1234' } });
        expect(guardLoopback(ok)).toBeUndefined();
        const noOrigin = new Request('http://127.0.0.1:1234/mcp', { method: 'POST', headers: { host: 'localhost:1234' } });
        expect(guardLoopback(noOrigin)).toBeUndefined();
        const badHost = new Request('http://127.0.0.1:1234/mcp', { method: 'POST', headers: { host: 'evil.example.com' } });
        expect(guardLoopback(badHost)?.status).toBe(403);
        const badOrigin = new Request('http://127.0.0.1:1234/mcp', { method: 'POST', headers: { host: '127.0.0.1:1234', origin: 'http://evil.example.com' } });
        expect(guardLoopback(badOrigin)?.status).toBe(403);
    });
});

describe('src/http.ts bridge — client disconnect aborts the in-flight request', () => {
    it('aborts the web Request signal when the POST client goes away before the response', async () => {
        const { createServer } = await import('node:http');
        const { toWebRequest } = await import('../src/http.js');
        let seenSignal: AbortSignal | undefined;
        const gotRequest = new Promise<void>((resolve) => {
            const server = createServer((req, res) => {
                void (async () => {
                    const port = (server.address() as AddressInfo).port;
                    const request = await toWebRequest(req, `http://127.0.0.1:${port}`, res);
                    seenSignal = request.signal;
                    resolve();
                    // Never answer: the client will hang up.
                    setTimeout(() => {
                        res.end();
                        server.close();
                    }, 500);
                })();
            });
            server.listen(0, '127.0.0.1', () => {
                const port = (server.address() as AddressInfo).port;
                const req = httpRequest({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { 'content-type': 'application/json' } });
                req.on('error', () => undefined);
                req.end('{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}');
                setTimeout(() => req.destroy(), 100);
            });
        });
        await gotRequest;
        await new Promise((r) => setTimeout(r, 300));
        expect(seenSignal?.aborted).toBe(true);
    });
});
