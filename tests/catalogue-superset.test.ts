/**
 * Backward-compatibility gate against the last PUBLISHED catalogue
 * (tests/_fixtures/tool-shape.v1.5.0.json, captured from `main` = 1.5.0 with
 * every description string stripped). A minor release may only ADD: every
 * 1.5.0 tool, input property, enum value and bound must still be accepted, and
 * no previously unbounded field may gain a bound. The parity gate
 * (catalogue-parity.test.ts) catches drift against the current fixture; this
 * one catches a refresh that silently narrowed the public contract.
 *
 * Refresh this fixture only when a new MAJOR is published (docs/API_STABILITY.md §3).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { listToolsPayload } from '../src/server.js';

type Schema = Record<string, unknown>;

interface ToolShape {
    name: string;
    title?: string;
    annotations?: Record<string, unknown>;
    inputSchema: Schema;
    outputSchema?: Schema;
}

function strip(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(strip);
    if (node === null || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) if (!(k === 'description' && typeof v === 'string')) out[k] = strip(v);
    return out;
}

const baseline = JSON.parse(readFileSync(new URL('./_fixtures/tool-shape.v1.5.0.json', import.meta.url), 'utf8')) as ToolShape[];
const live = new Map(listToolsPayload().tools.map((t) => [t.name, { inputSchema: strip(t.inputSchema) as Schema, outputSchema: strip(t.outputSchema) as Schema | undefined, annotations: t.annotations as Record<string, unknown> | undefined }]));

/**
 * Deliberate, reviewed 1.6.0 deltas that are not pure additions. Each entry
 * must be justified in docs/API_STABILITY.md §5; anything else is a failure.
 */
const ACCEPTED_DELTAS = new Set<string>([
    // 'ar' matched two oneOf branches in 1.5.0 (a single code is also a comma-list); anyOf accepts the same values.
    'add_international_text.in.properties.lang: oneOf -> anyOf',
    // Watermark no longer requires `text` (image-only watermarks) — loosening.
    'generate_basic_pdf.in.properties.watermark: required removed', 'add_table.in.properties.watermark: required removed',
    // sign_pdf may contact the operator TSA (timestamp:true) — hint corrected.
    'sign_pdf.annotations.openWorldHint: false -> true',
]);

/** The six 1.5.0 read tools' output schemas are projectable: every `required` dropped, at every depth (loosening only). */
const PROJECTABLE_OUTPUT = /^(inspect_pdf|verify_pdf|extract_text|validate_pdf|extract_attachments|read_form_fields)\.out.*: required removed$/;
function accepted(issue: string): boolean {
    return ACCEPTED_DELTAS.has(issue) || PROJECTABLE_OUTPUT.test(issue);
}

const UPPER_BOUNDS = ['maxLength', 'maximum', 'maxItems', 'exclusiveMaximum'];
const LOWER_BOUNDS = ['minLength', 'minimum', 'minItems', 'exclusiveMinimum'];

