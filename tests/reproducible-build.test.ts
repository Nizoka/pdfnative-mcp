/**
 * Reproducible output, proven on the BUILT server across time zones.
 *
 * pdfnative >= 1.8 writes every date in UTC, so a pinned document must be the
 * same bytes on every host. Unit tests cannot show that: vitest pins TZ=UTC for
 * the whole run. This suite spawns `dist/cli.js` under two real zones, 22 hours
 * apart and on opposite sides of the date line, and compares what comes back.
 *
 * Requires `npm run build`; skipped locally when dist/ is absent, a hard
 * failure under CI and the gate (see tests/_stdio-session.ts).
 */
import { describe, expect, it } from 'vitest';

import { INITIALIZE, artifactsRequired, hasDist, runStdioSession, type StdioSession } from './_stdio-session.js';

/** UTC+14 and UTC-8/-7: the same instant falls on different calendar days in each. */
const ZONES = ['Pacific/Kiritimati', 'America/Los_Angeles'] as const;

const DOCUMENT = {
    title: 'Reproducible',
    blocks: [{ type: 'heading', text: 'Same bytes everywhere', level: 1 }, { type: 'paragraph', text: 'Pinned instant, UTC dates.' }],
    footerTemplate: { left: 'Built {date}', right: '{page}/{pages}' },
};
// 23:30 UTC: already the next day in Kiritimati, still the previous afternoon in Los Angeles.
const PINNED = '2026-01-01T23:30:00Z';

function call(id: number, name: string, args: Record<string, unknown>): Record<string, unknown> {
    return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
}

function blobOf(session: StdioSession, id: number): string {
    const result = session.frames.find((f) => f.id === id)?.result as { isError?: boolean; content?: Array<{ type: string; text?: string; resource?: { blob?: string } }> } | undefined;
    expect(result, `no response for request ${id}; stderr: ${session.stderr}`).toBeDefined();
    expect(result?.isError, result?.content?.[0]?.text).not.toBe(true);
    const blob = result?.content?.find((c) => c.type === 'resource')?.resource?.blob;
    expect(typeof blob).toBe('string');
    return blob as string;
}

const latin1 = (base64: string): string => Buffer.from(base64, 'base64').toString('latin1');

describe('dist/cli.js presence (reproducible-build)', () => {
    it.runIf(artifactsRequired)('is built before the test run in CI and under the gate', () => {
        expect(hasDist, 'dist/cli.js is missing — the gate builds before it tests; run `npm run build`').toBe(true);
    });
});

describe.skipIf(!hasDist)('the built server writes the same bytes under every time zone', () => {
    it("a call pinned with creationDate is byte-identical in two zones, and the dates are UTC", async () => {
        const blobs: string[] = [];
        for (const TZ of ZONES) {
            const session = await runStdioSession([...INITIALIZE, call(2, 'generate_basic_pdf', { ...DOCUMENT, creationDate: PINNED })], [1, 2], { TZ });
            blobs.push(blobOf(session, 2));
        }
        expect(blobs[0]).toBe(blobs[1]);
        const pdf = latin1(blobs[0]!);
        expect(pdf).toMatch(/\/CreationDate\s*\(D:20260101233000\+00'00'\)/);
        // The UTC calendar date — not Kiritimati's 2 January, not a local rendering.
        expect(pdf).toContain('Built 2026-01-01');
    }, 60_000);

    it('SOURCE_DATE_EPOCH pins the whole process: unpinned calls become reproducible, and the boot log says why', async () => {
        const epoch = String(Date.parse(PINNED) / 1000);
        const blobs: string[] = [];
        for (const TZ of ZONES) {
            const session = await runStdioSession([...INITIALIZE, call(2, 'generate_basic_pdf', DOCUMENT), call(3, 'generate_basic_pdf', DOCUMENT)], [1, 2, 3], { TZ, SOURCE_DATE_EPOCH: epoch });
            expect(session.stderr).toContain('creation date pinned to 2026-01-01T23:30:00.000Z (SOURCE_DATE_EPOCH)');
            // Every stdout line is a JSON-RPC frame: the boot log went to stderr.
            expect(session.stdoutLines.length).toBe(session.frames.length);
            expect(blobOf(session, 2)).toBe(blobOf(session, 3));
            blobs.push(blobOf(session, 2));
        }
        expect(blobs[0]).toBe(blobs[1]);
    }, 60_000);

    it('PDFNATIVE_MCP_CREATION_DATE wins over SOURCE_DATE_EPOCH, and the pinned bytes equal the per-call ones', async () => {
        const pinned = await runStdioSession([...INITIALIZE, call(2, 'generate_basic_pdf', DOCUMENT)], [1, 2], { PDFNATIVE_MCP_CREATION_DATE: PINNED, SOURCE_DATE_EPOCH: '0', TZ: ZONES[0] });
        expect(pinned.stderr).toContain('(PDFNATIVE_MCP_CREATION_DATE)');
        const perCall = await runStdioSession([...INITIALIZE, call(2, 'generate_basic_pdf', { ...DOCUMENT, creationDate: PINNED })], [1, 2], { TZ: ZONES[1] });
        expect(blobOf(pinned, 2)).toBe(blobOf(perCall, 2));
    }, 60_000);

    it('without any pin two calls differ (the wall clock is what changes them), so the pin is what does the work', async () => {
        const session = await runStdioSession([...INITIALIZE, call(2, 'generate_basic_pdf', DOCUMENT)], [1, 2], { TZ: ZONES[0] });
        expect(session.stderr).not.toContain('creation date pinned');
        const stamp = /\/CreationDate\s*\(D:(\d{14})\+00'00'\)/.exec(latin1(blobOf(session, 2)));
        expect(stamp, 'an unpinned document still carries a UTC creation date').not.toBeNull();
        expect(stamp![1]!.slice(0, 4)).toBe(String(new Date().getUTCFullYear()));
    }, 60_000);

    it.each([
        ['SOURCE_DATE_EPOCH', 'not-a-number'],
        ['PDFNATIVE_MCP_CREATION_DATE', '2026-01-01'],
    ])('an invalid %s refuses to start instead of serving on the wall clock', async (name, value) => {
        const session = await runStdioSession([...INITIALIZE], [1], { [name]: value }).catch((err: Error) => err);
        // The process exits before answering: either the harness reports the exit, or it times out on a dead child.
        if (session instanceof Error) throw session;
        expect(session.frames.find((f) => f.id === 1)).toBeUndefined();
        expect(session.exitCode).not.toBe(0);
        expect(session.stderr).toContain(name);
    }, 60_000);
});
