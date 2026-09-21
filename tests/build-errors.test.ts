/**
 * Engine build errors → stable ToolError codes.
 *
 * pdfnative refuses incoherent build requests with plain `Error`s. Its
 * machine-readable registry (docs/data/errors.json → `buildErrors`) is copied
 * to tests/_fixtures/pdfnative-build-errors.json with the code this server
 * maps each message to. The contract: a KNOWN engine build error never falls
 * through to GENERATION_FAILED — an agent must be able to tell "fix your
 * arguments" from "something broke".
 *
 * Most of these are refused before the build, in this server's own vocabulary
 * (assertPdfXCompatible, assertPrintPdfACompatible, …); the mapping is the
 * second line of defence, and the only one for what can be seen in the bytes
 * alone (an ICC profile's device class, signature and size).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { mapBuildError } from '../src/diagnostics.js';

interface BuildErrorEntry { readonly thrownBy: string; readonly since: string; readonly message: string; readonly code: string }
interface Fixture { readonly engine: string; readonly messages: readonly BuildErrorEntry[] }

const ROOT = resolve(import.meta.dirname, '..');
const fixture = JSON.parse(readFileSync(resolve(ROOT, 'tests/_fixtures/pdfnative-build-errors.json'), 'utf8')) as Fixture;

describe('mapBuildError over the engine build-error registry', () => {
    it('is the registry of the engine release the server is pinned to', () => {
        const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
        expect(pkg.dependencies['pdfnative']).toBe(`^${fixture.engine}`);
        expect(fixture.messages.length).toBeGreaterThanOrEqual(23);
    });

    it.each(fixture.messages.map((m) => [m.message.slice(0, 70), m] as const))('%s', (_label, entry) => {
        const mapped = mapBuildError(new Error(entry.message), 'generate_basic_pdf');
        expect(mapped.code).toBe(entry.code);
        expect(mapped.code, 'a known engine build error is never a generic failure').not.toBe('GENERATION_FAILED');
        // The engine message carries the remedy: it is kept verbatim.
        expect(mapped.message).toContain(entry.message);
    });

    it('keeps the same verdict when the engine prefixes the message', () => {
        for (const entry of fixture.messages) {
            expect(mapBuildError(new Error(`pdfnative: ${entry.message}`), 't').code, entry.message).not.toBe('GENERATION_FAILED');
        }
    });

    it('every PDF/X coherence message is an argument error, even though it names the OutputIntent', () => {
        const pdfx = fixture.messages.filter((m) => m.thrownBy.includes('resolvePdfXConfig') || m.thrownBy.includes('pdfxBoxes'));
        expect(pdfx).toHaveLength(7);
        for (const entry of pdfx) expect(entry.code, entry.message).toBe('VALIDATION_ERROR');
    });

    it('an unknown message still degrades to GENERATION_FAILED, naming the tool', () => {
        expect(mapBuildError(new Error('something nobody has seen before'), 'add_table')).toMatchObject({ code: 'GENERATION_FAILED', message: 'add_table: something nobody has seen before' });
    });
});

// pdfnative does not ship docs/ in its npm tarball: the drift check runs where the
// sibling checkout exists (the maintainer's machine), never on a CI runner.
const ENGINE_ERRORS = resolve(ROOT, '..', 'pdfnative', 'docs', 'data', 'errors.json');

describe.skipIf(!existsSync(ENGINE_ERRORS))('the fixture is still the engine registry', () => {
    it('lists every buildErrors[] message of the sibling checkout, template for template', () => {
        const engine = JSON.parse(readFileSync(ENGINE_ERRORS, 'utf8')) as { buildErrors: Array<{ message: string }> };
        expect(fixture.messages).toHaveLength(engine.buildErrors.length);
        // A template matches its substituted copy when every literal segment appears, in order.
        const matches = (template: string, concrete: string): boolean => {
            let at = 0;
            for (const literal of template.split(/\$\{[^}]+\}/)) {
                const found = concrete.indexOf(literal, at);
                if (found < 0) return false;
                at = found + literal.length;
            }
            return true;
        };
        const unmatched = engine.buildErrors.filter((e) => !fixture.messages.some((m) => matches(e.message, m.message))).map((e) => e.message);
        expect(unmatched, 'engine build errors missing from tests/_fixtures/pdfnative-build-errors.json').toEqual([]);
    });
});
