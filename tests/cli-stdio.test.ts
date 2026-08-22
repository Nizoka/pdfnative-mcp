import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * End-to-end stdio smoke: spawns the built CLI and drives it over
 * newline-delimited JSON-RPC exactly as an MCP host would.
 *
 * Guards the two properties a stdio server cannot violate: stdout carries
 * nothing but JSON-RPC frames (engine diagnostics must stay on stderr), and
 * both protocol eras are served by the same process (2025 `initialize`
 * handshake here; `server/discover` probe for 2026-07-28 hosts).
 *
 * Requires `npm run build` (dist/cli.js); skipped with a clear message otherwise.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '..', 'dist', 'cli.js');
const hasDist = existsSync(CLI);

interface Frame {
    id?: number;
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
}

function runStdioSession(messages: Array<Record<string, unknown>>, expectIds: number[]): Promise<{ frames: Frame[]; stdoutLines: string[]; stderr: string; exitCode: number | null }> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [CLI], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PDFNATIVE_MCP_PORT: '' } });
        const stdoutLines: string[] = [];
        const frames: Frame[] = [];
        let stderr = '';
        let buffer = '';
        const pending = new Set(expectIds);
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`stdio session timed out; stderr: ${stderr}`));
        }, 20_000);

        child.stderr.on('data', (c: Buffer) => {
            stderr += c.toString('utf8');
        });
        child.stdout.on('data', (c: Buffer) => {
            buffer += c.toString('utf8');
            let idx: number;
            while ((idx = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, idx).trim();
                buffer = buffer.slice(idx + 1);
                if (line.length === 0) continue;
                stdoutLines.push(line);
                try {
                    const frame = JSON.parse(line) as Frame;
                    frames.push(frame);
                    if (typeof frame.id === 'number') pending.delete(frame.id);
                } catch {
                    /* non-JSON line — asserted by the test */
                }
                if (pending.size === 0) {
                    child.kill('SIGTERM');
                }
            }
        });
        child.on('exit', (code) => {
            clearTimeout(timer);
            resolve({ frames, stdoutLines, stderr, exitCode: code });
        });
        child.on('error', reject);
        for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`);
    });
}

describe.skipIf(!hasDist)('dist/cli.js over stdio', () => {
    it('serves a legacy initialize → tools/list → tools/call session with JSON-only stdout', async () => {
        const session = await runStdioSession(
            [
                { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } },
                { jsonrpc: '2.0', method: 'notifications/initialized' },
                { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
                {
                    jsonrpc: '2.0',
                    id: 3,
                    method: 'tools/call',
                    params: { name: 'generate_basic_pdf', arguments: { title: 'Stdio', blocks: [{ type: 'paragraph', text: 'hello stdio' }], pdfA: 'pdfa2b' } },
                },
            ],
            [1, 2, 3],
        );

        // Every stdout line must be a JSON-RPC frame — engine warnings (e.g. the PDF/A
        // font diagnostic triggered by pdfA above) must never leak onto stdout.
        for (const line of session.stdoutLines) {
            expect(() => JSON.parse(line), `non-JSON stdout line: ${line.slice(0, 120)}`).not.toThrow();
        }
        expect(session.stderr).toContain('[pdfnative-mcp] ready (stdio transport');

        const init = session.frames.find((f) => f.id === 1)?.result as { protocolVersion?: string; serverInfo?: { name?: string } } | undefined;
        expect(init?.protocolVersion).toBe('2025-11-25');
        expect(init?.serverInfo?.name).toBe('pdfnative-mcp');

        const tools = (session.frames.find((f) => f.id === 2)?.result as { tools?: Array<{ name: string }> } | undefined)?.tools ?? [];
        expect(tools.length).toBeGreaterThanOrEqual(24);

        const call = session.frames.find((f) => f.id === 3)?.result as { isError?: boolean; content?: Array<{ type: string; resource?: { mimeType?: string } }> } | undefined;
        expect(call?.isError).not.toBe(true);
        expect(call?.content?.some((c) => c.type === 'resource' && c.resource?.mimeType === 'application/pdf')).toBe(true);
    });

    it('answers a 2026-07-28 server/discover probe', async () => {
        const session = await runStdioSession(
            [
                {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'server/discover',
                    params: {
                        _meta: {
                            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                            'io.modelcontextprotocol/clientCapabilities': {},
                            'io.modelcontextprotocol/clientInfo': { name: 'smoke', version: '0' },
                        },
                    },
                },
            ],
            [1],
        );
        const result = session.frames.find((f) => f.id === 1)?.result as { supportedVersions?: string[]; resultType?: string } | undefined;
        expect(result?.resultType).toBe('complete');
        expect(result?.supportedVersions).toContain('2026-07-28');
    });
});
