/**
 * Seed corpora for the ClusterFuzzLite targets (fuzz/*.js), built by the
 * server itself so no binary fixture is committed:
 *
 *   - tool-call   every example of examples/*.json as `{ tool, args }` (a
 *                 fuzzer that starts from an argument object that validates
 *                 is inside the grammar on the first mutation), plus the
 *                 diagnostic triggers and a few hostile shapes
 *   - base64      a real PDF in every form the boundary distinguishes (raw
 *                 base64, data: URI, PEM armour, doubled), DER-looking bytes
 *   - image       a JPEG, a PNG and a JPEG 2000 payload, prefixed by their
 *                 MIME index
 *   - output-path sandbox paths: nested, traversal, absolute, UNC, NUL
 *   - http-guards Host / Origin / Authorization triples, NUL-separated
 *
 * `npx tsx tests/fuzzing/_fuzz-seeds.ts <dir>` writes `<dir>/<target>/NNN.bin`
 * (what .clusterfuzzlite/build.sh zips); tests/fuzzing/targets.test.ts reads
 * the same seeds in memory and proves each target survives them.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateBasicPdf } from '../../src/tools/generate-basic-pdf.js';
import { ensureCompressionReady } from '../../src/server.js';
import { DIAGNOSTIC_TRIGGERS } from '../_diagnostic-triggers.js';
import { jp2Base64 } from '../_jpx.js';

export type FuzzTarget = 'base64' | 'http-guards' | 'image' | 'output-path' | 'tool-call';

/** Alphabetical: build.sh loops over this order when zipping the corpora. */
export const FUZZ_TARGETS: readonly FuzzTarget[] = ['base64', 'http-guards', 'image', 'output-path', 'tool-call'];

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

/** A 1×1 baseline JPEG and a 1×1 greyscale PNG, built in memory. */
function tinyJpeg(): Uint8Array {
    const marker = (code: number, body: number[]): number[] => [0xff, code, ((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff, ...body];
    return Uint8Array.from([
        0xff, 0xd8,
        ...marker(0xdb, [0x00, ...Array.from({ length: 64 }, () => 1)]),
        ...marker(0xc0, [0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00]),
        ...marker(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
        0x00, 0xff, 0xd9,
    ]);
}
function tinyPng(): Uint8Array {
    // Signature + IHDR (1×1, 8-bit grey) + an IDAT the engine never decodes here + IEND.
    const chunk = (type: string, body: number[]): number[] => [0, 0, 0, body.length, ...Array.from(type, (c) => c.charCodeAt(0)), ...body, 0, 0, 0, 0];
    return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]), ...chunk('IDAT', [0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]), ...chunk('IEND', [])]);
}

export async function fuzzSeeds(): Promise<Readonly<Record<FuzzTarget, readonly Uint8Array[]>>> {
    await ensureCompressionReady();
    const pdf = (await generateBasicPdf({ title: 'Seed', blocks: [{ type: 'paragraph', text: 'Fuzz seed' }], creationDate: '2026-01-15T09:00:00Z' })).base64!;

    const examples = readdirSync(join(ROOT, 'examples')).filter((f) => f.endsWith('.json')).sort();
    const toolCall: Uint8Array[] = [];
    for (const file of examples) {
        const example = JSON.parse(readFileSync(join(ROOT, 'examples', file), 'utf8')) as { tool?: string; arguments?: unknown; calls?: Array<{ tool: string; arguments: unknown }> };
        const calls = example.calls ?? (example.tool !== undefined ? [{ tool: example.tool, arguments: example.arguments }] : []);
        for (const call of calls) {
            // The examples name PDFs by placeholder; the fuzzer needs real bytes where a tool reads one.
            const args = JSON.parse(JSON.stringify(call.arguments ?? {}).replace(/"<base64>"|"<signed-base64>"|"<encrypted-base64>"/g, JSON.stringify(pdf))) as unknown;
            toolCall.push(text(JSON.stringify({ tool: call.tool, args })));
        }
    }
    for (const [, trigger] of Object.entries(DIAGNOSTIC_TRIGGERS)) toolCall.push(text(JSON.stringify({ tool: trigger.tool, args: trigger.args })));
    toolCall.push(text(JSON.stringify({ tool: 'generate_basic_pdf', args: { title: 'x', blocks: [{ type: 'paragraph', text: 'x', direction: 'rtl' }], print: { spotColours: [{ name: 'Varnish', alternate: [0, 0, 0, 10] }] } } })));
    toolCall.push(text(JSON.stringify({ tool: 'inspect_pdf', args: { pdfBase64: pdf } })));
    toolCall.push(text(JSON.stringify({ tool: 'no_such_tool', args: {} })));
    toolCall.push(text('{"tool":"extract_text","args":{"pdfBase64":"not base64 at all"}}'));

    const base64: Uint8Array[] = [
        text(pdf),
        text(`data:application/pdf;base64,${pdf}`),
        text(`-----BEGIN CERTIFICATE-----\n${pdf.slice(0, 120)}\n-----END CERTIFICATE-----`),
        text(Buffer.from(pdf).toString('base64')),
        text(''),
        text('AAAA'),
        text(Buffer.from([0x30, 0x82, 0x01, 0x0a, 0x02, 0x82, 0x01, 0x01]).toString('base64')),
    ];

    const image: Uint8Array[] = [
        Uint8Array.from([0, ...tinyJpeg()]),
        Uint8Array.from([1, ...tinyPng()]),
        Uint8Array.from([2, ...Buffer.from(jp2Base64(3), 'base64')]),
        Uint8Array.from([2, 0xff, 0x4f, 0xff, 0x51, 0, 0, 0, 0]),
    ];

    const outputPath: Uint8Array[] = ['report.pdf', 'sub/dir/report.pdf', '../escape.pdf', '/abs/report.pdf', 'C:\\abs\\report.pdf', '\\\\server\\share\\x.pdf', 'nul\0byte.pdf', 'draft.md', 'report.PDF', 'a/../../b.pdf'].map(text);

    const httpGuards: Uint8Array[] = [
        text('127.0.0.1:8765\0http://127.0.0.1:8765\0Bearer fuzz-token-0123456789abcdef'),
        text('localhost:8765\0http://localhost:8765\0Bearer wrong'),
        text('evil.example\0http://evil.example\0'),
        text('127.0.0.1:8765\0http://127.0.0.1:9999\0'),
        text('[::1]:8765\0\0Basic abc'),
        text('\0\0'),
    ];

    return { base64, 'http-guards': httpGuards, image, 'output-path': outputPath, 'tool-call': toolCall };
}

// CLI: write the seeds for the container.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const out = process.argv[2];
    if (out === undefined) {
        process.stderr.write('usage: npx tsx tests/fuzzing/_fuzz-seeds.ts <output-dir>\n');
        process.exit(2);
    }
    const seeds = await fuzzSeeds();
    for (const target of FUZZ_TARGETS) {
        mkdirSync(join(out, target), { recursive: true });
        seeds[target].forEach((seed, i) => writeFileSync(join(out, target, `${String(i).padStart(3, '0')}.bin`), seed));
    }
    process.stderr.write(`seeds written under ${out}\n`);
}
