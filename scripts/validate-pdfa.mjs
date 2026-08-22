/**
 * pdfnative-mcp — veraPDF batch validation runner
 * ================================================
 * Validates every PDF in `test-output/pdfa/` (the corpus written by
 * scripts/generate-pdfa-corpus.mjs) against the official veraPDF reference
 * validator (https://verapdf.org), using the PDF/A profile each file claims in
 * its XMP metadata (`pdfaid:part` + `pdfaid:conformance` → 1b / 2b / 2u / 3b).
 *
 * Usage:
 *   npm run validate:pdfa                # build + corpus + validate
 *   node scripts/validate-pdfa.mjs       # validate an existing corpus only
 *
 * Requirements:
 *   - veraPDF CLI on PATH, or `VERAPDF_HOME` pointing at a veraPDF install
 *     (`verapdf` / `verapdf.bat` at the root or under `bin/`).
 *   - veraPDF is an external tool: pdfnative-mcp has zero runtime dependencies
 *     and never bundles a validator.
 *
 * Exit codes:
 *   0 — every corpus file is compliant; or veraPDF is not installed (install
 *       hints are printed and validation is skipped so local work never blocks).
 *   1 — a file listed in manifest.json is missing, or its XMP claim disagrees
 *       with the manifest (coverage canary: generated documents must claim
 *       PDF/A; page-tree outputs flagged `expectPdfAClaim: false` must not —
 *       a silent change in claim emission must fail loudly), or one or more
 *       claiming files fail validation.
 *   2 — the corpus directory / manifest is absent (run `npm run corpus:pdfa`).
 *
 * Windows: a `.bat` launcher cannot be spawned without a shell (Node rejects it
 * with EINVAL since the CVE-2024-27980 hardening); shell mode performs no
 * escaping, so every argument is quoted explicitly.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS_DIR = join(ROOT, 'test-output', 'pdfa');
const MANIFEST = join(CORPUS_DIR, 'manifest.json');

// ── Locate veraPDF CLI ──────────────────────────────────────────────

function locateVeraPdf() {
    const home = process.env.VERAPDF_HOME;
    if (home) {
        const candidates = [
            join(home, 'verapdf'),
            join(home, 'verapdf.bat'),
            join(home, 'bin', 'verapdf'),
            join(home, 'bin', 'verapdf.bat'),
        ];
        for (const c of candidates) {
            if (existsSync(c)) return c;
        }
    }
    const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['verapdf'], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout) {
        return probe.stdout.trim().split(/\r?\n/)[0];
    }
    return null;
}

// ── PDF/A claim detection (XMP) ─────────────────────────────────────

/** Returns `{ part, conformance, profile }` or null when the file does not claim PDF/A. */
function detectPdfAClaim(file) {
    const txt = readFileSync(file).toString('latin1');
    const part = txt.match(/<pdfaid:part>(\d)<\/pdfaid:part>/)?.[1];
    const conf = txt.match(/<pdfaid:conformance>([A-Z])<\/pdfaid:conformance>/)?.[1];
    if (!part || !conf) return null;
    return { part: Number.parseInt(part, 10), conformance: conf, profile: `${part}${conf.toLowerCase()}` };
}

// ── veraPDF invocation ──────────────────────────────────────────────

function validateFile(verapdf, file, profile) {
    // veraPDF prints XML to stdout; a non-zero exit code signals an infra
    // failure, not a validation failure — always parse the XML.
    const isBatch = /\.(bat|cmd)$/i.test(verapdf);
    const quote = (s) => (isBatch ? `"${s}"` : s);
    let xml;
    try {
        xml = execFileSync(quote(verapdf), ['--format', 'xml', '--flavour', profile, quote(file)], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: isBatch,
            maxBuffer: 64 * 1024 * 1024,
        });
    } catch (err) {
        xml = typeof err?.stdout === 'string' ? err.stdout : '';
    }
    const compliant = /isCompliant="true"/i.test(xml);
    const failedRules = Array.from(
        xml.matchAll(/<rule[^>]*specification="[^"]*"[^>]*clause="([^"]+)"[^>]*testNumber="([^"]+)"[^>]*status="failed"/gi),
    ).map((m) => `${m[1]} t${m[2]}`);
    return { compliant, failedRules };
}

// ── Main ─────────────────────────────────────────────────────────────

