import { describe, it, expect, afterEach } from 'vitest';
import { AddressInfo } from 'node:net';
import { createServer as createHttpServer, request as httpRequest, type Server as HttpServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { createServer } from '../src/server.js';

/**
 * DNS-rebinding / Origin protection for the optional HTTP transport.
 *
 * The CLI (src/cli.ts) configures the Streamable HTTP transport with
 * `enableDnsRebindingProtection` + `allowedHosts`/`allowedOrigins` pinned to the
 * loopback authority. These tests reproduce that wiring and assert the transport
 * answers 403 to a foreign Host/Origin while accepting the loopback authority —
 * matching MCP's Security Best Practices (403 on invalid Origin).
 */
describe('HTTP transport DNS-rebinding protection', () => {
    let httpServer: HttpServer | undefined;

    afterEach(async () => {
        if (httpServer !== undefined) {
            await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
            httpServer = undefined;
        }
    });

    /** Start the MCP HTTP transport with the loopback authority (incl. port) pinned. */
    async function startServer(): Promise<number> {
        const mcp = createServer();
        httpServer = createHttpServer();
        await new Promise<void>((resolve) => httpServer!.listen(0, '127.0.0.1', () => resolve()));
        const port = (httpServer!.address() as AddressInfo).port;

        // Mirror src/cli.ts: pin Host/Origin to the loopback authority including the port.
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableDnsRebindingProtection: true,
            allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
            allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
        });
        await mcp.connect(transport);

        httpServer.on('request', (req, res) => {
            if (req.url === '/mcp') {
                void transport.handleRequest(req, res);
            } else {
                res.writeHead(404).end();
            }
        });
        return port;
    }

    const initBody = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
    });

    /** POST /mcp with a precise set of headers; resolves to the HTTP status code. */
    function post(port: number, headers: Record<string, string>): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            const req = httpRequest(
                {
                    host: '127.0.0.1',
                    port,
                    path: '/mcp',
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        accept: 'application/json, text/event-stream',
                        'content-length': Buffer.byteLength(initBody),
                        ...headers,
                    },
                },
                (res) => {
                    res.resume();
                    res.on('end', () => resolve(res.statusCode ?? 0));
                },
            );
            req.on('error', reject);
            req.end(initBody);
        });
    }

    it('rejects a foreign Host header with 403', async () => {
        const port = await startServer();
        expect(await post(port, { host: 'evil.example.com' })).toBe(403);
    });

    it('rejects a foreign Origin header with 403', async () => {
        const port = await startServer();
        expect(await post(port, { host: `127.0.0.1:${port}`, origin: 'http://evil.example.com' })).toBe(403);
    });

    it('accepts the loopback Host/Origin', async () => {
        const port = await startServer();
        const status = await post(port, { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` });
        expect(status).not.toBe(403);
        expect(status).toBeLessThan(400);
    });
});
