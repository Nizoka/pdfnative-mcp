# Roadmap

This document outlines the planned development direction for **pdfnative-mcp**, the
Model Context Protocol server bridging [pdfnative](https://github.com/Nizoka/pdfnative)
to AI clients (Claude Desktop, Cursor, Continue, ChatGPT, Zed, …).

Priorities may shift based on community feedback and sponsorship.

---

## Released

### v0.1.0 — Foundations

- [x] **MCP server** — stdio transport, `@modelcontextprotocol/sdk` 1.x, `pdfnative-mcp` server name.
- [x] **Tool `generate_basic_pdf`** — multi-page documents from headings, paragraphs, lists, page breaks, spacers.
- [x] **Tool `add_barcode`** — QR / Code 128 / EAN-13 / Data Matrix / PDF417 in single-page PDF.
- [x] **Tool `add_international_text`** — 16 non-Latin scripts via embedded Noto fonts (Arabic, Hebrew, Thai, CJK, Devanagari, Bengali, Tamil, Cyrillic, Greek, Georgian, Armenian, Vietnamese, Turkish, Polish).
- [x] **Tool `sign_pdf`** — PAdES CMS digital signatures (RSA-SHA256, ECDSA-SHA256 P-256), faithful wrapper around `pdfnative.signPdfBytes`.
- [x] **Sandboxed file output** — gated by `PDFNATIVE_MPC_OUTPUT_DIR`, strict path-traversal protection, `.pdf` extension enforcement, NUL-byte rejection.
- [x] **Strict input validation** — JSON Schema + Zod runtime checks at every tool boundary.
- [x] **Vitest test suite** — 90% line coverage, 80% branch coverage, sandbox security cases.

### v0.2.0 — Tabular, forms, images, signing workflow

- [x] **Tool `add_table`** — tabular PDF reports from column headers + data rows via `buildPDFBytes`.
- [x] **Tool `add_form`** — interactive AcroForm PDFs (text, textarea, checkbox, radio, dropdown).
- [x] **Tool `embed_image`** — JPEG / PNG embedding via base64 with magic-byte mime-type validation.
- [x] **Tool `prepare_signature_placeholder`** — creates a PDF with a `/Sig` AcroForm placeholder ready for `sign_pdf` (step 1 of a two-step signing workflow).
- [x] **HTTP transport** — `PDFNATIVE_MCP_PORT` enables Streamable HTTP mode at `http://127.0.0.1:<port>/mcp` (falls back to stdio when unset).

### v0.3.0 — pdfnative v1.1, PDF/A, inspect, MCP `outputSchema`

- [x] **Tool `inspect_pdf`** — read-only inspection (PDF version, page count, encryption state, PDF/A claim, signature count, info dict, optional per-page sizes, optional CI assertions).
- [x] **PDF/A on every document tool** — optional `pdfA` flag (`pdfa1b` / `pdfa2b` / `pdfa2u` / `pdfa3b`) routed to pdfnative's `tagged` layout option.
- [x] **Multi-script `add_international_text`** — `lang` accepts `string`, `string[]`, or comma-separated; new `latin` and `emoji` codes.
- [x] **`add_table` autoFit + clipCells** — transparently switches to the document-block backend when set.
- [x] **MCP `outputSchema`** advertised per tool (per the MCP 2025-06-18 spec).
- [x] **`initCrypto()` boot** — first signing/inspection no longer pays an init penalty.
- [x] **npm metadata** — expanded keyword set (39 at the time; 132 today), refreshed description, ⭐ star call-out.

### v1.0.0 — First stable release

- [x] **Tool `verify_pdf`** — PAdES signature verification end-to-end (CMS messageDigest + signatureValue, RSA-SHA256 + ECDSA P-256, optional chain trust).
- [x] **Tool `add_attachment`** — PDF/A-3 generator with embedded files (Factur-X / ZUGFeRD).
- [x] **Tool `extract_text`** — best-effort content-stream extraction; rejects encrypted PDFs.
- [x] **`add_table` smart fields** — `wrap`, `repeatHeader`, `zebra`, `caption`, `minRowHeight`, `cellPadding`.
- [x] **`sign_pdf` ergonomics** — `autoInjectPlaceholder` + `ecPrivateKeyDerBase64` (PKCS#8).
- [x] **`inspect_pdf` parity** — `hasSignaturePlaceholder`, `attachments[]`, new `check` values `placeholder` + `attachments`.
- [x] **Opt-in cache** — `PDFNATIVE_MCP_CACHE_DIR`; SHA-256 keyed; 1 h TTL; 256 MiB LRU.
- [x] **MCP `_meta.apiVersion`** + per-tool **`_meta.examples`**.
- [x] **Env-var typo fix** — `PDFNATIVE_MCP_OUTPUT_DIR` (old `_MPC_` kept as deprecated alias).
- [x] **PDF/A guide** — [`docs/guides/PDFA.md`](docs/guides/PDFA.md).
- [x] **Registry discovery** — `mcpName`, `server.json`, `llms.txt`, 70+ keywords, OpenSSF + CodeQL badges.

### v1.1.0 — pdfnative 1.3 alignment + AI-friendliness

- [x] **pdfnative v1.3.0** — dependency bump `^1.2.0` → `^1.3.0` (additive, no breaking changes). <!-- verify-docs:allow version-token -->
- [x] **Tool `validate_pdf`** — read-only PDF/UA (ISO 14289-1) structural conformance check wrapping pdfnative's `validatePdfUA()`. 13th tool.
- [x] **Six new scripts** — `add_international_text` reaches **24 scripts**: Telugu, Sinhala, Tibetan, Khmer, Myanmar, Ethiopic.
- [x] **COLRv1 colour emoji** — native colour emoji via the `emoji` lang code, with monochrome fallback.
- [x] **Newline sanitizer (Safe PDF/A)** — embedded `\n` in a paragraph auto-splits into separate paragraphs; eliminates `.notdef` tofu from LLM-style multi-line text.
- [x] **Automatic NFC normalisation** — `add_international_text` normalises input to NFC for maximal glyph coverage.
- [x] **Engine fixes surfaced** — Euro/CP-1252 symbols extract correctly ([pdfnative #48](https://github.com/Nizoka/pdfnative/issues/48)); wrapped table cells get unique per-line MCIDs (PDF/UA-safe).
- [x] **Survival directives** — refreshed `SERVER_INSTRUCTIONS`, `llms.txt`, and docs for AI agents.

### v1.2.0 — token-frugal responses, attachment round-trip, watermarks

- [x] **Tool `extract_attachments`** — read-only extraction of embedded files (byte-for-byte), completing the Factur-X / ZUGFeRD round-trip. **14th tool.**
- [x] **Watermarks** — optional `watermark` (text, opacity, angle, colour, position) on `generate_basic_pdf` and `add_table` (image watermarks followed in v1.6.0).
- [x] **Unicode `normalize`** — opt-in `NFC`/`NFD`/`NFKC`/`NFKD` on `generate_basic_pdf` and `add_international_text`.
- [x] **Token-frugal reads** — optional `verbosity: 'summary'` + `fields: […]` on every read-only tool (~90% smaller responses); no base64 duplication in `structuredContent`.
- [x] **MCP registry publish fix** — canonical `io.github.Nizoka/pdfnative-mcp` casing.
- [x] **Dependency** — upgraded to **zod 4**.
- [x] **AGENTS.md** — root agent operations manual (catalogue, decision tree, recipes, error table). Since 1.7.0 the consumer contract lives in `docs/AGENT_CONTRACT.md` and `AGENTS.md` holds the repository rules.

### v1.3.0 — page-tree tools, pdfnative 1.4 features, constant-time signing

- [x] **pdfnative v1.4.0** — dependency bump `^1.3.0` → `^1.4.0` (additive, no breaking changes). <!-- verify-docs:allow version-token -->
- [x] **Tool `merge_pdfs`** — concatenate 2–50 PDFs into one via pdfnative's page-tree API; rejects encrypted sources. **15th tool.**
- [x] **Tool `split_pdf`** — split one PDF into one document per page range (multi-output `{ count, totalSizeBytes, parts[] }`). **16th tool.**
- [x] **Tool `extract_pages`** — pull an arbitrary page subset into a single PDF. **17th tool.**
- [x] **Bookmarks & page labels** — `generate_basic_pdf` gains `outline` (`'auto'` or explicit tree), `pageLabels`, and nested multi-level `list` items.
- [x] **Viewer preferences** — optional `viewerPreferences` on `generate_basic_pdf`, `add_table`, and `add_international_text`.
- [x] **Table cell borders & alignment** — `add_table` gains `cellBorders` and `cellVAlign`.
- [x] **Constant-time signing** — `sign_pdf` signs RSA and EC-DER keys through a `node:crypto` provider with a transparent pure-JS fallback; signatures stay interoperable.

### v1.4.0 — AI governance + HITL, annotations, pdfnative 1.5

- [x] **pdfnative v1.5.0** — dependency bump `^1.4.0` → `^1.5.0` (additive, no breaking changes). <!-- verify-docs:allow version-token -->
- [x] **Tool `annotate_pdf`** — overlay markup annotations (highlight, note, underline, strikeout, squiggly, square, circle, line, freetext) on an existing PDF via incremental update. Visual review layer, **not** a redaction. **18th tool.**
- [x] **Tool `draft_governance_issue`** — draft a governance-compliant GitHub issue **locally** (draft `.md` + machine-readable compliance report) for human review; never submits, no outbound network; rejects contract breaches with `GOVERNANCE_VIOLATION`. **19th tool.**
- [x] **AI governance + human-in-the-loop** — the agent is a *draftsman, never an autonomous submitter*; contract files under `.github/` (`ai-governance.json`, `AGENT_RULES.md`), a `verify:issue` CLI gate, and the `docs/guides/AI_GOVERNANCE.md` guide.
- [x] **MCP prompts** — the server advertises the `prompts` capability with `governance_contract` and `draft_issue_workflow`.
- [x] **Page labels in `inspect_pdf`** — read-only surfacing of `/PageLabels` ranges.
- [x] **Math / scientific script** — `add_international_text` accepts the explicit `math` lang (Noto Sans Math), embedded on demand only (no global auto-routing).

### v1.5.0 — charts, forms, encryption round-trip, MCP resources, pdfnative 1.6

- [x] **pdfnative v1.6.0** — dependency bump `^1.5.0` → `^1.6.0` (additive, no breaking changes). <!-- verify-docs:allow version-token -->
- [x] **Tool `add_chart`** — native vector charts (bar / barH / line / pie / donut) via pdfnative 1.6's `ChartBlock`; also available as a `chart` block in `generate_basic_pdf`. **20th tool.**
- [x] **Tool `read_form_fields`** — read-only enumeration of an existing AcroForm's field tree. **21st tool.**
- [x] **Tool `fill_form`** — fill / flatten an existing AcroForm (counterpart to `add_form`). **22nd tool.**
- [x] **Tool `encrypt_pdf`** — re-secure a PDF with AES-128 / AES-256 (owner/user passwords, permissions, password rotation). **23rd tool.**
- [x] **Tool `decrypt_pdf`** — emit an unencrypted copy of an RC4 / AES-128 / AES-256 document. **24th tool.**
- [x] **Encrypted-PDF round-trip** — `password` on the read-only tools (`inspect_pdf`, `verify_pdf`, `extract_text`, `extract_attachments`) and `password` + `encrypt` on `merge_pdfs` / `split_pdf` / `extract_pages`, plus in-process encrypted fixtures. (Previously blocked; unblocked by pdfnative 1.6's Standard Security Handler reader/writer.)
- [x] **`extract_text` real Unicode** — rewritten onto pdfnative's `extractText()`: `/ToUnicode` decoding, optional positioned `runs[]`, `password`, `maxTextLength`.
- [x] **`inspect_pdf` `encryptionInfo`** — precise `{ algorithm, revision, authenticatedAs }` from `reader.encryption`.
- [x] **Native MCP resources** — generated PDFs (file mode) exposed as `pdfnative://output/…` resource URIs (`resources/list` + `resources/read`) with `resource_link` in results. (Previously long-term.)
- [x] **Tool annotations** — every tool advertises `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`.

### v1.6.0 — full engine coverage, PAdES LTV ladder, print production, charts v2, MCP 2026-07-28, pdfnative 1.7

- [x] **pdfnative v1.7.0** — dependency bump `^1.6.0` → `^1.7.0` (additive; engine byte changes documented in the release notes). <!-- verify-docs:allow version-token -->
- [x] **Full document model** — `generate_basic_pdf` accepts all 13 `DocumentBlock` kinds (`table`, `image`, `link`, `toc`, `barcode`, `svg`, `formField` join `heading` / `paragraph` / `list` / `chart` / `pageBreak` / `spacer`), each sharing its body with the dedicated tool; layout options `pageSize` / `margins` / `headerTemplate` / `footerTemplate` / `compress` / `debug` on the nine document tools; build-time `encrypt` (keeps the AcroForm) on seven of them; image watermarks (`watermark.image`) on `generate_basic_pdf` / `add_table`; `add_form` `listbox` + `placeholder`; `embed_image` `align` / `alt`. Deliberately unexposed engine options are listed in `docs/KNOWLEDGE_BASE.md`.
- [x] **Tool `inspect_layout`** — read-only pagination dry run over the same blocks and layout inputs (`totalPages`, per-block geometry, no PDF produced). **28th tool.** Engine gap: a `toc` block measures 0 pt.
- [x] **`inspect_pdf annotations: true`** — page-annotation inventory + `annotationCount`, `check: 'annotations'`.
- [x] **`PDFNATIVE_MCP_MAX_INFLATE_BYTES`** — operator-set engine decompression cap (invalid value refuses to start); `extract_text` degrades to empty text for a capped content stream (engine behaviour, documented).
- [x] **Compatibility gate** — `tests/catalogue-superset.test.ts` against the frozen 1.5.0 catalogue (`tests/_fixtures/tool-shape.v1.5.0.json`): no removal, no narrowing; `embed_image.imageBase64` stays unbounded.
- [x] **MCP SDK v2 / MCP 2026-07-28** — migrated from `@modelcontextprotocol/sdk` 1.x to `@modelcontextprotocol/server` ^2.0.0: stateless serving, `server/discover`, `resultType`, `ttlMs` / `cacheScope` cache hints, `_meta` serverInfo, `Mcp-Method` / `Mcp-Name` headers on HTTP, resource-not-found as `-32602`; automatic fallback to the 2025-era `initialize` handshake on stdio and HTTP so existing hosts keep working unchanged.
- [x] **Tool `add_ltv`** — PAdES B-LT: embed `/DSS` + `/VRI` with certificates and OCSP / CRL material, `mode: 'online'` (operator provider) or `mode: 'offline'` (caller-supplied DER, zero network). **25th tool.**
- [x] **Tool `timestamp_pdf`** — PAdES B-LTA: RFC 3161 `/DocTimeStamp` from the operator TSA; re-run to extend the archival chain. **26th tool.**
- [x] **Tool `update_metadata`** — incremental `/Info` + XMP rewrite (title / author / subject / keywords) on existing PDFs. **27th tool.**
- [x] **`sign_pdf` PAdES ladder** — `profile: 'pades'` (ETSI EN 319 142-1 baseline), `timestamp: true` (B-T), RSA-SHA384/512, `certChainDerBase64`, `fieldName` / `allowMultiple` for multiple signatures; `prepare_signature_placeholder` gains `subFilter` / `reserveTimestamp`; `verify_pdf ltv: true` reports profile, timestamp, revocation status and `ltvLevel`.
- [x] **Network charter** — no egress by default; only operator-configured TSA / OCSP / CRL endpoints (`PDFNATIVE_MCP_TSA_URL`, `PDFNATIVE_MCP_TSA_AUTH`, `PDFNATIVE_MCP_REVOCATION`, `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS`, `PDFNATIVE_MCP_NETWORK_TIMEOUT_MS`) behind an SSRF guard; URLs never come from tool arguments. Mirrored in `.github/ai-governance.json` / `AGENT_RULES.md`.
- [x] **Print production** — `print` (TrimBox / BleedBox / ArtBox / CropBox, `bleed` shorthand, crop + registration `marks`, `/UserUnit`), `metadata` (`/Author` / `/Subject` / `/Keywords` / `/Trapped`), `outputIntent` (custom RGB ICC) on every document tool; `viewerPreferences` print-dialog defaults; `inspect_pdf pages: true` reports the boxes; merge / split / extract preserve them.
- [x] **Charts v2** — `stackedBar` / `stackedBarH` / `area` / `scatter`, secondary axis (`axis2`), `axis.scale: 'log'`, `xAxis.type: 'linear' | 'time'`, `dataLabels`, `labelStride` (automatic) / `labelRotation`; engine cross-field rules surfaced as `CHART_ERROR`.
- [x] **Honest PDF/A** — `embedFonts` (Noto Sans Latin; base-14 Helvetica is not embedded) on the eight Latin document tools, `strict` (fail instead of warn), `includeDiagnostics` (`structuredContent.diagnostics`); new diagnostics `PDFA_UNEMBEDDED_FORM_FONT` / `PDFA_DEVICE_CMYK_IMAGE`; a 26-file veraPDF corpus (24 validated) with negative canaries (`npm run validate:pdfa`, `PASS` / `FAIL` / `XFAIL` / `XPASS` / `INFRA` / `SKIP`), `VERAPDF_REQUIRED=1` fail-closed mode, and a CI workflow with a SHA-256-pinned veraPDF 1.30.2 (advisory in 1.6.0).
- [x] **Reproducible bytes** — opt-in `creationDate` on all nine document tools (pins `/CreationDate`, XMP dates and the trailer `/ID`), `signingTime` on `prepare_signature_placeholder`, timezone offsets on `sign_pdf signingTime`, `modDate` on `update_metadata`; byte-identical on the same host time zone. `reproducible_output`, `print_ready`, `pades_ladder` and `pdfa_valid` MCP prompts.
- [x] **HTTP bearer token** — opt-in `PDFNATIVE_MCP_HTTP_TOKEN` (constant-time compare, 401 + RFC 6750 `WWW-Authenticate` otherwise); without it HTTP mode stays loopback-only with no authentication; the `Origin` port is pinned to the server port.
- [x] **Strict boundaries** — Zod `.strict()` on every schema (unknown keys → `VALIDATION_ERROR`), unknown tool → JSON-RPC `-32602` `[UNKNOWN_TOOL]`, base64 / PEM-vs-DER hints, image boundary checks (magic bytes, PNG IHDR, 24 MiB per-call budget), catalogue-parity gate (`scripts/tool-shape.mjs` + `tests/catalogue-parity.test.ts`); `tools/list` ≈ 245 kB (every block kind advertised inline, no `$ref`), instructions ≈ 6.7 kB; `eslint --max-warnings 0`; Windows CI job.
- [x] **`inspect_pdf` signature inventory** — `signatures: true`, `dss` / `docTimestampCount` / `trapped`, new `check` values `dss` / `docTimestamp` / `trapped`.
- [x] **Colour-emoji sequences** — flag and ZWJ sequences render as single glyphs (engine; no API change).
- [x] **Fix: signer metadata** — `signerName` / `reason` / `location` / `contactInfo` never reached the `/Sig` dictionary on pdfnative < 1.7; now baked at placeholder time.
- [x] **Fix: `verify_pdf` on B-LTA documents** — `/DocTimeStamp` entries are verified as RFC 3161 tokens and count in `allValid` like any signature (a sound timestamp passes; a tampered or TSA-untrusted one fails) instead of always failing as a mis-parsed CMS signature.
- [x] **Fix: `add_form` text areas** — `fieldType: 'textarea'` maps to the engine's `multilineText` (`/Ff 4096`); 1.5.0 passed the name through unmapped. Bytes change for that input only (API_STABILITY §5).

### v1.7.0 — fine typography, CMYK, PDF/X-4, 27 scripts, reproducible output, pdfnative 1.8

- [x] **pdfnative v1.8.0** — dependency bump `^1.7.0` → `^1.8.0` (additive; engine byte changes — TrueType subsets, print marks, mark positioning — declared in the release notes). Still exactly three runtime dependencies.
- [x] **Fine typography** — `typography` (12 keys, all off by default) on the nine document tools and on `inspect_layout`: `splitParagraphs` with `orphans` / `widows`, `keepHeadingsWithNext`, `unitBinding`, `bindShortWords`, `punctuationSpacing`, `opticalMargins`, `metrics: 'exact'`, `fontFeatures`, `kerning`, `hyphenationLanguage`; paragraph `align` / `keepWithNext` / `splittable`, heading `keepWithNext`. Stated limits: `kerning`, `fontFeatures` and the `'fr'` narrow no-break space need `embedFonts: true`; `tnum` / `lnum` change nothing on the bundled Noto Sans; no hyphenation dictionary is installed (soft hyphens are honoured).
- [x] **CMYK colours** — a shared colour module (`src/color.ts`): every colour input keeps its 1.6.0 form and gains a CMYK operand string (components 0–1) and a CMYK percent tuple (components 0–100).
- [x] **PDF/X-4** — `pdfx: 'pdfx4'` on six generation tools, CMYK and Gray `outputIntent` profiles beside RGB, `print.marks` colour bars, `validate_pdf standard: 'pdf-x-4'` (structural prerequisites with `caveats[]` — not a certified preflight; no press profile is bundled), `inspect_pdf` reports `pdfX` (check `'pdfx'`). Incoherent requests are refused as `VALIDATION_ERROR` before the build.
- [x] **27 Unicode scripts** — `add_international_text` accepts `lo`, `nod`, `khb`, `tdd`, `cjm`; `ha`, `yo`, `ig`, `sw` are aliases of `latin`; emoji skin-tone modifiers render.
- [x] **Reproducible output on every host** — every date is written in UTC; `{date}` follows the pinned instant; operator pins `PDFNATIVE_MCP_CREATION_DATE` and `SOURCE_DATE_EPOCH` (per-call `creationDate` wins; an invalid value refuses to start). Closes the 1.6.0 caveat "byte-identical on the same host time zone". Not covered, by design: `signingTime`, `modDate`, encryption, RFC 3161 tokens and revocation data, ECDSA signatures.
- [x] **Diagnostics by code** — the nine engine diagnostic codes enumerated, each with an executed trigger; `strict` escalates by code (`PDFA_*` → `PDF_A_COMPLIANCE_VIOLATION`, `PDFX_*` → `PDF_X_COMPLIANCE_VIOLATION`, anything else → `DIAGNOSTIC_ESCALATED`) — 47 error codes. A seventh MCP prompt, `typography`.
- [x] **veraPDF blocking in CI** — `continue-on-error` dropped from `.github/workflows/verapdf.yml`; the workflow stays path-filtered and therefore out of the required checks, and the publish gate re-runs it with `--require-all` (which replaces `VERAPDF_REQUIRED=1`). Corpus: 41 files (33 PDF/A, 6 PDF/X-4, 2 without a claim); veraPDF 1.30.2: 27 PASS, 6 expected failures; `npm run validate:pdfx` checks the PDF/X-4 entries in-process and never skips.
- [x] **`add_form` + PDF/A: the AcroForm `/DR` font is embedded** — fixed upstream (pdfnative #74): `add_form` / a `formField` block with `pdfA` and `embedFonts: true` validates under veraPDF; the `form-pdfa2b.pdf` canary was flipped (the variant without `embedFonts` remains a negative canary).
- [x] **`inspect_layout` `toc` height** — fixed upstream (pdfnative #75): the inspector and the build share one pagination planner, so a `toc` block reports its real height and the page count matches the built document.
- [x] **One gate** — `npm run gate` (`scripts/gate.ts`; profiles `--fast` / CI / `--publish --require-all`) with `dist-probe`, `smoke` (the built server over stdio, stdout purity), `server-json` and `verify:tool-shape` (fixture parity plus a 320 KiB catalogue / 8 KiB instructions budget) steps; a 96-sample byte baseline driven through the built server (`npm run test:generate`, `npm run verify:samples`); an engine-surface traceability matrix, a build-error registry and a seeded fuzz suite.
- [x] **Hardened CI and supply chain** — nine workflows; `harden-runner` on every job, `persist-credentials: false`, `npm ci --ignore-scripts`, one commit SHA per action; publication from a protected environment through npm Trusted Publishing with a CycloneDX SBOM and a build-provenance attestation; committed rulesets under `.github/rulesets/`.
- [x] **Docs as code and agent files** — `docs/assets/ecosystem.json` is the source of every count and version, held by `npm run verify:docs` (24 rules); `AGENTS.md` is the repository rule file and the consumer contract lives in `docs/AGENT_CONTRACT.md`; shared Claude Code settings, a fail-closed guard hook, generated rules, the `release-audit` skill; `scripts/release-prepare.ts`.
- [x] **Fix: 0–1 RGB triples** — `watermark.color` and the `annotate_pdf` colours rendered almost black (the engine reads a three-number tuple as 0–255); the shared colour module converts them. Bytes change only for inputs that rendered the wrong colour.
- [x] **Fix: no uncoded failure on a damaged PDF** — one net at the `tools/call` boundary classifies any unexpected failure of a tool that takes PDF input as `PDF_PARSE_FAILED`; `mapBuildError` classifies on the bare engine message; `strict` keeps the diagnostic code.

<!-- verify-docs:allow tool-parity -->
_v1.7.0 is the active release. `redact_pdf` stays **deferred** by design (overlay/flatten ≠ content removal)._

---

## Planned

### Blocked upstream

The page-tree tools, the annotation writer, the encrypted round-trip, charts,
form fill/flatten and (in v1.6.0) the full PAdES LTV ladder, print production
and metadata updates have all shipped on their respective pdfnative exports. The
remaining items stay **blocked/deferred**: pdfnative does not yet export a
content-*removal* API, and implementing one on raw primitives would contradict
this project's faithful, thin-wrapper philosophy.

- [ ] **Tool `redact_pdf`** — **deferred by design.** pdfnative can overlay annotations and flatten forms, but not *remove* page content; an overlay-only "redaction" would leave the original bytes intact and create false security, which fails this project's honesty bar. Blocked on an upstream true content-removal API (tracked as a `draft_governance_issue` feature request).
- [ ] **`verify_pdf` native ECDSA verify** — replace the local P-256 verifier once pdfnative exports `ecdsaVerifyHash` (still internal-only in 1.8.0; pinned by `tests/upstream-limits.test.ts`).
- [ ] **`extractText` under the inflate cap** — upstream should surface per-page decode failures instead of returning empty text, so `extract_text` can raise `PDF_PARSE_FAILED` like `extract_attachments` does. Still open in pdfnative 1.8.0; pinned by `tests/upstream-limits.test.ts`.
- [ ] **Offline `/VRI` composition upstream** — delegate `add_ltv mode: 'offline'` to a pdfnative helper once one exists (no change to inputs, outputs or error codes).
- [ ] **`extract_text`: logical-order text extraction on untagged output** — pdfnative's `extractText()` walks the content stream, so right-to-left runs (Arabic, Hebrew) and pre-base glyphs (Thai, Devanagari, Bengali, Sinhala, Tai Tham) come back in visual order and a few stacked clusters (Khmer, Myanmar) as U+FFFD; Yoruba / Igbo combining marks land after the next glyph. Rendering is unaffected. **Workaround today:** generate with `pdfA` — tagged output carries `/ActualText`, which `extractText()` 1.8.0 honours, and all eleven scripts then round-trip exactly. Pinned one by one with `it.fails` in `tests/scripts-27.test.ts`.
- [ ] **Tai Tham under PDF/A-2u** — one Tai Tham glyph shaped by the Universal Shaping Engine has no ToUnicode entry, so a `pdfa2u` claim fails veraPDF (ISO 19005-2 §6.2.11.7.2) while the engine raises no diagnostic. `pdfa2b` conforms. Tracked by the `international-pdfa2u-taitham.pdf` negative canary of the corpus (it turns XPASS, fatal, the day the engine maps the glyph).
- [ ] **`annotate_pdf` link annotations** — pdfnative's `MarkupAnnotation` union has no `link` member; writing the `/Link` + `/URI` dictionary by hand would contradict the thin-wrapper rule. Deferred until the engine offers one (the `link` block of `generate_basic_pdf` covers new documents).
- [ ] **Per-tool HTTP page-by-page streaming** — MCP 2026-07-28 still has no partial `structuredContent` envelope (results are `resultType: 'complete'` only), so large results stay single-shot; pdfnative already provides `streamMergedPdfs` / `streamSplitPdf` / `streamExtractPages`.

### Next

- [ ] **Custom fonts (`PDFNATIVE_MCP_FONT_DIR`)** — an operator-side font sandbox (read once at boot, declared in `server.json`, fonts validated before registration, never a path from a tool argument), designed with the same care as the output sandbox. Deferred from 1.7.0; the variable does not exist yet. <!-- verify-docs:allow env-var-parity -->
- [ ] **`link` annotation in `annotate_pdf`** — as soon as the engine's `MarkupAnnotation` union gains a `link` member (see *Blocked upstream*).
- [ ] **`windows` CI job as a required check** — it builds and tests on every pull request today but is not in `.github/rulesets/main.json`; add it once a release cycle has shown it stable.
- [ ] **`harden-runner` from audit to block mode** — switch the Linux jobs to `egress-policy: block` with an allow-list once the audited egress is known (Windows runners support audit mode only).
- [ ] **Automated MCP registry publication** — publishing `server.json` to the MCP registry is a manual maintainer step after the npm publication; move it into the publish workflow (the gate already validates `server.json` offline against the vendored schema).
- [ ] **Attest the published tarball** — `publish.yml` packs once, publishes that tarball and hands the same bytes to the `attest` job (today the attestation job rebuilds and re-packs its own copy); a `pack-manifest` gate step compares `npm pack --dry-run --json` with a committed file list, and a double pack proves the tarball is byte-reproducible. Deferred from 1.7.0 because a publish-workflow change can only be exercised by a real publication.
- [ ] **Least-privilege details in the workflows** — `codeql.yml` grants `security-events: write` per job instead of at the top level; the four `${{ }}` interpolations inside `run:` (`sample-regression.yml`, `verapdf.yml`) move to `env:` blocks, the form the veraPDF composite action already uses.
- [ ] **`governance-embed` rule in `verify:docs`** — hold the contract embedded in `src/governance.ts` to `.github/ai-governance.json` and `.github/AGENT_RULES.md` byte for byte (the rule pdfnative-cli carries).
- [ ] **Transport-layer fuzz** — the fixed cases are pinned since 1.7.0 (`tests/cli-stdio.test.ts`, `tests/http-modern.test.ts`, `tests/http-hardening.test.ts`): a non-JSON line on stdio is dropped without a reply (the SDK cannot address a reply to a frame it could not parse; HTTP answers `-32700`), an unknown method answers `-32601` on stdio and on the legacy HTTP era (the 2026-07-28 router reports it as `-32602`), a truncated frame then EOF exits 0 with a pure stdout, an oversize HTTP body answers 413. Still open: a seeded generator of random frame mutations (the shape of `tests/_fuzz.ts`) over both transports — the current fuzz suite stops at tool arguments.
- [ ] **Smaller parity items** — `examples/README.md` (an index of the 43 examples, read by `verify:docs`), a unit test for `scripts/lib/synthetic-icc.ts`, `THIRD-PARTY-NOTICES.md` in the verified document set, a DCO paragraph in CONTRIBUTING, ORCID / DOI in `CITATION.cff`, `verification.validator_covered_by` in `.github/ai-governance.json`.

### Long-Term

- [ ] **OCR ingestion** — accept scanned-image PDFs and produce searchable PDF/A via an external OCR engine (opt-in, sandboxed).
- [ ] **PDF/UA accessibility** — full PDF/UA-1 conformance (Tagged PDF + structure tree validation) with `inspect_pdf` reporting accessibility issues.
- [ ] **Telemetry hook (opt-in, off by default)** — anonymous usage counts via OpenTelemetry for adoption metrics; never includes PDF content.

---

## How to influence the roadmap

- **Feature requests:** [open an issue](https://github.com/Nizoka/pdfnative-mcp/issues/new?template=feature_request.md)
- **Pull requests:** community contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md)
- **Sponsorship:** sponsored features get prioritised — see [funding options](https://github.com/sponsors/Nizoka)
- **Discussion:** weigh in on the [open milestones](https://github.com/Nizoka/pdfnative-mcp/milestones)
