import { spawn } from 'node:child_process';

import { describe, it, expect } from 'vitest';

import { CLI, artifactsRequired, hasDist, runStdioSession, type StdioSession } from './_stdio-session.js';

/**
 * End-to-end stdio smoke: spawns the built CLI and drives it over
 * newline-delimited JSON-RPC exactly as an MCP host would.
 *
 * Guards the two properties a stdio server cannot violate: stdout carries
 * nothing but JSON-RPC frames (engine diagnostics must stay on stderr), and
 * both protocol eras are served by the same process (2025 `initialize`
 * handshake here; `server/discover` probe for 2026-07-28 hosts).
 *
 * Requires `npm run build` (dist/cli.js). Locally the suite is skipped with a
 * console note when dist/ is absent; under CI (`process.env.CI` set) a missing
 * dist/ is a hard failure — the workflows must build before testing, otherwise
 * this end-to-end smoke would silently vanish from the release gate.
 */
// CI and the gate (GATE_REQUIRE_ARTIFACTS=1) both require the built artefact.
const inCi = artifactsRequired;

if (!hasDist && !inCi) {
    console.warn(`[cli-stdio] dist/cli.js not found — run \`npm run build\` first; skipping the stdio smoke suite (it FAILS under CI).`);
}

describe('dist/cli.js presence', () => {
    it.runIf(inCi)('is built before the test run in CI (build must precede test in every workflow)', () => {
        expect(hasDist, `dist/cli.js is missing under CI — run \`npm run build\` before \`npm test\` (see .github/workflows/*.yml)`).toBe(true);
    });
});

/** Clean-exit assertion, platform-aware (see runStdioSession). */
function expectCleanExit(session: StdioSession): void {
    if (process.platform === 'win32') {
        // TerminateProcess: the child is gone, but no exit code is meaningful.
        expect(session.exitCode !== null || session.signal !== null, 'child process did not terminate').toBe(true);
        return;
    }
    expect(session.signal, `server was killed by ${session.signal} instead of exiting on SIGTERM; stderr: ${session.stderr}`).toBeNull();
    expect(session.exitCode, `SIGTERM exit code; stderr: ${session.stderr}`).toBe(0);
}

