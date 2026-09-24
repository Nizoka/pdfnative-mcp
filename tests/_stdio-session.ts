/**
 * Shared harness: spawn the BUILT server (`dist/cli.js`) and drive it over
 * newline-delimited JSON-RPC exactly as an MCP host would. Used by
 * tests/cli-stdio.test.ts (protocol, stdout purity) and
 * tests/reproducible-build.test.ts (same bytes under two time zones).
 *
 * Requires `npm run build`. Locally a suite skips with a console note when
 * dist/ is absent; under CI (`process.env.CI`) or the gate
 * (`GATE_REQUIRE_ARTIFACTS=1`) a missing dist/ is a hard failure — the
 * workflows and the gate build before testing, otherwise these end-to-end
 * suites would silently vanish from the release gate.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CLI = path.resolve(here, '..', 'dist', 'cli.js');
export const hasDist = existsSync(CLI);

const truthy = (v: string | undefined): boolean => v !== undefined && v !== '' && v !== 'false' && v !== '0';
/** True when a missing build artefact must fail instead of skipping. */
export const artifactsRequired = truthy(process.env['CI']) || truthy(process.env['GATE_REQUIRE_ARTIFACTS']);

export interface Frame {
    id?: number;
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
}

export interface StdioSession {
    frames: Frame[];
    stdoutLines: string[];
    stderr: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
}

/**
 * After every expected response arrived the child is asked to stop. On POSIX
 * that is a real SIGTERM (the server's handler closes the transport and exits
 * 0). On win32 `child.kill('SIGTERM')` is Node's emulation over
 * TerminateProcess: the process is torn down without running any handler and
 * reports `{ code: null, signal: 'SIGTERM' }` (or code 1), so a clean-exit
 * assertion is impossible there — callers only assert termination on Windows
 * and assert `code 0 / signal null` on POSIX.
 *
 * `env` is merged over a copy of the parent environment with every operator
 * knob removed, so a developer's shell cannot change what the server does.
 */
/**
 * `messages` are written one per line: an object is JSON-encoded, a string is
 * written verbatim (a malformed or truncated frame, for the transport tests).
 * With `closeStdin`, stdin is ended after the last write and the session
 * resolves on the child's own exit — the EOF contract — instead of SIGTERM.
 */
export function runStdioSession(
    messages: Array<Record<string, unknown> | string>,
    expectIds: number[],
    env: Readonly<Record<string, string>> = {},
    closeStdin = false,
): Promise<StdioSession> {
    return new Promise((resolve, reject) => {
        const base: NodeJS.ProcessEnv = { ...process.env };
        for (const key of Object.keys(base)) {
            if (key.startsWith('PDFNATIVE_MCP_') || key.startsWith('PDFNATIVE_MPC_') || key === 'SOURCE_DATE_EPOCH') delete base[key];
        }
        const child = spawn(process.execPath, [CLI], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...base, PDFNATIVE_MCP_PORT: '', ...env } });
        const stdoutLines: string[] = [];
        const frames: Frame[] = [];
        let stderr = '';
        let buffer = '';
        const pending = new Set(expectIds);
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
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
                if (pending.size === 0 && !closeStdin) {
                    child.kill('SIGTERM');
                }
            }
        });
        child.on('exit', (code, signal) => {
            clearTimeout(timer);
            resolve({ frames, stdoutLines, stderr, exitCode: code, signal });
        });
        child.on('error', reject);
        // A server that refuses to start closes its stdin first: EPIPE here is the
        // expected outcome of that scenario, and the `exit` event carries the verdict.
        child.stdin.on('error', () => undefined);
        for (const m of messages) child.stdin.write(`${typeof m === 'string' ? m : JSON.stringify(m)}\n`);
        if (closeStdin) child.stdin.end();
    });
}

/** The 2025-era opening handshake every legacy host sends. */
export const INITIALIZE = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
] as const;
