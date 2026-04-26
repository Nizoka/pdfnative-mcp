#!/usr/bin/env node
/**
 * CLI entry — wires the MCP server to a stdio transport (default) or a
 * Streamable HTTP transport when PDFNATIVE_MCP_PORT is set.
 *
 * Transport selection:
 *   - stdio (default): suitable for local host integration (Claude Desktop, Cursor, etc.)
 *   - HTTP: set PDFNATIVE_MCP_PORT=<port> to expose the MCP endpoint on that port.
 *           Requests must be POST to /mcp. Useful for remote or containerised deployments.
 *
 * @example Claude Desktop config (stdio)
 * ```json
 * {
 *   "mcpServers": {
 *     "pdfnative": {
 *       "command": "npx",
 *       "args": ["-y", "pdfnative-mcp"],
 *       "env": { "PDFNATIVE_MPC_OUTPUT_DIR": "/Users/me/Documents/mcp-pdfs" }
 *     }
 *   }
 * }
 * ```
 *
 * @example HTTP mode
 * ```bash
 * PDFNATIVE_MCP_PORT=3000 npx pdfnative-mcp
 * # Then connect via: http://localhost:3000/mcp
 * ```
 */
import { createServer, ensureCompressionReady } from './server.js';

async function main(): Promise<void> {
    await ensureCompressionReady();

    const server = createServer();
    const portEnv = process.env['PDFNATIVE_MCP_PORT'];
    const port = portEnv !== undefined ? parseInt(portEnv, 10) : NaN;

    if (!Number.isNaN(port) && port > 0 && port < 65536) {
        // --- HTTP / Streamable HTTP transport ---
        const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
        const { createServer: createHttpServer } = await import('node:http');

        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

        const shutdown = async (signal: string): Promise<void> => {
            process.stderr.write(`\n[pdfnative-mcp] received ${signal}, shutting down...\n`);
            try {
                await server.close();
            } finally {
                process.exit(0);
            }
        };

        process.on('SIGINT', () => void shutdown('SIGINT'));
        process.on('SIGTERM', () => void shutdown('SIGTERM'));

        const httpServer = createHttpServer(async (req, res) => {
            if (req.url === '/mcp' && req.method === 'POST') {
                await transport.handleRequest(req, res);
            } else if (req.url === '/mcp' && req.method === 'GET') {
                await transport.handleRequest(req, res);
            } else if (req.url === '/mcp' && req.method === 'DELETE') {
                await transport.handleRequest(req, res);
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found. MCP endpoint is POST /mcp');
            }
        });

        await server.connect(transport);

        await new Promise<void>((resolve, reject) => {
            httpServer.listen(port, '127.0.0.1', () => {
                process.stderr.write(`[pdfnative-mcp] ready (HTTP transport) on http://127.0.0.1:${port}/mcp\n`);
                resolve();
            });
            httpServer.once('error', reject);
        });
    } else {
        // --- stdio transport (default) ---
        const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');

        const transport = new StdioServerTransport();

        const shutdown = async (signal: string): Promise<void> => {
            process.stderr.write(`\n[pdfnative-mcp] received ${signal}, shutting down...\n`);
            try {
                await server.close();
            } finally {
                process.exit(0);
            }
        };

        process.on('SIGINT', () => void shutdown('SIGINT'));
        process.on('SIGTERM', () => void shutdown('SIGTERM'));

        await server.connect(transport);
        process.stderr.write('[pdfnative-mcp] ready (stdio transport)\n');
    }
}

main().catch((err: unknown) => {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    process.stderr.write(`[pdfnative-mcp] fatal: ${message}\n`);
    process.exit(1);
});

