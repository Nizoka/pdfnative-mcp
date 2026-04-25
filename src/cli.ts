#!/usr/bin/env node
/**
 * CLI entry — wires the MCP server to a stdio transport. Designed to be spawned
 * by an MCP-compatible host (Claude Desktop, Cursor, Continue, etc.).
 *
 * @example Claude Desktop config
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
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, ensureCompressionReady } from './server.js';

async function main(): Promise<void> {
    await ensureCompressionReady();

    const server = createServer();
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

main().catch((err: unknown) => {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    process.stderr.write(`[pdfnative-mcp] fatal: ${message}\n`);
    process.exit(1);
});
