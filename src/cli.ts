#!/usr/bin/env node
/**
 * CLI entry — wires the MCP server to a stdio transport (default) or a
 * Streamable HTTP endpoint when PDFNATIVE_MCP_PORT is set.
 *
 * Protocol: MCP 2026-07-28 (stateless, `server/discover`, `subscriptions/listen`)
 * with automatic fallback to the 2025-era `initialize` handshake, so both
 * current and legacy clients (Claude Desktop, Cursor, Continue, …) are served
 * by the same binary.
 *
 * Transport selection:
 *   - stdio (default): suitable for local host integration (Claude Desktop, Cursor, etc.)
 *   - HTTP: set PDFNATIVE_MCP_PORT=<port> to expose the MCP endpoint on that port.
 *           Requests are POST /mcp (2026-07-28 clients send `Mcp-Method` / `Mcp-Name`
 *           headers and the `_meta` envelope; 2025-era clients use `initialize`).
 *           GET/DELETE answer 405 (stateless serving; no SSE resumability).
 *           Bound to 127.0.0.1 only; foreign Host/Origin headers are rejected (403).
 *
 * @example Claude Desktop config (stdio)
 * ```json
 * {
 *   "mcpServers": {
 *     "pdfnative": {
 *       "command": "npx",
 *       "args": ["-y", "pdfnative-mcp"],
 *       "env": { "PDFNATIVE_MCP_OUTPUT_DIR": "/Users/me/Documents/mcp-pdfs" }
 *     }
 *   }
 * }
 * ```
 *
 * @example HTTP mode
 * ```bash
 * PDFNATIVE_MCP_PORT=3000 npx pdfnative-mcp
 * # Then connect via: http://127.0.0.1:3000/mcp
 * ```
 */
import { createServer, ensureCompressionReady } from './server.js';

function log(line: string): void {
    process.stderr.write(`[pdfnative-mcp] ${line}\n`);
}

async function main(): Promise<void> {
    await ensureCompressionReady();

    const factory = (): ReturnType<typeof createServer> => createServer();
    const onerror = (err: Error): void => log(`transport error: ${err.message}`);
    const portEnv = process.env['PDFNATIVE_MCP_PORT'];
    const port = portEnv !== undefined ? parseInt(portEnv, 10) : NaN;

    if (!Number.isNaN(port) && port > 0 && port < 65536) {
        // --- HTTP / Streamable HTTP transport ---
        const { createMcpHandler } = await import('@modelcontextprotocol/server');
        const { guardLoopback, sendWebResponse, toWebRequest } = await import('./http.js');
        const { createServer: createHttpServer } = await import('node:http');

        // Both eras: 2026-07-28 requests are served by a fresh per-request instance;
        // 2025-era requests fall back to the stateless streamable-HTTP idiom.
        const handler = createMcpHandler(factory, { legacy: 'stateless', onerror });
        const origin = `http://127.0.0.1:${port}`;

        const httpServer = createHttpServer((req, res) => {
            void (async () => {
                try {
                    const path = new URL(req.url ?? '/', origin).pathname;
                    if (path !== '/mcp') {
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        res.end('Not Found. MCP endpoint is POST /mcp');
                        return;
                    }
                    const request = await toWebRequest(req, origin);
                    const response = guardLoopback(request) ?? (await handler.fetch(request));
                    await sendWebResponse(res, response);
                } catch (err) {
                    onerror(err instanceof Error ? err : new Error(String(err)));
                    if (!res.headersSent) {
                        res.writeHead(500, { 'Content-Type': 'text/plain' });
                    }
                    res.end();
                }
            })();
        });

        const shutdown = async (signal: string): Promise<void> => {
            log(`received ${signal}, shutting down...`);
            try {
                await handler.close();
                httpServer.close();
            } finally {
                process.exit(0);
            }
        };
        process.on('SIGINT', () => void shutdown('SIGINT'));
        process.on('SIGTERM', () => void shutdown('SIGTERM'));

        await new Promise<void>((resolve, reject) => {
            httpServer.listen(port, '127.0.0.1', () => {
                log(`ready (HTTP transport, MCP 2026-07-28 + legacy) on ${origin}/mcp`);
                resolve();
            });
            httpServer.once('error', reject);
        });
    } else {
        // --- stdio transport (default) ---
        const { serveStdio } = await import('@modelcontextprotocol/server/stdio');

        // The opening exchange pins the protocol era for this process
        // (`server/discover` probe → 2026-07-28, `initialize` → legacy).
        const handle = serveStdio(factory, { legacy: 'serve', onerror });

        const shutdown = async (signal: string): Promise<void> => {
            log(`received ${signal}, shutting down...`);
            try {
                await handle.close();
            } finally {
                process.exit(0);
            }
        };
        process.on('SIGINT', () => void shutdown('SIGINT'));
        process.on('SIGTERM', () => void shutdown('SIGTERM'));

        log('ready (stdio transport, MCP 2026-07-28 + legacy)');
    }
}

main().catch((err: unknown) => {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    log(`fatal: ${message}`);
    process.exit(1);
});