function printMissingVeraPdfHelp() {
    const lines = [
        'veraPDF CLI not found.',
        '',
        '  pdfnative-mcp does not bundle a validator (zero-dependency policy).',
        '  Install veraPDF locally to validate the PDF/A corpus, or use the',
        '  online demo at https://demo.verapdf.org for a one-off check.',
        '',
        '  Install hints:',
        '    macOS    : brew install --cask verapdf',
        '    Linux    : https://docs.verapdf.org/install/ → download zip → java -jar installer (headless recipe in CONTRIBUTING.md)',
        '    Windows  : https://docs.verapdf.org/install/ (GUI installer, ships verapdf.bat) or Chocolatey/Scoop',
        '',
        '  After install, expose it via PATH or set VERAPDF_HOME to the',
        '  install directory (the one containing `verapdf` or `verapdf.bat`).',
        '',
        '  See CONTRIBUTING.md → "PDF/A validation (veraPDF)".',
        '',
        '  Skipping validation (exit 0).',
    ];
    for (const l of lines) process.stderr.write(`${l}\n`);
}

function main() {
    if (!existsSync(CORPUS_DIR) || !existsSync(MANIFEST)) {
        process.stderr.write('No PDF/A corpus found in test-output/pdfa/. Run `npm run corpus:pdfa` first.\n');
        return 2;
    }

    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const entries = Array.isArray(manifest.files) ? manifest.files : [];
    const listed = entries.map((f) => f.file);

    // Coverage canary: every manifest entry must exist on disk, and its XMP
    // claim must match the manifest's expectation. Generated documents must
    // claim PDF/A; page-tree outputs (merge_pdfs / extract_pages, flagged
    // `expectPdfAClaim: false`) must NOT, because pdfnative rebuilds the page
    // tree without the source XMP. Either drifting means the corpus generator
    // or the engine changed behaviour — fail loudly, never shrink silently.
    const claimed = [];
    const skipped = [];
    let canaryFailures = 0;
    for (const entry of entries) {
        const name = entry.file;
        const file = join(CORPUS_DIR, name);
        if (!existsSync(file)) {
            process.stderr.write(`Coverage canary: ${name} is listed in manifest.json but missing on disk.\n`);
            canaryFailures++;
            continue;
        }
        const claim = detectPdfAClaim(file);
        const expectClaim = entry.expectPdfAClaim !== false;
        if (expectClaim && claim === null) {
            process.stderr.write(`Coverage canary: ${name} does not claim PDF/A in its XMP metadata.\n`);
            canaryFailures++;
            continue;
        }
        if (!expectClaim && claim !== null) {
            process.stderr.write(`Coverage canary: ${name} now claims PDF/A-${claim.profile} but the manifest expects no claim (page-tree output).\n`);
            canaryFailures++;
            continue;
        }
        if (claim === null) skipped.push(file);
        else claimed.push([file, claim]);
    }
    const unlisted = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.pdf') && !listed.includes(f));
    if (unlisted.length > 0) {
        process.stderr.write(`Note: ${unlisted.length} PDF(s) in test-output/pdfa/ are not in manifest.json and are ignored: ${unlisted.join(', ')}\n`);
    }
    if (listed.length === 0) {
        process.stderr.write('manifest.json lists no files. Run `npm run corpus:pdfa` first.\n');
        return 1;
    }
    if (canaryFailures > 0) {
        process.stderr.write(`\nCoverage canary failed for ${canaryFailures} of ${listed.length} file(s).\n`);
        return 1;
    }
    process.stderr.write(
        `Corpus: ${listed.length} file(s) in manifest.json — ${claimed.length} claim PDF/A, ${skipped.length} page-tree output(s) without a claim (as expected).\n`,
    );

    const verapdf = locateVeraPdf();
    if (!verapdf) {
        printMissingVeraPdfHelp();
        return 0;
    }
    process.stderr.write(`Using veraPDF: ${verapdf}\nValidating ${claimed.length} file(s)…\n`);

    let failed = 0;
    for (const [file, claim] of claimed) {
        const rel = relative(ROOT, file).split('\\').join('/');
        const result = validateFile(verapdf, file, claim.profile);
        if (result.compliant) {
            process.stdout.write(`  PASS  [${claim.profile}]  ${rel}\n`);
        } else {
            failed++;
            process.stdout.write(`  FAIL  [${claim.profile}]  ${rel}\n`);
            const unique = Array.from(new Set(result.failedRules));
            const shown = unique.slice(0, 8);
            for (const rule of shown) process.stdout.write(`        - ${rule}\n`);
            if (unique.length > shown.length) process.stdout.write(`        … (${unique.length - shown.length} more)\n`);
            if (unique.length === 0) process.stdout.write('        - (no rule details — veraPDF produced no parseable report)\n');
        }
    }

    for (const file of skipped) {
        process.stdout.write(`  SKIP  [none]  ${relative(ROOT, file).split('\\').join('/')}  (no PDF/A claim — page-tree output)\n`);
    }

    process.stdout.write(`\n${claimed.length - failed}/${claimed.length} compliant (${skipped.length} skipped).\n`);
    return failed === 0 ? 0 : 1;
}

process.exit(main());