/** Walk the old schema and assert the new one still accepts everything it accepted. */
function assertSuperset(oldS: Schema, newS: Schema | undefined, at: string, issues: string[]): void {
    if (newS === undefined) {
        issues.push(`${at}: removed`);
        return;
    }
    if (oldS['type'] !== undefined && JSON.stringify(oldS['type']) !== JSON.stringify(newS['type'])) {
        // Widening a primitive type to a union is allowed; anything else is not.
        const oldT = ([] as unknown[]).concat(oldS['type'] as unknown[]);
        const newT = ([] as unknown[]).concat(newS['type'] as unknown[]);
        if (!oldT.every((t) => newT.includes(t))) issues.push(`${at}: type ${JSON.stringify(oldS['type'])} -> ${JSON.stringify(newS['type'])}`);
    }
    if (Array.isArray(oldS['enum'])) {
        const newEnum = Array.isArray(newS['enum']) ? (newS['enum'] as unknown[]) : null;
        if (newEnum === null) issues.push(`${at}: enum removed`);
        else for (const v of oldS['enum'] as unknown[]) if (!newEnum.some((n) => JSON.stringify(n) === JSON.stringify(v))) issues.push(`${at}: enum value ${JSON.stringify(v)} removed`);
    }
    if (oldS['const'] !== undefined && JSON.stringify(oldS['const']) !== JSON.stringify(newS['const'])) issues.push(`${at}: const changed`);
    if (oldS['default'] !== undefined && JSON.stringify(oldS['default']) !== JSON.stringify(newS['default'])) issues.push(`${at}: default ${JSON.stringify(oldS['default'])} -> ${JSON.stringify(newS['default'])}`);
    for (const k of UPPER_BOUNDS) {
        const o = oldS[k] as number | undefined;
        const n = newS[k] as number | undefined;
        if (o === undefined && n !== undefined) issues.push(`${at}: ${k} introduced (${n})`);
        else if (o !== undefined && n !== undefined && n < o) issues.push(`${at}: ${k} tightened ${o} -> ${n}`);
    }
    for (const k of LOWER_BOUNDS) {
        const o = oldS[k] as number | undefined;
        const n = newS[k] as number | undefined;
        if (o === undefined && n !== undefined) issues.push(`${at}: ${k} introduced (${n})`);
        else if (o !== undefined && n !== undefined && n > o) issues.push(`${at}: ${k} tightened ${o} -> ${n}`);
    }
    if (oldS['pattern'] !== undefined && newS['pattern'] !== oldS['pattern']) issues.push(`${at}: pattern changed`);
    if (Array.isArray(newS['required'])) {
        const oldReq = Array.isArray(oldS['required']) ? (oldS['required'] as string[]) : [];
        for (const r of newS['required'] as string[]) if (!oldReq.includes(r)) issues.push(`${at}: '${r}' became required`);
    } else if (Array.isArray(oldS['required'])) {
        issues.push(`${at}: required removed`);
    }
    if (oldS['additionalProperties'] === false && newS['additionalProperties'] !== false) issues.push(`${at}: additionalProperties loosened`);
    const oldProps = (oldS['properties'] ?? {}) as Record<string, Schema>;
    const newProps = (newS['properties'] ?? {}) as Record<string, Schema>;
    for (const [k, v] of Object.entries(oldProps)) assertSuperset(v, newProps[k], `${at}.properties.${k}`, issues);
    if (oldS['items'] !== undefined && typeof oldS['items'] === 'object') assertSuperset(oldS['items'] as Schema, newS['items'] as Schema | undefined, `${at}.items`, issues);
    for (const comb of ['oneOf', 'anyOf'] as const) {
        if (!Array.isArray(oldS[comb])) continue;
        const newList = (newS[comb] ?? newS[comb === 'oneOf' ? 'anyOf' : 'oneOf']) as Schema[] | undefined;
        if (newS[comb] === undefined && newList !== undefined) issues.push(`${at}: ${comb} -> ${comb === 'oneOf' ? 'anyOf' : 'oneOf'}`);
        if (newList === undefined) {
            issues.push(`${at}: ${comb} removed`);
            continue;
        }
        (oldS[comb] as Schema[]).forEach((member, i) => {
            // Members are discriminated by `const` on `type` when present; otherwise by position.
            const disc = (member['properties'] as Record<string, Schema> | undefined)?.['type']?.['const'];
            const match = disc !== undefined ? newList.find((m) => (m['properties'] as Record<string, Schema> | undefined)?.['type']?.['const'] === disc) : newList[i];
            assertSuperset(member, match, `${at}.${comb}[${disc ?? i}]`, issues);
        });
    }
}

describe('tools/list is a superset of the published 1.5.0 catalogue', () => {
    for (const old of baseline) {
        it(`${old.name}: every 1.5.0 input is still accepted, nothing narrowed`, () => {
            const current = live.get(old.name);
            expect(current, `${old.name} still exists`).toBeDefined();
            const issues: string[] = [];
            assertSuperset(old.inputSchema, current!.inputSchema, `${old.name}.in`, issues);
            if (old.outputSchema !== undefined) assertSuperset(old.outputSchema, current!.outputSchema, `${old.name}.out`, issues);
            for (const [k, v] of Object.entries(old.annotations ?? {})) {
                if (current!.annotations?.[k] !== v) issues.push(`${old.name}.annotations.${k}: ${String(v)} -> ${String(current!.annotations?.[k])}`);
            }
            const unexpected = issues.filter((i) => !accepted(i));
            expect(unexpected).toEqual([]);
        });
    }

    it('no accepted delta is stale (each one still occurs)', () => {
        const seen = new Set<string>();
        for (const old of baseline) {
            const current = live.get(old.name)!;
            const issues: string[] = [];
            assertSuperset(old.inputSchema, current.inputSchema, `${old.name}.in`, issues);
            if (old.outputSchema !== undefined) assertSuperset(old.outputSchema, current.outputSchema, `${old.name}.out`, issues);
            for (const [k, v] of Object.entries(old.annotations ?? {})) if (current.annotations?.[k] !== v) issues.push(`${old.name}.annotations.${k}: ${String(v)} -> ${String(current.annotations?.[k])}`);
            issues.forEach((i) => seen.add(i));
        }
        expect([...ACCEPTED_DELTAS].filter((d) => !seen.has(d))).toEqual([]);
    });
});
