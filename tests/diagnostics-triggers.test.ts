/**
 * Every engine diagnostic, triggered through `tools/call`.
 *
 * For each of the nine codes: the default call succeeds (a diagnostic is a
 * warning), `includeDiagnostics` reports the code, and `strict` turns it into
 * the ToolError its prefix maps to — without producing a file.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { DIAGNOSTIC_CODES } from '../src/diagnostics.js';
import { callToolDirect, ensureCompressionReady } from '../src/server.js';
import { DIAGNOSTIC_TRIGGERS } from './_diagnostic-triggers.js';

beforeAll(async () => {
    await ensureCompressionReady();
});

describe('diagnostic triggers', () => {
    it('cover exactly the codes the engine can raise', () => {
        expect(Object.keys(DIAGNOSTIC_TRIGGERS).sort()).toEqual([...DIAGNOSTIC_CODES].sort());
    });

    it.each(Object.entries(DIAGNOSTIC_TRIGGERS))('%s: reported with includeDiagnostics, escalated by strict', async (code, trigger) => {
        const plain = await callToolDirect(trigger.tool, trigger.args);
        expect(plain.isError, `${code}: a diagnostic is a warning, the default call succeeds`).not.toBe(true);
        const structured = (r: { structuredContent?: unknown }): Record<string, unknown> => (r.structuredContent ?? {}) as Record<string, unknown>;
        expect(structured(plain)['diagnostics'], 'diagnostics are opt-in').toBeUndefined();

        const reported = await callToolDirect(trigger.tool, { ...trigger.args, includeDiagnostics: true });
        const diagnostics = (structured(reported)['diagnostics'] ?? []) as Array<{ code: string; message: string; severity: string }>;
        expect(diagnostics.map((d) => d.code)).toContain(code);
        for (const d of diagnostics) {
            expect(d.severity).toBe('warning');
            expect(d.message.length).toBeGreaterThan(20);
        }

        const strict = await callToolDirect(trigger.tool, { ...trigger.args, strict: true });
        expect(strict.isError).toBe(true);
        const text = strict.content.find((c) => c.type === 'text') as { text: string };
        expect(text.text).toContain(`[${trigger.strictCode}]`);
        // No PDF leaves the server under strict.
        expect(strict.content.some((c) => c.type === 'resource')).toBe(false);
    }, 60_000);
});