describe.skipIf(!hasDist)('dist/cli.js over stdio', () => {
    it.each(['2025-03-26', '2025-06-18'])('negotiates the older 2025 revision %s on stdio and serves tools/list', async (version) => {
        const session = await runStdioSession(
            [
                { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: version, capabilities: {}, clientInfo: { name: 'legacy', version: '0' } } },
                { jsonrpc: '2.0', method: 'notifications/initialized' },
                { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
            ],
            [1, 2],
        );
        const init = session.frames.find((f) => f.id === 1)?.result as { protocolVersion?: string } | undefined;
        expect(init?.protocolVersion).toBe(version);
        const tools = (session.frames.find((f) => f.id === 2)?.result as { tools?: Array<{ name: string }> } | undefined)?.tools ?? [];
        expect(tools.length).toBe(28);
    });

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

    it('exits cleanly on SIGTERM once the session is done', async () => {
        const session = await runStdioSession(
            [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } }],
            [1],
        );
        expect(session.frames.find((f) => f.id === 1)?.result).toBeDefined();
        expectCleanExit(session);
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

describe.skipIf(!hasDist)('dist/cli.js over stdio — large frames', () => {
    it('accepts a single JSON-RPC frame larger than the SDK default 10 MiB cap without dying', async () => {
        const big = 'A'.repeat(11 * 1024 * 1024); // ~11 MiB base64 string (garbage → tool error, but the frame must arrive)
        const session = await runStdioSession(
            [
                { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } },
                { jsonrpc: '2.0', method: 'notifications/initialized' },
                { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'inspect_pdf', arguments: { pdfBase64: big } } },
                { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
            ],
            [1, 2, 3],
        );
        expect(session.stderr).not.toContain('ReadBuffer exceeded');
        const call = session.frames.find((f) => f.id === 2)?.result as { isError?: boolean } | undefined;
        expect(call?.isError).toBe(true); // garbage PDF → tool error, delivered
        expect(session.frames.find((f) => f.id === 3)?.result).toBeDefined(); // the server is still alive afterwards
        expectCleanExit(session);
    }, 60_000);
});

/**
 * Frames outside the happy path — the stdio server's untrusted boundary. The
 * contract pinned here is the SDK's, observed on the built server: a line
 * that is not JSON is dropped without a reply (HTTP answers −32700, stdio
 * cannot address a reply to a frame it could not parse), an unknown method
 * is answered −32601, and a truncated frame followed by EOF ends the process
 * cleanly with nothing but JSON-RPC frames on stdout.
 */
describe.skipIf(!hasDist)('dist/cli.js over stdio — frames outside the happy path', () => {
    const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'hostile', version: '0' } } };
    const INITIALIZED = { jsonrpc: '2.0', method: 'notifications/initialized' };

    it('drops a line that is not JSON without a reply and keeps serving the session', async () => {
        const session = await runStdioSession([INIT, INITIALIZED, '{not json', 'null', '[]', { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }], [1, 2]);
        expect(session.frames.map((f) => f.id)).toEqual([1, 2]);
        expect(session.stdoutLines.length).toBe(session.frames.length); // every stdout line parsed as a frame
        expect((session.frames[1]?.result as { tools?: unknown[] } | undefined)?.tools?.length).toBe(28);
        expectCleanExit(session);
    });

    it('answers an unknown method with −32601 and no isError result', async () => {
        const session = await runStdioSession([INIT, INITIALIZED, { jsonrpc: '2.0', id: 2, method: 'no/such_method', params: {} }, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }], [1, 2, 3]);
        const unknown = session.frames.find((f) => f.id === 2);
        expect(unknown?.error?.code).toBe(-32601);
        expect(unknown?.result).toBeUndefined();
        expect(session.frames.find((f) => f.id === 3)?.result).toBeDefined();
        expectCleanExit(session);
    });

    it('exits 0 with a pure stdout when the last frame is truncated and stdin closes', async () => {
        const truncated = '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"inspect_pdf","arguments":{"pdfBase64":"JVBERi0x"}';
        const session = await runStdioSession([INIT, INITIALIZED, truncated], [1], {}, true);
        expect(session.frames.map((f) => f.id)).toEqual([1]);
        for (const line of session.stdoutLines) expect(() => JSON.parse(line)).not.toThrow();
        expect(session.signal).toBeNull();
        expect(session.exitCode, `stderr: ${session.stderr}`).toBe(0);
    });
});

describe.skipIf(!hasDist)('dist/cli.js — PDFNATIVE_MCP_MAX_INFLATE_BYTES', () => {
    function spawnWithCap(value: string): Promise<{ code: number | null; stderr: string }> {
        return new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [CLI], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env, PDFNATIVE_MCP_PORT: '', PDFNATIVE_MCP_MAX_INFLATE_BYTES: value },
            });
            let stderr = '';
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                reject(new Error(`startup timed out; stderr: ${stderr}`));
            }, 20_000);
            child.stderr.on('data', (c: Buffer) => {
                stderr += c.toString('utf8');
                // A valid cap is logged before "ready"; stop the child once it is serving.
                if (stderr.includes('ready (stdio transport')) child.kill('SIGTERM');
            });
            child.on('exit', (code) => {
                clearTimeout(timer);
                resolve({ code, stderr });
            });
            child.on('error', reject);
        });
    }

    it('refuses to start on an invalid value', async () => {
        const { code, stderr } = await spawnWithCap('lots');
        expect(code).toBe(1);
        expect(stderr).toContain('fatal:');
        expect(stderr).toContain('PDFNATIVE_MCP_MAX_INFLATE_BYTES');
    });

    it('logs the applied cap and serves on a valid value', async () => {
        const { stderr } = await spawnWithCap('4194304');
        expect(stderr).toContain('decompression cap set to 4194304 bytes');
        expect(stderr).toContain('ready (stdio transport');
    });
});
