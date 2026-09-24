/**
 * pdfnative-mcp — the server surface, derived from the source tree
 * ================================================================
 * `docs/assets/ecosystem.json` quotes counts the docs repeat in prose: how
 * many tools, prompts, error codes, operator variables, examples, samples,
 * corpus files. None of those figures is hand-maintained here: they are read
 * from the files the server is built from — the `<NAME>_NAME` constants under
 * `src/tools/`, the `TOOLS` and `PROMPTS` tables of `src/server.ts`, every
 * `ToolError('CODE'` literal under `src/`, the `environmentVariables` of
 * `server.json`, the conformance corpus table — and from directory walks for
 * the examples, the tests and the sample baseline.
 *
 * Scripts never import `src/` (scripts/helpers/server.ts), and `verify:docs`
 * runs in the gate's fast profile, before any build: every parser below is a
 * pure function over text, unit-tested in tests/tools/mcp-surface.test.ts.
 * `computeDerived()` is the one function that touches the filesystem, used
 * by `scripts/verify-docs.ts` (rules `derived-counts`, `tool-parity`,
 * `error-parity`, `env-var-parity`).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { CORPUS, claimOf } from './pdfa-corpus.js';

// ── Pure parsers ─────────────────────────────────────────────────────

/** `export const ADD_TABLE_NAME = 'add_table';` → `['ADD_TABLE_NAME', 'add_table']`, or null. */
export function toolNameConstant(toolModuleText: string): readonly [string, string] | null {
    const m = /^export const ([A-Z][A-Z0-9_]*_NAME)\s*=\s*'([a-z][a-z0-9_]*)'\s*;/m.exec(toolModuleText);
    return m ? [m[1], m[2]] : null;
}

/** The `name: <CONST>_NAME` entries of the `TOOLS` table, in registry order. */
export function registeredToolConstants(serverText: string): string[] {
    const start = serverText.search(/^(?:export )?const TOOLS\b/m);
    if (start === -1) return [];
    const out: string[] = [];
    for (const m of serverText.slice(start).matchAll(/^\s{4,8}name:\s*([A-Z][A-Z0-9_]*_NAME)\s*,/gm)) out.push(m[1]);
    return [...new Set(out)];
}

/** The `name: '<prompt>'` entries of the `PROMPTS` table. */
export function promptNames(serverText: string): string[] {
    const start = serverText.search(/^(?:export )?const PROMPTS\b/m);
    if (start === -1) return [];
    const rest = serverText.slice(start);
    const end = rest.search(/^\];/m);
    const table = end === -1 ? rest : rest.slice(0, end);
    return [...table.matchAll(/^\s{8}name:\s*'([a-z][a-z0-9_]*)'\s*,/gm)].map((m) => m[1]);
}

