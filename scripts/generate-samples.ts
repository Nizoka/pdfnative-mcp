#!/usr/bin/env tsx
/**
 * pdfnative-mcp — reproducible sample generator (v1.7.0)
 * ========================================================
 * Drives the BUILT server (`dist/server.js`, through the same `tools/call`
 * handler an MCP host reaches) and writes what it returns to
 * `test-output/samples/`, where `scripts/verify-samples.ts` fingerprints it
 * against the committed baseline (tests/_fixtures/samples.sha256.json).
 *
 * Two families:
 *   examples/<example>/<NN>-<tool>[.<k>].pdf|json
 *       every step of every hermetic example in examples/*.json — a PDF for
 *       a tool that returns one (split_pdf returns several), the canonical
 *       JSON of `structuredContent` for a read tool. Examples that need a
 *       certificate, a key, a TSA or revocation data are left to vitest
 *       (tests/examples.test.ts) and listed in the report.
 *   corpus/<file>.pdf
 *       the conformance corpus (scripts/lib/pdfa-corpus.ts), the same table
 *       `corpus:pdfa` writes for veraPDF and validatePdfX().
 *
 * Reproducibility is pinned twice, on purpose (scripts/helpers/io.ts): every
 * call gets `creationDate` / `signingTime` / `modDate` wherever the tool's
 * live input schema declares them, AND the engine's process-wide creation
 * instant is set — so a generator that forgets one still produces the
 * baseline bytes. The environment is hermetic (helpers/hermetic.ts): UTC, no
 * operator knob inherited from the shell, no network.
 *
 * The output directory is emptied first, so a stale sample can never be
 * fingerprinted as if this run had produced it.
 *
 * Usage:  npm run build && npm run test:generate
 *         npx tsx scripts/generate-samples.ts [--quiet | --verbose] [--json]
 * Exit:   0 every sample written · 1 a tool call failed (its message is
 *         reproduced) · 2 dist/ is missing or bad usage.
 */

// Must be first: pins TZ and scrubs operator knobs before dist/ is loaded.
import './helpers/hermetic.js';

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { setDefaultCreationDate } from 'pdfnative';

import { OUTPUT_DIR, SAMPLE_CREATION_DATE, formatBytes, parseOutputMode } from './helpers/io.js';
import { callPinned, loadBuiltServer, pdfBlobsOf, producePdf } from './helpers/server.js';
import { blockingPlaceholders, loadExamples, runExample } from './lib/example-runner.js';
import { CORPUS, type CorpusContext } from './lib/pdfa-corpus.js';
import { canonicalJson } from './lib/sample-fingerprint.js';

interface Written {
    readonly file: string;
    readonly size: number;
}

async function main(): Promise<number> {
    const mode = parseOutputMode(process.argv.slice(2));
    if ('error' in mode) {
        process.stderr.write(`${mode.error}\n`);
        return 2;
    }
    const { quiet, json } = mode;
    const say = (s: string): void => { if (!json && !quiet) process.stdout.write(`${s}\n`); };

    const server = await loadBuiltServer();
    if (server === null) {
        process.stderr.write('dist/server.js not found — run `npm run build` first.\n');
        return 2;
    }
    // The second pin: process-wide, on the very module instance dist/ imports.
    setDefaultCreationDate(SAMPLE_CREATION_DATE);

    rmSync(OUTPUT_DIR, { recursive: true, force: true });
    mkdirSync(OUTPUT_DIR, { recursive: true });

    const written: Written[] = [];
    const write = (rel: string, data: Buffer | string): void => {
        const target = join(OUTPUT_DIR, rel);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, data);
        written.push({ file: rel, size: typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength });
        say(`  wrote  ${rel}`);
    };
    const started = Date.now();

    // ── examples/ ────────────────────────────────────────────────────
    const skipped: { example: string; needs: string[] }[] = [];
    for (const example of loadExamples()) {
        const needs = blockingPlaceholders(example);
        if (needs.length > 0) {
            skipped.push({ example: example.name, needs });
            continue;
        }
        let outputs;
        try {
            outputs = await runExample(example, {
                call: async (tool, args) => {
                    const result = await callPinned(server, tool, args);
                    const pdfs = pdfBlobsOf(result);
                    return { pdfs, structured: pdfs.length === 0 ? (result.structuredContent ?? {}) : null };
                },
            });
        } catch (err) {
            process.stderr.write(`FAIL  examples/${example.name}\n      ${err instanceof Error ? err.message : String(err)}\n`);
            return 1;
        }
        for (const out of outputs) {
            const base = `examples/${example.name}/${String(out.step).padStart(2, '0')}-${out.tool}`;
            if (out.structured !== null) write(`${base}.json`, `${canonicalJson(out.structured)}\n`);
            else if (out.pdfs.length === 1) write(`${base}.pdf`, Buffer.from(out.pdfs[0] ?? '', 'base64'));
            else out.pdfs.forEach((pdf, k) => write(`${base}.${k + 1}.pdf`, Buffer.from(pdf, 'base64')));
        }
    }

    // ── corpus/ ──────────────────────────────────────────────────────
    const produced = new Map<string, string>();
    const ctx: CorpusContext = {
        get: (file) => {
            const base64 = produced.get(file);
            if (base64 === undefined) throw new Error(`corpus order: ${file} is consumed before it is produced`);
            return base64;
        },
        produce: (tool, args) => producePdf(server, tool, args),
    };
    for (const entry of CORPUS) {
        try {
            const base64 = await entry.produce(ctx);
            produced.set(entry.file, base64);
            write(`corpus/${entry.file}`, Buffer.from(base64, 'base64'));
        } catch (err) {
            process.stderr.write(`FAIL  corpus/${entry.file}\n      ${err instanceof Error ? err.message : String(err)}\n`);
            return 1;
        }
    }

    const bytes = written.reduce((sum, w) => sum + w.size, 0);
    const seconds = (Date.now() - started) / 1000;
    if (json) {
        process.stdout.write(`${JSON.stringify({ generated: written.length, bytes, seconds, outputDir: OUTPUT_DIR, skippedExamples: skipped, files: written }, null, 2)}\n`);
        return 0;
    }
    if (!quiet) for (const s of skipped) say(`  skip   examples/${s.example} (needs ${s.needs.join(', ')} — covered by tests/examples.test.ts)`);
    process.stdout.write(`${written.length} samples, ${formatBytes(bytes)}, ${seconds.toFixed(1)} s → test-output/samples/ (${skipped.length} example(s) need PKI or network fixtures and stay with vitest)\n`);
    return 0;
}

process.exit(await main());
