/**
 * pdfnative-mcp — hermetic example runner (pure planning + a driver)
 * ===================================================================
 * `examples/*.json` are the published MCP call payloads. tests/examples.test.ts
 * runs ALL of them live, with a mock PKI, a loopback TSA and mock OCSP / CRL
 * responders. The sample generator cannot use those fixtures — they live under
 * tests/ and the gate is hermetic — so it runs the subset that needs nothing
 * but the server itself, and says which ones it left out and why.
 *
 * An example is hermetic when every `<placeholder>` in it resolves from:
 *   - the PDF produced by an earlier step (`<base64 from step N>`,
 *     `<base64-of-the-generated-pdf>`),
 *   - a plain generated document (`<any PDF base64>`),
 *   - the synthetic CMYK output profile (`<synthetic CMYK prtr ICC, base64>`).
 * Certificates, keys, revocation data and pre-encrypted inputs are not: those
 * examples stay covered by the vitest suite.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from '../helpers/io.js';
import { buildSyntheticCmykProfile, iccBase64 } from './synthetic-icc.js';

export const EXAMPLES_DIR = join(REPO_ROOT, 'examples');

export interface ExampleStep {
    readonly tool: string;
    readonly arguments: Readonly<Record<string, unknown>>;
}

export interface Example {
    /** File name without `.json`. */
    readonly name: string;
    readonly steps: readonly ExampleStep[];
}

interface ExampleFile {
    readonly tool?: string;
    readonly arguments?: Record<string, unknown>;
    readonly steps?: readonly ExampleStep[];
}

export function loadExamples(dir: string = EXAMPLES_DIR): Example[] {
    return readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => {
            const parsed = JSON.parse(readFileSync(join(dir, f), 'utf8')) as ExampleFile;
            const steps = Array.isArray(parsed.steps) ? [...parsed.steps] : typeof parsed.tool === 'string' ? [{ tool: parsed.tool, arguments: parsed.arguments ?? {} }] : [];
            return { name: f.replace(/\.json$/, ''), steps };
        });
}

/** Every `<…>` token that is a whole string value somewhere in `value`. */
export function placeholdersOf(value: unknown, into: Set<string> = new Set()): Set<string> {
    if (typeof value === 'string') {
        const m = /^<(.+)>$/.exec(value);
        if (m?.[1] !== undefined) into.add(m[1]);
    } else if (Array.isArray(value)) {
        for (const v of value) placeholdersOf(v, into);
    } else if (value !== null && typeof value === 'object') {
        for (const v of Object.values(value)) placeholdersOf(v, into);
    }
    return into;
}

const STEP_REF = /^base64 from step (\d+)$/;
const FIRST_STEP = 'base64-of-the-generated-pdf';
const PLAIN_PDF = new Set(['any PDF base64', 'any unencrypted PDF base64']);
const CMYK_ICC = 'synthetic CMYK prtr ICC, base64';

/** True for a placeholder the generator can resolve with no test fixture. */
export function isHermeticPlaceholder(token: string): boolean {
    return STEP_REF.test(token) || token === FIRST_STEP || PLAIN_PDF.has(token) || token === CMYK_ICC;
}

/** The placeholders that keep an example out of the hermetic run (empty = it runs). */
export function blockingPlaceholders(example: Example): string[] {
    const tokens = new Set<string>();
    for (const step of example.steps) placeholdersOf(step.arguments, tokens);
    return [...tokens].filter((t) => !isHermeticPlaceholder(t)).sort();
}

export interface StepOutput {
    /** 1-based step number. */
    readonly step: number;
    readonly tool: string;
    /** Base64 PDFs returned by the step (split_pdf returns several). */
    readonly pdfs: readonly string[];
    /** `structuredContent` of a step that returned no PDF (the read tools). */
    readonly structured: Readonly<Record<string, unknown>> | null;
}

export interface RunnerDeps {
    /** Call a tool with pinned instants; throws on `isError`. */
    readonly call: (tool: string, args: Readonly<Record<string, unknown>>) => Promise<{ readonly pdfs: readonly string[]; readonly structured: Readonly<Record<string, unknown>> | null }>;
}

/** The plain document `<any PDF base64>` stands for. */
export const PLAIN_DOCUMENT = { title: 'Sample input', blocks: [{ type: 'heading', text: 'Sample input', level: 1 }, { type: 'paragraph', text: 'A plain generated document used as the input of an example.' }] } as const;

function substitute(value: unknown, resolve: (token: string) => string): unknown {
    if (typeof value === 'string') {
        const m = /^<(.+)>$/.exec(value);
        return m?.[1] === undefined ? value : resolve(m[1]);
    }
    if (Array.isArray(value)) return value.map((v) => substitute(v, resolve));
    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) out[k] = substitute(v, resolve);
        return out;
    }
    return value;
}

/** Run every step of a hermetic example in order, chaining outputs. */
export async function runExample(example: Example, deps: RunnerDeps): Promise<StepOutput[]> {
    const outputs: StepOutput[] = [];
    let plain: string | null = null;
    let cmyk: string | null = null;
    for (const [i, step] of example.steps.entries()) {
        const needed = [...placeholdersOf(step.arguments)];
        if (needed.some((t) => PLAIN_PDF.has(t)) && plain === null) {
            plain = (await deps.call('generate_basic_pdf', PLAIN_DOCUMENT)).pdfs[0] ?? null;
        }
        const args = substitute(step.arguments, (token) => {
            const ref = STEP_REF.exec(token);
            const index = ref?.[1] !== undefined ? Number(ref[1]) - 1 : token === FIRST_STEP ? 0 : -1;
            if (index >= 0) {
                const pdf = outputs[index]?.pdfs[0];
                if (pdf === undefined) throw new Error(`${example.name}: step ${index + 1} produced no PDF to chain into step ${i + 1}`);
                return pdf;
            }
            if (PLAIN_PDF.has(token)) {
                if (plain === null) throw new Error(`${example.name}: could not generate the plain input document`);
                return plain;
            }
            if (token === CMYK_ICC) {
                cmyk ??= iccBase64(buildSyntheticCmykProfile());
                return cmyk;
            }
            throw new Error(`${example.name}: <${token}> is not a hermetic placeholder`);
        }) as Record<string, unknown>;
        const result = await deps.call(step.tool, args);
        outputs.push({ step: i + 1, tool: step.tool, pdfs: result.pdfs, structured: result.structured });
    }
    return outputs;
}
