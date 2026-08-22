/**
 * Loopback RFC 3161 TSA over HTTP (node:http only) backed by the offline
 * mock PKI. Exercises the real transport path: a `TimestampProvider` built
 * on global `fetch` POSTs `application/timestamp-query` bodies and receives
 * `application/timestamp-reply` DER.
 *
 * Failure modes let the MCP tools' error handling be tested deterministically.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { buildMockTimestampResponse, type MockPki } from './_ltv-fixtures.js';

export type MockTsaMode = 'ok' | 'reject' | 'http500' | 'wrongContentType' | 'slow' | 'tamper';

export interface MockTsaServerOptions {
    /** Default `'ok'`. */
    readonly mode?: MockTsaMode;
    /** Response delay for `mode: 'slow'` (default 2000 ms). */
    readonly delayMs?: number;
}

export interface MockTsaServer {
    /** `http://127.0.0.1:<port>/tsr` */
    readonly url: string;
    /** Number of POST /tsr requests received so far. */
    readonly requests: number;
    close(): Promise<void>;
}

const TSQ_TYPE = 'application/timestamp-query';
const TSR_TYPE = 'application/timestamp-reply';

export async function startMockTsaServer(pki: MockPki, opts?: MockTsaServerOptions): Promise<MockTsaServer> {
    const mode = opts?.mode ?? 'ok';
    const delayMs = opts?.delayMs ?? 2000;
    let requests = 0;
    const pending = new Set<NodeJS.Timeout>();

    const server: Server = createServer((req, res) => {
        const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
        if (req.method !== 'POST' || path !== '/tsr') {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found. TSA endpoint is POST /tsr');
            return;
        }
        requests++;
        if (req.headers['content-type'] !== TSQ_TYPE) {
            res.writeHead(415, { 'Content-Type': 'text/plain' });
            res.end(`Expected Content-Type ${TSQ_TYPE}`);
            return;
        }

        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
            const body = new Uint8Array(Buffer.concat(chunks));
            const send = (): void => {
                try {
                    switch (mode) {
                        case 'http500':
                            res.writeHead(500, { 'Content-Type': 'text/plain' });
                            res.end('mock TSA: internal error');
                            return;
                        case 'wrongContentType': {
                            const der = buildMockTimestampResponse(pki, body);
                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end(Buffer.from(der));
                            return;
                        }
                        case 'reject': {
                            const der = buildMockTimestampResponse(pki, body, { status: 2 });
                            res.writeHead(200, { 'Content-Type': TSR_TYPE });
                            res.end(Buffer.from(der));
                            return;
                        }
                        case 'tamper': {
                            const der = buildMockTimestampResponse(pki, body, { tamper: true });
                            res.writeHead(200, { 'Content-Type': TSR_TYPE });
                            res.end(Buffer.from(der));
                            return;
                        }
                        default: {
                            const der = buildMockTimestampResponse(pki, body);
                            res.writeHead(200, { 'Content-Type': TSR_TYPE });
                            res.end(Buffer.from(der));
                        }
                    }
                } catch (err) {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end(err instanceof Error ? err.message : String(err));
                }
            };
            if (mode === 'slow') {
                const t = setTimeout(() => {
                    pending.delete(t);
                    send();
                }, delayMs);
                pending.add(t);
            } else {
                send();
            }
        });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;

    return {
        url: `http://127.0.0.1:${port}/tsr`,
        get requests(): number {
            return requests;
        },
        close(): Promise<void> {
            for (const t of pending) clearTimeout(t);
            pending.clear();
            server.closeAllConnections();
            return new Promise<void>((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve()));
            });
        },
    };
}

/**
 * A `TimestampProvider` that talks to a URL through global `fetch` — the
 * shape a real deployment uses, pointed at the loopback mock.
 */
export function fetchTimestampProvider(url: string, init?: { readonly signal?: AbortSignal }) {
    return {
        async getTimestamp(request: Uint8Array): Promise<Uint8Array> {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': TSQ_TYPE },
                body: new Uint8Array(request),
                ...(init?.signal ? { signal: init.signal } : {}),
            });
            if (!res.ok) throw new Error(`TSA HTTP ${res.status}`);
            const type = res.headers.get('content-type') ?? '';
            if (!type.startsWith(TSR_TYPE)) throw new Error(`TSA returned unexpected Content-Type ${type}`);
            return new Uint8Array(await res.arrayBuffer());
        },
    };
}
