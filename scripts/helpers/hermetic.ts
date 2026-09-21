/**
 * Hermetic process environment — side-effect module.
 *
 * Import this module FIRST, before anything that loads `src/` or `dist/`.
 * ES modules evaluate imports in source order, so a bare
 * `import './helpers/hermetic.js';` placed above the others runs before them.
 *
 * 1. `TZ=UTC` (see ./tz.ts): expected strings, signing times and TSA instants
 *    are formatted by the host calendar, so the zone is pinned even though
 *    pdfnative >= 1.8 writes its own dates in UTC.
 * 2. Every operator knob inherited from the parent shell is removed. The
 *    server reads `PDFNATIVE_MCP_*` once at boot (output sandbox, inflate cap,
 *    TSA / revocation endpoints, creation-date pin, HTTP token); a developer's
 *    shell must not change the bytes a script produces, nor open an egress
 *    path. `PDFNATIVE_MPC_*` is the deprecated misspelt alias still honoured
 *    by src/output.ts. `SOURCE_DATE_EPOCH` is the reproducible-builds.org pin
 *    the server honours when its own variable is absent.
 *
 * Scripts that want a pin set it explicitly after this import.
 */
import './tz.js';

/** True for a variable the server (or the engine pin) would read at boot. */
export function isOperatorKnob(name: string): boolean {
    return name.startsWith('PDFNATIVE_MCP_') || name.startsWith('PDFNATIVE_MPC_') || name === 'SOURCE_DATE_EPOCH';
}

/** Remove every operator knob from `env` in place; returns the removed names. */
export function scrubEnv(env: NodeJS.ProcessEnv): string[] {
    const removed: string[] = [];
    for (const key of Object.keys(env)) {
        if (isOperatorKnob(key)) {
            delete env[key];
            removed.push(key);
        }
    }
    return removed;
}

scrubEnv(process.env);
process.env.NO_COLOR = '1';
process.env.FORCE_COLOR = '0';
