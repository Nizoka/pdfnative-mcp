/**
 * MCP 2026-07-28 normative conformance of the tool catalogue:
 *
 *   - server/tools, Output Schema: "Servers MUST provide structured results
 *     that conform to this schema" — every `structuredContent` this server
 *     can emit (full result, `verbosity:'summary'`, `fields` projections,
 *     presence-gated fields, file mode, diagnostics / summary extras) is
 *     validated against the advertised `outputSchema` with the SDK's own
 *     JSON Schema 2020-12 engine.
 *   - `_meta.examples[].input` ("a self-contained input") must validate
 *     against the tool's `inputSchema`, and placeholder-free examples must
 *     execute without VALIDATION_ERROR.
 *   - Every object schema keeps `additionalProperties: false` (SECURITY.md
 *     invariant), no `$ref` / network dereference.
 *   - server.json satisfies the registry limits that the publisher enforces.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';

import { callToolDirect, ensureCompressionReady, listToolsPayload } from '../src/server.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { addForm } from '../src/tools/add-form.js';
import { signedBB, fullLadder } from './_ltv-fixtures.js';

const validator = new AjvJsonSchemaValidator();
const tools = listToolsPayload().tools;
const byName = new Map(tools.map((t) => [t.name, t]));

function validateAgainst(schema: unknown, value: unknown): string | null {
    const v = validator.getValidator(schema as Parameters<typeof validator.getValidator>[0]);
    const r = v(value);
    return r.valid ? null : r.errorMessage;
}

async function callSc(name: string, args: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const r = await callToolDirect(name, args);
    expect(r.isError, `${name}: ${JSON.stringify(r.content?.[0]).slice(0, 300)}`).not.toBe(true);
    return r.structuredContent as Record<string, unknown> | undefined;
}

describe('MCP 2026-07-28 — structuredContent conforms to outputSchema (SDK 2020-12 validator)', () => {
    let plain: string;
    let form: string;
    let signed: string;
    let blta: string;

    beforeAll(async () => {
        await ensureCompressionReady();
        plain = (await generateBasicPdf({ title: 'Schema', blocks: [{ type: 'paragraph', text: 'conformance' }], pdfA: 'pdfa2b', embedFonts: true })).base64!;
        form = (await addForm({ title: 'F', fields: [{ fieldType: 'text', name: 'n', label: 'N' }] })).base64!;
        const base = Buffer.from((await generateBasicPdf({ title: 'S', blocks: [{ type: 'paragraph', text: 's' }] })).base64!, 'base64');
        signed = Buffer.from(signedBB(base)).toString('base64');
        blta = Buffer.from((await fullLadder(base)).blta).toString('base64');
    });

    const cases: Array<[string, () => Record<string, unknown>]> = [
        ['inspect_pdf', () => ({ pdfBase64: plain, pages: true })],
        ['inspect_pdf', () => ({ pdfBase64: plain, verbosity: 'summary' })],
        ['inspect_pdf', () => ({ pdfBase64: plain, check: ['pdfa'], fields: ['pageCount', 'checks'] })],
        ['inspect_pdf', () => ({ pdfBase64: blta, signatures: true, check: ['dss', 'docTimestamp'] })],
        ['verify_pdf', () => ({ pdfBase64: signed })],
        ['verify_pdf', () => ({ pdfBase64: blta, ltv: true })],
        ['verify_pdf', () => ({ pdfBase64: blta, ltv: true, verbosity: 'summary' })],
        ['verify_pdf', () => ({ pdfBase64: signed, fields: ['signatures.valid', 'allValid'] })],
        ['validate_pdf', () => ({ pdfBase64: plain })],
        ['validate_pdf', () => ({ pdfBase64: plain, verbosity: 'summary' })],
        ['extract_text', () => ({ pdfBase64: plain, includeRuns: true })],
        ['extract_text', () => ({ pdfBase64: plain, verbosity: 'summary' })],
        ['extract_attachments', () => ({ pdfBase64: plain })],
        ['extract_attachments', () => ({ pdfBase64: plain, verbosity: 'summary' })],
        ['read_form_fields', () => ({ pdfBase64: form })],
        ['read_form_fields', () => ({ pdfBase64: form, verbosity: 'summary', fields: ['fieldCount'] })],
        ['generate_basic_pdf', () => ({ title: 'D', blocks: [{ type: 'paragraph', text: 'x' }], pdfA: 'pdfa2b', includeDiagnostics: true })],
        ['add_chart', () => ({ chartType: 'bar', series: [{ label: 'a', values: [1, 2] }] })],
        ['split_pdf', () => ({ pdfBase64: plain, ranges: [{ start: 0 }] })],
        ['merge_pdfs', () => ({ pdfsBase64: [plain, plain] })],
        ['draft_governance_issue', () => ({ title: 'add_table clips descenders', summary: 'Wrapped cells clip descenders at the default cellPadding.', issueType: 'bug', targetRepo: 'pdfnative', reproduction: { command: 'add_table …', result: 'clipped' }, expectedBehavior: 'Descenders render.', duplicateSearchPerformed: true })],
    ];

    for (const [name, args] of cases) {
        it(`${name} ${JSON.stringify(Object.keys(args())).slice(0, 60)} validates`, async () => {
            const sc = await callSc(name, args());
            const schema = byName.get(name)?.outputSchema;
            expect(schema, `${name} advertises an outputSchema`).toBeDefined();
            expect(validateAgainst(schema, sc)).toBeNull();
        });
    }

    it('file-mode results validate too', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfnative-schema-'));
        process.env['PDFNATIVE_MCP_OUTPUT_DIR'] = dir;
        try {
            const sc = await callSc('generate_basic_pdf', { title: 'F', blocks: [{ type: 'paragraph', text: 'f' }], outputMode: 'file', outputPath: 'a/b.pdf' });
            expect(validateAgainst(byName.get('generate_basic_pdf')!.outputSchema, sc)).toBeNull();
            const multi = await callSc('split_pdf', { pdfBase64: plain, ranges: [{ start: 0 }], outputMode: 'file', outputPath: 'parts/out.pdf' });
            expect(validateAgainst(byName.get('split_pdf')!.outputSchema, multi)).toBeNull();
        } finally {
            delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
        }
    });
});

describe('tool catalogue hygiene', () => {
    it('every object schema keeps additionalProperties:false and no schema uses $ref', () => {
        const walk = (node: unknown, at: string, issues: string[]): void => {
            if (Array.isArray(node)) {
                node.forEach((n, i) => walk(n, `${at}[${i}]`, issues));
                return;
            }
            if (node === null || typeof node !== 'object') return;
            const o = node as Record<string, unknown>;
            if (o['type'] === 'object' && o['properties'] !== undefined && o['additionalProperties'] !== false) issues.push(`${at}: object without additionalProperties:false`);
            if ('$ref' in o) issues.push(`${at}: $ref`);
            for (const [k, v] of Object.entries(o)) walk(v, `${at}.${k}`, issues);
        };
        const issues: string[] = [];
        for (const t of tools) {
            walk(t.inputSchema, `${t.name}.inputSchema`, issues);
            if (t.outputSchema !== undefined) walk(t.outputSchema, `${t.name}.outputSchema`, issues);
        }
        expect(issues).toEqual([]);
    });

    it('every _meta.examples[].input validates against its inputSchema', () => {
        const failures: string[] = [];
        for (const t of tools) {
            const examples = ((t._meta as { examples?: Array<{ title: string; input: unknown }> })?.examples) ?? [];
            expect(examples.length, `${t.name} has examples`).toBeGreaterThan(0);
            for (const ex of examples) {
                const err = validateAgainst(t.inputSchema, ex.input);
                if (err !== null) failures.push(`${t.name} :: ${ex.title} :: ${err}`);
            }
        }
        expect(failures).toEqual([]);
    });

    it('placeholder-free _meta.examples execute without VALIDATION_ERROR', async () => {
        await ensureCompressionReady();
        const failures: string[] = [];
        for (const t of tools) {
            const examples = ((t._meta as { examples?: Array<{ title: string; input: Record<string, unknown> }> })?.examples) ?? [];
            for (const ex of examples) {
                if (JSON.stringify(ex.input).includes('<')) continue;
                const r = await callToolDirect(t.name, ex.input);
                const text = (r.content?.[0] as { text?: string } | undefined)?.text ?? '';
                if (r.isError === true && text.includes('VALIDATION_ERROR')) failures.push(`${t.name} :: ${ex.title} :: ${text.slice(0, 160)}`);
            }
        }
        expect(failures).toEqual([]);
    }, 120_000);

    it('server.json respects the registry limits the publisher enforces', () => {
        const manifest = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8')) as { description: string; name: string; version: string };
        expect(manifest.description.length).toBeLessThanOrEqual(100);
        expect(manifest.name).toMatch(/^io\.github\.[A-Za-z0-9-]+\/[a-z0-9-]+$/);
    });
});
