#!/usr/bin/env tsx
/**
 * pdfnative-mcp — conformance corpus generator (PDF/A + PDF/X, v1.7.0)
 * ======================================================================
 * Drives the BUILT MCP tool handlers (`dist/server.js`) — what `npm publish`
 * ships — to produce a small, deterministic corpus of conformance-claiming
 * documents under `test-output/pdfa/`. It is a representative sample, not an
 * exhaustive feature matrix. `scripts/validate-pdfa.ts` then runs the PDF/A
 * files through veraPDF and `scripts/validate-pdfx.ts` runs the PDF/X files
 * through pdfnative's validatePdfX().
 *
 * The table itself lives in scripts/lib/pdfa-corpus.ts.
 *
 * Usage:  npm run build && npm run corpus:pdfa
 *         npx tsx scripts/generate-pdfa-corpus.ts [--quiet | --verbose] [--json]
 * Exit:   0 when every file was written, 1 at the first tool call that returns
 *         an error (its message is reproduced), 2 when dist/ is missing or on
 *         bad usage.
 *
 * Reproducible: hermetic environment (helpers/hermetic.ts), every instant
 * pinned — the manifest records each file's sha256 so a byte change is visible.
 */

// Must be first: pins TZ and scrubs operator knobs before dist/ is loaded.
import './helpers/hermetic.js';

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseOutputMode } from './helpers/io.js';
import { loadBuiltServer, producePdf } from './helpers/server.js';
import { CORPUS, OUT_DIR, claimOf, type CorpusContext } from './lib/pdfa-corpus.js';
import type { CorpusFile, CorpusManifest } from './lib/verapdf.js';

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

    mkdirSync(OUT_DIR, { recursive: true });
    // Prune PDFs left over from an older corpus layout so the validator's
    // "unlisted file" note only ever points at something unexpected. Only
    // top-level *.pdf files are pruned — manifest.json and reports/ stay.
    const current = new Set(CORPUS.map((e) => e.file));
    for (const stale of readdirSync(OUT_DIR).filter((f) => f.endsWith('.pdf') && !current.has(f))) {
        rmSync(join(OUT_DIR, stale));
        say(`  pruned ${stale}`);
    }

    const produced = new Map<string, string>();
    const ctx: CorpusContext = {
        get: (file) => {
            const base64 = produced.get(file);
            if (base64 === undefined) throw new Error(`corpus order: ${file} is consumed before it is produced`);
            return base64;
        },
        produce: (tool, args) => producePdf(server, tool, args),
    };

    const files: CorpusFile[] = [];
    let totalBytes = 0;
    const started = Date.now();

    for (const entry of CORPUS) {
        let base64: string;
        try {
            base64 = await entry.produce(ctx);
        } catch (err) {
            process.stderr.write(`FAIL  ${entry.file}\n      ${err instanceof Error ? err.message : String(err)}\n`);
            return 1;
        }
        produced.set(entry.file, base64);
        const bytes = Buffer.from(base64, 'base64');
        if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-', 'ascii'))) {
            process.stderr.write(`FAIL  ${entry.file}\n      output does not start with %PDF-.\n`);
            return 1;
        }
        writeFileSync(join(OUT_DIR, entry.file), bytes);
        totalBytes += bytes.byteLength;
        const claims = claimOf(entry);
        const compliant = entry.expectCompliant !== false;
        files.push({
            file: entry.file,
            tool: entry.tool,
            bytes: bytes.byteLength,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            expectPdfAClaim: claims === 'pdfa',
            // A file that makes no claim is never validated, so it has no compliance expectation.
            expectCompliant: claims === 'pdfa' && compliant,
            expectPdfXClaim: claims === 'pdfx',
            expectPdfXCompliant: claims === 'pdfx' && compliant,
        });
        const tag = claims === 'none' ? 'no claim' : `${claims === 'pdfa' ? 'PDF/A' : 'PDF/X'}${compliant ? '' : ', NEGATIVE canary'}`;
        say(`  wrote  ${entry.file.padEnd(44)} ${String(bytes.byteLength).padStart(8)} B  (${entry.tool}, ${tag})`);
    }

    const manifest: CorpusManifest = { generatedBy: 'scripts/generate-pdfa-corpus.ts', files };
    writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    const pdfa = files.filter((f) => f.expectPdfAClaim);
    const pdfx = files.filter((f) => f.expectPdfXClaim);
    const seconds = (Date.now() - started) / 1000;
    if (json) {
        process.stdout.write(`${JSON.stringify({
            generated: files.length, bytes: totalBytes, seconds,
            pdfa: { claiming: pdfa.length, negatives: pdfa.filter((f) => !f.expectCompliant).length },
            pdfx: { claiming: pdfx.length, negatives: pdfx.filter((f) => !f.expectPdfXCompliant).length },
            outputDir: OUT_DIR, files,
        }, null, 2)}\n`);
    } else {
        process.stdout.write(
            `Conformance corpus: ${files.length} file(s), ${totalBytes} bytes, ${seconds.toFixed(1)} s — `
            + `${pdfa.length} PDF/A (${pdfa.filter((f) => !f.expectCompliant).length} negative), `
            + `${pdfx.length} PDF/X (${pdfx.filter((f) => !f.expectPdfXCompliant).length} negative) → test-output/pdfa/\n`,
        );
    }
    return 0;
}

process.exit(await main());
