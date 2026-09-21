# Local testing guide (for contributors)

This guide shows how to verify, on your own machine, that pdfnative-mcp builds,
passes its quality gate, and — most importantly — that the **PDFs it produces are
actually correct** (not just non-empty bytes). It complements the
[Contributing guide](../../CONTRIBUTING.md) and the
[testing instructions](../../.github/instructions/testing.instructions.md).

Applies to pdfnative-mcp v1.7.0 · pdfnative 1.8.0.

## 1. Prerequisites

- **Node.js ≥ 22** (`node -v`). The package sets `"engines": { "node": ">=22" }`.
- A clean install and a first build:

  ```bash
  git clone https://github.com/Nizoka/pdfnative-mcp.git
  cd pdfnative-mcp
  npm ci --ignore-scripts      # what CI runs; .npmrc sets ignore-scripts=true anyway
  npm run build                # nothing builds on install — the gate, the samples and the corpus drive dist/
  ```

There are **no** native build steps and no system PDF tools required for the core
suite — `pdfnative` is a zero-dependency pure-TypeScript engine. Optional:
[veraPDF](https://verapdf.org/) 1.30.2 + Java for the PDF/A step (section 5).

## 2. The quality gate

`npm run gate` is **the** quality gate — the single definition of green, the same
command CI runs (`scripts/gate.ts`). It prints one line per step and a summary of at
most 20 lines; each step's log lands in `test-output/.gate/<step>.log`.

```bash
npm run gate:fast     # while you work, and before every commit
npm run gate          # the CI profile — run it before opening a PR
```

| Profile | Command | Steps |
| --- | --- | --- |
| Fast | `npm run gate:fast` | `typecheck:all`, `lint`, `test`, `server-json`, `verify:docs` |
| CI (default) | `npm run gate` | `typecheck:all`, `lint`, `build`, `dist-check`, `dist-probe`, `smoke`, `verify:tool-shape`, `server-json`, `test:generate`, `test:coverage`, `verify:docs`, `verify:samples`, `corpus:pdfa`, `validate:pdfx` |
| Publish (release branches) | `npx tsx scripts/gate.ts --publish --require-all` | everything above + `validate:pdfa` (veraPDF); `--require-all` turns a skipped step into a failure |

What the main steps check:

| Step | What it checks |
| --- | --- |
| `typecheck:all` | Strict TypeScript over `src/`, `tests/` and `scripts/` — no `any`, schemas compile. |
| `lint` | `eslint src --max-warnings 0` — a warning fails. |
| `test` / `test:coverage` | The full vitest suite (unit + integration + examples-as-tests); with v8 coverage it must stay above the thresholds in [vitest.config.ts](../../vitest.config.ts). |
| `build`, `dist-check`, `dist-probe` | `dist/` is emitted by `tsc -p tsconfig.build.json`, is complete, holds only `src/` output and no `console.log`. |
| `smoke` | The **built** server over stdio: handshake, tool count, version — and stdout carrying JSON-RPC frames only. |
| `verify:tool-shape` | The built `tools/list` against the committed structural fixture (section 3.2b). |
| `server-json` | `server.json` against the vendored MCP registry schema, offline. |
| `test:generate`, `verify:samples` | The sample set, regenerated and held to the byte baseline (section 3.4). |
| `verify:docs` | Every count, version, tool, error code, operator variable, link and anchor the docs quote, against `docs/assets/ecosystem.json` and the source tree. |
| `corpus:pdfa`, `validate:pdfx`, `validate:pdfa` | The conformance corpus and its validators (section 5). |

Useful flags — pass them by calling the script directly:

```bash
npx tsx scripts/gate.ts --fast            # same as npm run gate:fast
npx tsx scripts/gate.ts --only smoke      # one step
npx tsx scripts/gate.ts --json            # machine-readable result
```

When a step fails, open **that step's** log under `test-output/.gate/` — not the whole
run. Use `npm run test:watch` for a fast inner loop while developing, and
`npx vitest run tests/<name>.test.ts` for one suite. The opt-in git hooks
(`npm run hooks:install`) run lint on commit and the fast gate before a push. The
full script table, with flags and exit codes, is in
[scripts/README.md](../../scripts/README.md).

### Windows notes

- **PowerShell swallows a bare `--` after `npm run`**, so `npm run gate -- --fast` does
  not do what it says: call the script directly — `npx tsx scripts/<name>.ts <flags>`
  (`npx tsx scripts/gate.ts --fast`, `npx tsx scripts/verify-samples.ts --strict`).
- The Bash one-liners of this guide run under Git Bash.
- Every file the project writes uses LF line endings (`.gitattributes`).
- veraPDF on Windows needs `JAVACMD` as well as `VERAPDF_HOME` (section 5).
- vitest occasionally reports "no tests" right after a file is written: run it again.

## 3. Verifying generated PDFs are correct

A PDF that merely starts with `%PDF-` can still be structurally broken. Tests in
this repo assert **real validity** through three complementary layers.

### 3.1 Structural assertion helper (in tests)

[tests/_pdf-assert.ts](../../tests/_pdf-assert.ts) exports `assertValidPdf()`, which
checks the `%PDF-` header, the `%%EOF` trailer, that pdfnative's hardened
`openPdf()` reader parses the document, and that it reports at least one page.
Use it in any new test that produces a PDF:

```ts
import { assertValidPdf } from './_pdf-assert.js';

const result = await generateBasicPdf({ title: 'X', blocks: [{ type: 'paragraph', text: 'hi' }] });
assertValidPdf(result.base64!); // throws if the bytes aren't a parseable, ≥1-page PDF
```

### 3.2 Examples-as-tests

Every file under [examples/](../../examples) is exercised by
[tests/examples.test.ts](../../tests/examples.test.ts):

- the referenced tool name(s) must exist in the live registry, and
- each self-contained, single-tool example (no `<placeholder>` tokens) is executed
  end-to-end; if it produces a PDF, `assertValidPdf` validates the bytes;
- multi-step and `<placeholder>` examples (the PAdES ladder, fill-form chains, …)
  are chained in order with each step's output substituted into the next, so they
  run for real too — with an explicit guard that no example is left unexecuted.

This guarantees the published examples never drift from the real schemas. A stale
field name or a renamed tool fails CI immediately. Run just this suite with:

```bash
npm run examples:check        # = npx vitest run tests/examples.test.ts
```

### 3.2b Catalogue parity (tool-shape gate)

The `tools/list` catalogue is fingerprinted structurally — names, annotations,
schema types, enums, defaults, constraints, `required`, `additionalProperties`
and the number of `_meta.examples`, with every `description` string stripped — by
[scripts/tool-shape.ts](../../scripts/tool-shape.ts), and
[tests/catalogue-parity.test.ts](../../tests/catalogue-parity.test.ts) asserts
the live server matches the committed fixture
`tests/_fixtures/tool-shape.json`; the gate step `verify:tool-shape`
(`npm run verify:tool-shape`) does the same against the **built** `tools/list`. Wording
(descriptions, examples, server instructions) can change freely; a structural change
fails the suite until you refresh the fixture on purpose:

```bash
npm run build && npx tsx scripts/tool-shape.ts --write
```

Review that diff under [docs/API_STABILITY.md](../API_STABILITY.md) §5 — it may
require a `TOOL_API_VERSION` bump. Never refresh the fixture to silence an accidental
change. A second suite, `tests/catalogue-superset.test.ts`, compares the live catalogue
with the frozen `tests/_fixtures/tool-shape.v1.5.0.json` (never regenerated): nothing
published may be removed or narrowed.

### 3.3 Inspecting a PDF you generated by hand

The read-only tools double as a verification toolkit. After generating a document,
feed its bytes back in:

- **`inspect_pdf`** — version, page count, encryption, PDF/A and PDF/X claims, signatures, attachments.
- **`validate_pdf`** — PDF/UA (ISO 14289-1) structural conformance for tagged / PDF/A output, or, with `standard: 'pdf-x-4'`, the structural prerequisites of PDF/X-4 (not a certified preflight — read `caveats[]`).
- **`verify_pdf`** — recompute the ByteRange digest and verify every PAdES signature.
- **`extract_text`** / **`extract_attachments`** — confirm content / embedded files round-trip.

A quick Node REPL check:

```ts
import { generateBasicPdf } from './dist/tools/generate-basic-pdf.js';
import { inspectPdf } from './dist/tools/inspect-pdf.js';
import { validatePdf } from './dist/tools/validate-pdf.js';

const pdf = await generateBasicPdf({ title: 'Demo', pdfA: 'pdfa2b', blocks: [{ type: 'paragraph', text: 'hello' }] });
console.log(await inspectPdf({ pdfBase64: pdf.base64 }));   // → pdfA: '2B', pageCount: 1, …
console.log(await validatePdf({ pdfBase64: pdf.base64 }));  // → { standard: 'pdf-ua-1', valid: true, … }
```

### 3.4 The sample set and its byte baseline

Structural assertions prove a PDF parses; the **byte baseline** proves it did not
change by accident. The whole loop is:

```bash
npm run build && npm run test:generate && npm run verify:samples
```

- `npm run test:generate` drives the **built** server (never `src/`) and writes 96
  samples into the git-ignored `test-output/samples/`: every hermetic `examples/*.json`
  sequence (those needing no PKI, TSA or revocation fixture) plus the conformance
  corpus. It runs under `TZ=UTC`, with every operator variable scrubbed and every
  instant pinned, so the set is reproducible on any machine.
- `npm run verify:samples` fingerprints the set and compares it with the committed
  `tests/_fixtures/samples.sha256.json`: 94 samples byte for byte, and 2 that cannot
  repeat their bytes (one encrypted, one signed with a per-run key) through a semantic
  projection — each listed explicitly, with its reason, in
  `scripts/lib/sample-fingerprint.ts`. Exit 0 match, 1 a changed or removed sample,
  2 usage or missing samples. `npx tsx scripts/verify-samples.ts --strict` also fails on a
  new, unbaselined sample.
- The baseline is a **chain**: each entry records the release whose output it is
  (`since`), and an unchanged entry keeps it.
- An **intended** output change (an engine bump, a rendering fix) is rebaselined with
  `npx tsx scripts/verify-samples.ts --update`, explained in the manifest's `provenance`
  note and declared in the release note. `--update` is never used to silence a
  surprise: an unexplained byte change is a regression until proven otherwise.

Why the bytes can repeat at all — UTC dates, the pinned instant, what is deliberately
not covered — is the subject of [REPRODUCIBLE.md](REPRODUCIBLE.md).

## 4. Opening a PDF in a real viewer

To eyeball the output, write it to disk with the sandboxed file mode and open it:

```bash
# 1. Enable file output by pointing the sandbox at a directory you own.
export PDFNATIVE_MCP_OUTPUT_DIR="$PWD/.out"        # PowerShell: $env:PDFNATIVE_MCP_OUTPUT_DIR = "$PWD/.out"
mkdir -p .out
```

Then call any PDF-producing tool with `outputMode: 'file'` and a relative
`outputPath` ending in `.pdf` (absolute paths, `..` traversal, and non-`.pdf`
names are rejected by the sandbox). Open the resulting file with your OS viewer:

```bash
# macOS: open .out/demo.pdf   ·   Windows: start .out\demo.pdf   ·   Linux: xdg-open .out/demo.pdf
```

## 5. External PDF/A conformance (optional, recommended for archival work)

The built-in `validate_pdf` is a fast **structural** gate (PDF/UA, or PDF/X-4
prerequisites) — it is *not* a substitute for a full reference validator. For
authoritative PDF/A verification the project ships a corpus + runner around the
open-source [veraPDF](https://verapdf.org/) validator (a Java CLI, intentionally
**not** a project dependency), and a second runner for the PDF/X-4 entries:

```bash
npm run build            # the corpus is written by the BUILT server
npm run corpus:pdfa      # → test-output/pdfa/*.pdf + manifest.json (a SHA-256 per file)
npm run validate:pdfx    # PDF/X-4 entries: pdfnative's structural validator, in-process — never skips
npm run validate:pdfa    # PDF/A entries: veraPDF, one run per file, profile from the XMP claim
```

### veraPDF setup

Install **veraPDF 1.30.2** (the version CI pins; Java 8+ required), then tell the
runner where it is:

| Variable | Meaning |
| --- | --- |
| `VERAPDF_HOME` | The veraPDF install directory (`verapdf` / `verapdf.bat` at its root or under `bin/`). Not needed when `verapdf` is on `PATH`. |
| `JAVACMD` | The JDK's `java` executable, **when Java is not on `PATH`**. On Windows the `.bat` launcher reads `JAVACMD` — `JAVA_HOME` alone is not enough when it is spawned from Node. |
| `VERAPDF_REPORT_DIR` | Relocates the raw per-file veraPDF XML reports (default `test-output/pdfa/reports/`). |

```bash
export VERAPDF_HOME=/opt/verapdf                       # macOS / Linux
```

```powershell
$env:VERAPDF_HOME = "$env:USERPROFILE\verapdf"         # Windows (a portable install works)
$env:JAVACMD = "C:\Program Files\Java\jdk-13.0.1\bin\java.exe"
```

The three-OS install steps are in
[CONTRIBUTING.md](../../CONTRIBUTING.md#pdfa-validation-verapdf).

### The corpus

The corpus is a **representative sample**, not an exhaustive feature matrix: 41
files — 33 claiming PDF/A (one or two per document tool and per conformance level,
of which 6 are negative canaries), 6 claiming PDF/X-4 (2 negative canaries) and 2
page-tree outputs that carry no claim.
It covers plain text, outlines / page labels / lists, watermarks, charts, print
boxes and marks, RGB / CMYK / Gray output intents, typography, tables, international
text (including the scripts added in 1.7.0), barcodes,
images, attachments, PAdES signing, metadata updates, forms, a composite
`generate_basic_pdf` document with `toc`, `table`, `link`, `barcode`, `svg` and
`chart` blocks, and the layout options (Letter, margins, header / footer templates,
`compress`); it does not exercise every chart kind, every script, an inline `image`
or `formField` block under PDF/A, an image watermark or `inspect_layout` (which
produces no PDF). Every entry in
`test-output/pdfa/manifest.json` carries an `expectCompliant` flag and the
validators compare the verdict against it:

| File | Tool / feature | Claim | Expectation |
| --- | --- | --- | --- |
| `basic-pdfa1b.pdf` | `generate_basic_pdf`, plain text | 1b | compliant |
| `basic-pdfa2b-outline-labels-list.pdf` | outline, page labels, nested list | 2b | compliant |
| `basic-pdfa2u-text.pdf` | headings + paragraphs | 2u | compliant |
| `basic-pdfa2b-watermark.pdf` | text watermark | 2b | compliant |
| `basic-pdfa1b-watermark.pdf` | text watermark (no transparency) | 1b | compliant |
| `basic-pdfa2b-chart-bar.pdf` / `…-stackedbar.pdf` | chart blocks | 2b | compliant |
| `basic-pdfa2b-print-metadata.pdf` | bleed, printer marks, `/Trapped` | 2b | compliant |
| `basic-pdfa2b-custom-outputintent.pdf` | caller-supplied RGB ICC `outputIntent` | 2b | compliant |
| `composite-blocks-pdfa2b.pdf` | `toc`, `table`, `link`, `barcode`, `svg` (shapes + `<text>`), `chart` blocks in one document | 2b | compliant |
| `layout-letter-templates-compress-pdfa2b.pdf` | `pageSize: 'Letter'`, custom `margins`, `headerTemplate` / `footerTemplate`, `compress` (XMP stays plain) | 2b | compliant |
| `table-pdfa2b.pdf` | `add_table` | 2b | compliant |
| `chart-pdfa2b-scatter.pdf` | `add_chart` scatter | 2b | compliant |
| `international-pdfa2u.pdf` | `add_international_text` Arabic + Latin | 2u | compliant |
| `international-pdfa2u-emoji-math.pdf` | Latin + colour emoji + math | 2u | compliant |
| `barcode-pdfa2b-qr.pdf` | `add_barcode` QR | 2b | compliant |
| `image-pdfa2b-jpeg.pdf` | `embed_image` JPEG | 2b | compliant |
| `attachment-pdfa3b-xml.pdf` / `attachment-pdfa3b-pdf.pdf` | `add_attachment` XML / PDF payload | 3b | compliant |
| `signed-pdfa2b-pades.pdf` | `sign_pdf` PAdES-B over the placeholder below (throwaway self-signed RSA cert) | 2b | compliant |
| `metadata-updated-pdfa2u.pdf` | `update_metadata` on a claiming file | 2u | compliant |
| `placeholder-pdfa2b-unsigned.pdf` | `prepare_signature_placeholder`, unsigned | 2b | **must fail** (6.4.3 — empty `/Contents`) |
| `basic-pdfa2b-no-embedfonts.pdf` | `generate_basic_pdf` without `embedFonts` | 2b | **must fail** (6.2.11.4.1) |
| `form-pdfa2b.pdf` | `add_form` + `embedFonts` | 2b | compliant (a known failure until pdfnative 1.8.0 embedded the AcroForm `/DR` font) |
| `form-pdfa2b-no-embedfonts.pdf` | `add_form` without `embedFonts` | 2b | **must fail** (6.2.11.4.1) |
| `cmyk-intent-pdfa2b.pdf` / `gray-intent-pdfa2b.pdf` | CMYK / Gray ICC `outputIntent`, matching content | 2b | compliant |
| `typography-pdfa2u.pdf` | `typography`: split paragraphs, justification, optical margins, kerning, features, no-break spaces | 2u | compliant |
| `international-pdfa2u-lao-cham.pdf` | `add_international_text` Lao, New Tai Lue, Tai Le, Cham | 2u | compliant |
| `international-pdfa2b-taitham.pdf` | `add_international_text` Tai Tham | 2b | compliant |
| `international-pdfa2u-taitham.pdf` | `add_international_text` Tai Tham | 2u | **known failure** (6.2.11.7.2: one glyph has no `ToUnicode` entry — upstream limit; use `pdfa2b`) |
| `cmyk-content-srgb-pdfa2b.pdf` | CMYK colour against the default sRGB intent | 2b | **must fail** (6.2.4.3) |
| `iccv4-pdfa1b.pdf` | ICC v4 `outputIntent` under PDF/A-1 | 1b | **must fail** (6.2.2) |
| `pdfx4-cmyk.pdf` / `pdfx4-gray.pdf` / `pdfx4-cmyk-bleed-colourbars.pdf` / `pdfx4-table.pdf` | `pdfx: 'pdfx4'` — CMYK and Gray intents, bleed + marks + colour bars, `add_table` | PDF/X-4 | compliant (`validate:pdfx`; never sent to veraPDF) |
| `pdfx4-link-annotation.pdf` / `pdfx4-no-embedfonts.pdf` | a `link` block / no `embedFonts` under PDF/X-4 | PDF/X-4 | **must fail** (`validate:pdfx`) |
| `merge-pdfa2b.pdf` / `extract-pages-pdfa2b.pdf` | page-tree tools | none | skipped (no claim, asserted) |

The `expectCompliant: false` rows — six under PDF/A, two under PDF/X-4 — are
**negative canaries**: if a validator ever accepts one, it exits 1 with `XPASS`
("the validator accepts everything") — a green run therefore proves the validator is
actually validating. Two of the PDF/A canaries document **known limits** rather than
deliberate misuse: `placeholder-pdfa2b-unsigned.pdf` (an unsigned placeholder's empty
`/Contents` violates ISO 19005-2 6.4.3 until `sign_pdf` fills it) and
`international-pdfa2u-taitham.pdf` (a Tai Tham glyph without a `ToUnicode` entry, an
upstream engine limit). The day the engine closes a gap the run goes `XPASS` and the
expectation in `scripts/lib/pdfa-corpus.ts` has to be flipped on purpose — which is
what happened to `form-pdfa2b.pdf` when pdfnative 1.8.0 fixed the AcroForm font.

With veraPDF 1.30.2 the expected result is **27 PASS, 6 XFAIL**, 0 unexpected.
Per file the validators print `PASS`, `FAIL` (with failing rule ids), `XFAIL`
(expected failure), `XPASS` (unexpected pass — fatal), `INFRA` (veraPDF produced
no usable report) or `SKIP` (no PDF/A claim), and `validate:pdfa` writes the raw
veraPDF XML report for every file to `test-output/pdfa/reports/`. Exit codes, the same
for both validators: **0** all expectations met,
**1** conformance mismatch / coverage canary (a manifest file is missing, its
XMP claim changed, or the number of claiming files differs from the manifest of
counts) / no negative canary in the corpus, **2** infrastructure — no corpus (run
`npm run corpus:pdfa` first), veraPDF installed but unusable (broken Java), or a file
without a usable report.

When veraPDF is simply **not installed**, `npm run validate:pdfa` prints install hints
and exits 0 — explicitly labelled **SKIPPED, not a pass** — so local work never
blocks, and the gate reports the step as skipped. To fail closed, run the publish
profile: `npx tsx scripts/gate.ts --publish --require-all` turns any skipped step into
a failure (it replaces the former `VERAPDF_REQUIRED=1` variable, which no longer
exists). Only `test-output/pdfa/` is scanned.

To check a single file you wrote in step 4 instead:

```bash
verapdf --flavour 2b .out/demo.pdf        # Windows: verapdf.bat --flavour 2b .out\demo.pdf
```

A `compliant="true"` result confirms PDF/A-2b conformance end-to-end (fonts,
colour, OutputIntent, XMP). Remember that text rendered through the base-14
Helvetica is *not* embedded — pass `embedFonts: true` on the generating
tool, or the claim will fail on ISO 19005 §6.2.11.4.1. Treat any veraPDF failure
on generated PDF/A as a bug. veraPDF does not cover PDF/X: a press job is confirmed
with a commercial preflight (callas pdfToolbox, Acrobat Preflight).

**CI status:** `.github/workflows/verapdf.yml` builds, writes the corpus and validates
it with a pinned veraPDF 1.30.2 (installer SHA-256 verified before it is executed) on
every push / PR touching the sources. It is **blocking** since 1.7.0 — the validate
step has no `continue-on-error` — and the publish workflow runs the whole
`--publish --require-all` profile again before the package is published.

## 6. Smoke-testing the MCP server over stdio

The server speaks JSON-RPC over stdio. **Always drive the built server before claiming
a change works** — source tests alone do not prove the emitted package. After
`npm run build`:

```bash
node dist/cli.js
```

On stdio, **stdout is the protocol**: one stray `console.log` in `src/` corrupts every
session, so logs go to stderr — the gate's `smoke` step
(`npx tsx scripts/gate.ts --only smoke`) performs the handshake against `dist/cli.js`
and fails on any stdout line that is not a JSON-RPC frame. The test harness
`tests/_stdio-session.ts` spawns the same binary; `tests/cli-stdio.test.ts` and
`tests/reproducible-build.test.ts` use it (they skip locally when `dist/` is absent and
fail under CI and the gate).

Operator variables are read once at boot, and an invalid value refuses to start — try
the creation-date pin (see [REPRODUCIBLE.md](REPRODUCIBLE.md)); the boot line on stderr
names its source:

```bash
PDFNATIVE_MCP_CREATION_DATE=2026-01-01T00:00:00Z node dist/cli.js
# PowerShell: $env:PDFNATIVE_MCP_CREATION_DATE = "2026-01-01T00:00:00Z"; node dist/cli.js
```

The cleanest way to drive it interactively is the official
[MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector node dist/cli.js
```

From the Inspector you can list the 28 tools, inspect each schema and the
`_meta.examples`, and issue `tools/call` requests — a fast way to confirm a new or
changed tool behaves before writing assertions.

To exercise the Streamable HTTP transport instead, set `PDFNATIVE_MCP_PORT` (the
server binds loopback only and checks `Host` / `Origin`). Without a token the
endpoint has **no authentication** — any local process can reach it — so also set
`PDFNATIVE_MCP_HTTP_TOKEN` (≥ 16 characters, no whitespace; a weaker value aborts
startup) and send `Authorization: Bearer <token>` on every request to `/mcp`;
a missing or wrong token gets `401` with `WWW-Authenticate: Bearer`. The startup
log tells you which mode you are in ("bearer token required" vs. "no
authentication (loopback only)"). `tests/http-modern.test.ts` and
`tests/_http-fixture.ts` show the request shapes.

## 7. Interpreting coverage

`npm run test:coverage` prints a per-file table and fails if any metric drops below
the thresholds in [vitest.config.ts](../../vitest.config.ts) — they live there once,
the gate enforces them, and they are never lowered to make a change pass. When you add
code, add tests in the same PR so coverage does not regress on the modules you touched.