/** Every `ToolError('CODE'` literal of one source text (a line break after the parenthesis is allowed). */
export function toolErrorCodes(sourceText: string): string[] {
    return [...sourceText.matchAll(/ToolError\(\s*'([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1]);
}

/** The fixed codes `src/errors.ts` subclasses pass through `super('CODE'`. */
export function subclassErrorCodes(errorsText: string): string[] {
    return [...errorsText.matchAll(/super\(\s*'([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1]);
}

/** The first-column codes of the `## 6. Error reference` table of the agent contract. */
export function contractErrorRows(contractText: string): string[] {
    const start = contractText.search(/^## 6\. /m);
    if (start === -1) return [];
    const rest = contractText.slice(start + 1);
    const end = rest.search(/^## /m);
    const section = end === -1 ? rest : rest.slice(0, end);
    const out: string[] = [];
    for (const line of section.split(/\r?\n/)) {
        const cell = /^\|\s*([^|]+?)\s*\|/.exec(line)?.[1];
        if (cell === undefined) continue;
        for (const m of cell.matchAll(/`([A-Z][A-Z0-9_]+)`/g)) out.push(m[1]);
    }
    return [...new Set(out)];
}

/** Every backticked lower_snake token with an underscore — the shape of a tool name — in a text. */
export function snakeTokens(text: string): string[] {
    return [...new Set([...text.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)].map((m) => m[1]))];
}

/** Every operator-variable token (`PDFNATIVE_MCP_*`, and the deprecated `PDFNATIVE_MPC_*` spelling) in a text. */
export function envVarTokens(text: string): string[] {
    return [...new Set([...text.matchAll(/\bPDFNATIVE_M(?:CP|PC)_[A-Z][A-Z0-9_]*[A-Z0-9]\b/g)].map((m) => m[0]))];
}

/** The `environmentVariables[].name` list of the first package of `server.json`. */
export function serverJsonEnvVars(serverJsonText: string): string[] {
    const parsed = JSON.parse(serverJsonText) as { packages?: Array<{ environmentVariables?: Array<{ name?: unknown }> }> };
    const out: string[] = [];
    for (const pkg of parsed.packages ?? []) {
        for (const v of pkg.environmentVariables ?? []) if (typeof v.name === 'string' && !out.includes(v.name)) out.push(v.name);
    }
    return out;
}

/** The numbered rows of the `## 1. Tool catalogue` table: backticked name in the second column. */
export function contractCatalogueTools(contractText: string): string[] {
    const start = contractText.search(/^## 1\. /m);
    if (start === -1) return [];
    const rest = contractText.slice(start + 1);
    const end = rest.search(/^## /m);
    const section = end === -1 ? rest : rest.slice(0, end);
    const out: string[] = [];
    for (const line of section.split(/\r?\n/)) {
        const m = /^\|\s*\d+\s*\|\s*`([a-z][a-z0-9_]*)`/.exec(line);
        if (m) out.push(m[1]);
    }
    return out;
}

/** `[1.7.0]: https://…/compare/v1.6.0...v1.7.0` → `{ version, from, to }` per link definition, in file order. */
export interface CompareLink {
    readonly label: string;
    readonly from: string | null;
    readonly to: string;
    readonly line: number;
}

export function changelogCompareLinks(changelogText: string): CompareLink[] {
    const out: CompareLink[] = [];
    changelogText.split(/\r?\n/).forEach((text, i) => {
        const compare = /^\[([^\]]+)\]:\s*\S+\/compare\/(\S+?)\.\.\.(\S+)\s*$/.exec(text);
        if (compare) {
            out.push({ label: compare[1], from: compare[2], to: compare[3], line: i + 1 });
            return;
        }
        const tag = /^\[([^\]]+)\]:\s*\S+\/releases\/tag\/(\S+)\s*$/.exec(text);
        if (tag) out.push({ label: tag[1], from: null, to: tag[2], line: i + 1 });
    });
    return out;
}

/** `## [1.7.0] - 2026-09-21` / `## [Unreleased]` headings, in file order. */
export function changelogHeadings(changelogText: string): Array<{ label: string; line: number }> {
    const out: Array<{ label: string; line: number }> = [];
    changelogText.split(/\r?\n/).forEach((text, i) => {
        const m = /^## \[([^\]]+)\]/.exec(text);
        if (m) out.push({ label: m[1], line: i + 1 });
    });
    return out;
}

export interface LadderFinding {
    readonly line: number;
    readonly message: string;
}

/**
 * The compare-link ladder: every heading has a link definition, every link
 * compares the previous heading's tag with its own, and `[Unreleased]`
 * starts at the newest released tag.
 */
export function checkChangelogLadder(changelogText: string): LadderFinding[] {
    const headings = changelogHeadings(changelogText);
    const links = new Map(changelogCompareLinks(changelogText).map((l) => [l.label, l] as const));
    const out: LadderFinding[] = [];
    const released = headings.filter((h) => h.label !== 'Unreleased');
    headings.forEach((h) => {
        const link = links.get(h.label);
        if (!link) {
            out.push({ line: h.line, message: `heading [${h.label}] has no link definition at the foot of the file` });
            return;
        }
        if (h.label === 'Unreleased') {
            const newest = released[0]?.label;
            if (newest !== undefined && (link.from !== `v${newest}` || link.to !== 'HEAD')) {
                out.push({ line: link.line, message: `[Unreleased] must compare v${newest}...HEAD — found ${link.from ?? '(tag link)'}...${link.to}` });
            }
            return;
        }
        const index = released.findIndex((r) => r.label === h.label);
        const previous = released[index + 1]?.label;
        if (link.to !== `v${h.label}`) out.push({ line: link.line, message: `[${h.label}] must end at v${h.label} — found ${link.to}` });
        if (previous !== undefined && link.from !== `v${previous}`) {
            out.push({ line: link.line, message: `[${h.label}] must compare v${previous}...v${h.label} — found ${link.from ?? '(tag link)'}...${link.to}` });
        }
    });
    for (const [label, link] of links) {
        if (!headings.some((h) => h.label === label)) out.push({ line: link.line, message: `link definition [${label}] has no heading` });
    }
    return out;
}

// ── Filesystem ───────────────────────────────────────────────────────

function walk(dir: string, filter: (p: string) => boolean, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir).sort()) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, filter, out);
        else if (filter(full)) out.push(full);
    }
    return out;
}

/** Tool names declared under `src/tools/`, keyed by their `<NAME>_NAME` constant. */
export function declaredTools(root: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const file of walk(join(root, 'src', 'tools'), (p) => p.endsWith('.ts'))) {
        const pair = toolNameConstant(readFileSync(file, 'utf8'));
        if (pair) out.set(pair[0], pair[1]);
    }
    return out;
}

/** The registered tool names, in `TOOLS` order (constants resolved through `src/tools/`). */
export function toolNames(root: string): string[] {
    const serverPath = join(root, 'src', 'server.ts');
    if (!existsSync(serverPath)) return [];
    const declared = declaredTools(root);
    return registeredToolConstants(readFileSync(serverPath, 'utf8'))
        .map((c) => declared.get(c))
        .filter((n): n is string => n !== undefined);
}

/** Every `ToolError` code emitted under `src/`, sorted. */
export function errorCodes(root: string): string[] {
    const codes = new Set<string>();
    for (const file of walk(join(root, 'src'), (p) => p.endsWith('.ts'))) {
        for (const c of toolErrorCodes(readFileSync(file, 'utf8'))) codes.add(c);
    }
    const errorsPath = join(root, 'src', 'errors.ts');
    if (existsSync(errorsPath)) for (const c of subclassErrorCodes(readFileSync(errorsPath, 'utf8'))) codes.add(c);
    return [...codes].sort();
}

function baselineEntryCount(root: string): number {
    const path = join(root, 'tests', '_fixtures', 'samples.sha256.json');
    if (!existsSync(path)) return 0;
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as { entries?: Record<string, unknown> };
        return Object.keys(parsed.entries ?? {}).length;
    } catch {
        return 0;
    }
}

export interface DerivedCounts {
    readonly tools: number;
    readonly prompts: number;
    readonly errorCodes: number;
    readonly envVars: number;
    readonly examples: number;
    readonly testFiles: number;
    readonly samples: number;
    readonly corpusFiles: number;
    readonly pdfaSamples: number;
    readonly pdfxSamples: number;
}

export function computeDerived(root: string): DerivedCounts {
    const serverPath = join(root, 'src', 'server.ts');
    const serverJsonPath = join(root, 'server.json');
    return {
        tools: toolNames(root).length,
        prompts: existsSync(serverPath) ? promptNames(readFileSync(serverPath, 'utf8')).length : 0,
        errorCodes: errorCodes(root).length,
        envVars: existsSync(serverJsonPath) ? serverJsonEnvVars(readFileSync(serverJsonPath, 'utf8')).length : 0,
        examples: walk(join(root, 'examples'), (p) => p.endsWith('.json')).length,
        testFiles: walk(join(root, 'tests'), (p) => p.endsWith('.test.ts')).length,
        samples: baselineEntryCount(root),
        corpusFiles: CORPUS.length,
        pdfaSamples: CORPUS.filter((e) => claimOf(e) === 'pdfa').length,
        pdfxSamples: CORPUS.filter((e) => claimOf(e) === 'pdfx').length,
    };
}
