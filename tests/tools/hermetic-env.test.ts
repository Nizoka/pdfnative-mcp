// scripts/helpers/hermetic.ts is imported first by every generator and by
// the gate: it pins TZ=UTC and removes every operator knob inherited from the
// developer's shell, so a local PDFNATIVE_MCP_TSA_URL can neither change the
// bytes a script produces nor open an egress path. These tests hold that
// promise, and hold it to the variables server.json actually declares.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isOperatorKnob, scrubEnv } from '../../scripts/helpers/hermetic.js';
import { serverJsonEnvVars } from '../../scripts/lib/mcp-surface.js';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('hermetic environment', () => {
    it('pins the process time zone to UTC on import', () => {
        expect(process.env['TZ']).toBe('UTC');
        expect(new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset()).toBe(0);
    });

    it('recognises every variable server.json declares as an operator knob', () => {
        const declared = serverJsonEnvVars(readFileSync(resolve(ROOT, 'server.json'), 'utf8'));
        expect(declared.length).toBeGreaterThanOrEqual(12);
        for (const name of declared) expect(isOperatorKnob(name), name).toBe(true);
    });

    it('recognises the deprecated misspelt prefix and SOURCE_DATE_EPOCH, and nothing unrelated', () => {
        expect(isOperatorKnob('PDFNATIVE_MPC_OUTPUT_DIR')).toBe(true);
        expect(isOperatorKnob('SOURCE_DATE_EPOCH')).toBe(true);
        for (const name of ['PATH', 'TZ', 'NODE_OPTIONS', 'GATE', 'GATE_REQUIRE_ARTIFACTS', 'VERAPDF_HOME', 'JAVACMD', 'PDFNATIVE', 'XPDFNATIVE_MCP_X']) {
            expect(isOperatorKnob(name), name).toBe(false);
        }
    });

    it('scrubs the knobs in place, reports them, and leaves the rest of the environment alone', () => {
        const env: NodeJS.ProcessEnv = {
            PATH: '/usr/bin',
            TZ: 'UTC',
            PDFNATIVE_MCP_TSA_URL: 'https://tsa.example/',
            PDFNATIVE_MCP_TSA_AUTH: 'Bearer secret',
            PDFNATIVE_MCP_OUTPUT_DIR: '/tmp/out',
            PDFNATIVE_MPC_OUTPUT_DIR: '/tmp/old',
            SOURCE_DATE_EPOCH: '1767225600',
            VERAPDF_HOME: '/opt/verapdf',
        };
        const removed = scrubEnv(env).sort();
        expect(removed).toEqual(['PDFNATIVE_MCP_OUTPUT_DIR', 'PDFNATIVE_MCP_TSA_AUTH', 'PDFNATIVE_MCP_TSA_URL', 'PDFNATIVE_MPC_OUTPUT_DIR', 'SOURCE_DATE_EPOCH']);
        expect(env).toEqual({ PATH: '/usr/bin', TZ: 'UTC', VERAPDF_HOME: '/opt/verapdf' });
        expect(scrubEnv(env)).toEqual([]);
    });

    it('left no operator knob in this process after the import', () => {
        expect(Object.keys(process.env).filter(isOperatorKnob)).toEqual([]);
    });
});
