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
- [x] **npm metadata** — expanded keyword set (39 at the time; held to package.json by the `keyword-count` rule since 1.8.0), refreshed description, ⭐ star call-out.

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

- [x] **pdfnative v1.8.0** — dependency bump `^1.7.0` → `^1.8.0` (additive; engine byte changes — TrueType subsets, print marks, mark positioning — declared in the release notes). Still exactly three runtime dependencies. <!-- verify-docs:allow version-token -->
- [x] **Fine typography** — `typography` (12 keys, all off by default) on the nine document tools and on `inspect_layout`: `splitParagraphs` with `orphans` / `widows`, `keepHeadingsWithNext`, `unitBinding`, `bindShortWords`, `punctuationSpacing`, `opticalMargins`, `metrics: 'exact'`, `fontFeatures`, `kerning`, `hyphenationLanguage`; paragraph `align` / `keepWithNext` / `splittable`, heading `keepWithNext`. Stated limits: `kerning`, `fontFeatures` and the `'fr'` narrow no-break space need `embedFonts: true`; `tnum` / `lnum` change nothing on the bundled Noto Sans; no hyphenation dictionary is installed (soft hyphens are honoured).
- [x] **CMYK colours** — a shared colour module (`src/color.ts`): every colour input keeps its 1.6.0 form and gains a CMYK operand string (components 0–1) and a CMYK percent tuple (components 0–100).
- [x] **PDF/X-4** — `pdfx: 'pdfx4'` on six generation tools, CMYK and Gray `outputIntent` profiles beside RGB, `print.marks` colour bars, `validate_pdf standard: 'pdf-x-4'` (structural prerequisites with `caveats[]` — not a certified preflight; no press profile is bundled), `inspect_pdf` reports `pdfX` (check `'pdfx'`). Incoherent requests are refused as `VALIDATION_ERROR` before the build.
- [x] **27 Unicode scripts** — `add_international_text` accepts `lo`, `nod`, `khb`, `tdd`, `cjm`; `ha`, `yo`, `ig`, `sw` are aliases of `latin`; emoji skin-tone modifiers render. <!-- verify-docs:allow stale-token -->
- [x] **Reproducible output on every host** — every date is written in UTC; `{date}` follows the pinned instant; operator pins `PDFNATIVE_MCP_CREATION_DATE` and `SOURCE_DATE_EPOCH` (per-call `creationDate` wins; an invalid value refuses to start). Closes the 1.6.0 caveat "byte-identical on the same host time zone". Not covered, by design: `signingTime`, `modDate`, encryption, RFC 3161 tokens and revocation data, ECDSA signatures.
- [x] **Diagnostics by code** — the nine engine diagnostic codes enumerated, each with an executed trigger; `strict` escalates by code (`PDFA_*` → `PDF_A_COMPLIANCE_VIOLATION`, `PDFX_*` → `PDF_X_COMPLIANCE_VIOLATION`, anything else → `DIAGNOSTIC_ESCALATED`) — 47 error codes. A seventh MCP prompt, `typography`. <!-- verify-docs:allow stale-token -->
- [x] **veraPDF blocking in CI** — `continue-on-error` dropped from `.github/workflows/verapdf.yml`; the workflow stays path-filtered and therefore out of the required checks, and the publish gate re-runs it with `--require-all` (which replaces `VERAPDF_REQUIRED=1`). Corpus: 41 files (33 PDF/A, 6 PDF/X-4, 2 without a claim); veraPDF 1.30.2: 27 PASS, 6 expected failures; `npm run validate:pdfx` checks the PDF/X-4 entries in-process and never skips.
- [x] **`add_form` + PDF/A: the AcroForm `/DR` font is embedded** — fixed upstream (pdfnative #74): `add_form` / a `formField` block with `pdfA` and `embedFonts: true` validates under veraPDF; the `form-pdfa2b.pdf` canary was flipped (the variant without `embedFonts` remains a negative canary).
- [x] **`inspect_layout` `toc` height** — fixed upstream (pdfnative #75): the inspector and the build share one pagination planner, so a `toc` block reports its real height and the page count matches the built document.
- [x] **One gate** — `npm run gate` (`scripts/gate.ts`; profiles `--fast` / CI / `--publish --require-all`) with `dist-probe`, `smoke` (the built server over stdio, stdout purity), `server-json` and `verify:tool-shape` (fixture parity plus a 320 KiB catalogue / 8 KiB instructions budget) steps; a 96-sample byte baseline driven through the built server (`npm run test:generate`, `npm run verify:samples`); an engine-surface traceability matrix, a build-error registry and a seeded fuzz suite.
- [x] **Hardened CI and supply chain** — nine workflows; the gate on Linux (Node 22 / 24), Windows and macOS, all five required checks; `harden-runner` on every Linux and Windows job (the action does not support macOS), `persist-credentials: false`, `npm ci --ignore-scripts`, one commit SHA per action; publication from a protected environment through npm Trusted Publishing with a CycloneDX SBOM and a build-provenance attestation; committed rulesets under `.github/rulesets/`.
- [x] **Docs as code and agent files** — `docs/assets/ecosystem.json` is the source of every count and version, held by `npm run verify:docs` (24 rules); `AGENTS.md` is the repository rule file and the consumer contract lives in `docs/AGENT_CONTRACT.md`; shared Claude Code settings, a fail-closed guard hook, generated rules, the `release-audit` skill; `scripts/release-prepare.ts`.
- [x] **Fix: 0–1 RGB triples** — `watermark.color` and the `annotate_pdf` colours rendered almost black (the engine reads a three-number tuple as 0–255); the shared colour module converts them. Bytes change only for inputs that rendered the wrong colour.
- [x] **Fix: no uncoded failure on a damaged PDF** — one net at the `tools/call` boundary classifies any unexpected failure of a tool that takes PDF input as `PDF_PARSE_FAILED`; `mapBuildError` classifies on the bare engine message; `strict` keeps the diagnostic code.

### v1.8.0 — pdfnative 1.9 alignment, operator fonts, release pipeline, fuzzing

- [x] **pdfnative v1.9.0** — dependency bump `^1.8.0` → `^1.9.0` (additive; engine byte changes — lean / compact / tagged font subsets, `/ActualText` spans on untagged runs, one text object per line, danda routing — declared in the release notes, 52 of 96 baseline entries rebaselined). `@modelcontextprotocol/server` `^2.4.0`, `zod` `^4.6.0`. Still exactly three runtime dependencies.
- [x] **Spot colours** — `print.spotColours` declares inks with a CMYK or RGB alternate; `{ spot, tint }` (`/Separation`) and `{ inks }` (`/DeviceN`) accepted at all 46 colour sites. An undeclared ink is `VALIDATION_ERROR` naming it.
- [x] **Right-to-left documents** — `direction` (`auto` / `ltr` / `rtl`) on the nine document tools and `inspect_layout`, per-paragraph override, `actualText` opt-out; untagged right-to-left and reordered shaped runs carry `/ActualText`, so `extract_text` returns logical order without a PDF/A claim — the ten extraction limits pinned at 1.7.0 are lifted.
- [x] **PDF/X-4 + PDF/A-2 dual claim** — `pdfx: 'pdfx4'` with `pdfA: 'pdfa2b' | 'pdfa2u'`; `pdfa1b` / `pdfa3b` refused with the engine's messages; `validate_pdf standard: 'pdf-x-4'` reads inside XObjects, images and Separation / DeviceN alternates (caveats updated).
- [x] **JPEG 2000, links, chart colours** — `mimeType: 'image/jp2'` (JP2 or raw codestream) on `embed_image`, the `image` block and `watermark.image`; `annotate_pdf` type `link` (closes the 1.7.0 deferral); `series[].colors` per value and an optional series `label` on `add_chart`.
- [x] **32 Unicode scripts** — `add_international_text` accepts `gu`, `pa`, `kn`, `ml`, `or`; every shaper reports its glyphs to ToUnicode, so the five claim PDF/A-2u under `strict`.
- [x] **13 diagnostic codes** — `PDFA1_JPX_IMAGE`, `PDFA_JPX_IMAGE`, `PDFA_GLYPH_WITHOUT_UNICODE`, `TEXT_GLYPH_NOT_COVERED`, each with an executed trigger; `PDFA1_*` escalates like `PDFA_*`.
- [x] **`extract_text` under the inflate cap** — fixed upstream (`PdfStreamLimitError`): an over-cap stream is `PDF_PARSE_FAILED` naming `PDFNATIVE_MCP_MAX_INFLATE_BYTES`; `onStreamError: 'skip'` restores the empty page.
- [x] **`verify_pdf` native ECDSA verify** — fixed upstream (`ecdsaVerifyHash` exported): the local P-256 verifier is deleted.
- [x] **Offline `/VRI` composition upstream** — fixed upstream (`composeLtvData()`): `add_ltv mode: 'offline'` delegates, with `match: 'all' | 'chain'`.
- [x] **Custom fonts (`PDFNATIVE_MCP_FONT_DIR`)** — the operator font sandbox: `.ttf` / `.otf` files parsed by the engine at boot, named with the `font` input of `add_international_text`, `generate_basic_pdf` and `inspect_layout`; `FONT_NOT_FOUND` (48 error codes); an invalid directory or file refuses to start; no tool argument carries a path.
- [x] **File mode behind a reverse proxy** — `PDFNATIVE_MCP_OUTPUT_BASE_URL` (issue #66): every file-mode result carries `url` and the text names it instead of the host path; validated at boot, never requested by the server.
- [x] **llama.cpp grammar compatibility** — `prepare_signature_placeholder.blocks` takes 5000 items (issue #65); `tests/client-compat.test.ts` holds every array bound to 1000 or 5000.
- [x] **Governance as resources** — `pdfnative://governance/policy` and `pdfnative://governance/rules`, byte-identical to the repository files (`npm run agents:governance`; `verify:docs` rule `governance-embed`); `validator_covered_by` in the policy.
- [x] **The release pipeline** — `publish.yml` is guard → build → publish → attest → registry: tag-only guard before any approval, one pack with recorded digests, a publish job that installs nothing (npm client pinned by SHA-512) and mints the only token, the registry's bytes attested with three SBOMs and the Sigstore bundle attached to the release, `server.json` published to the MCP registry with the workflow's OIDC identity. Closes "Attest the published tarball" (`pack-manifest` gate step included) and "Automated MCP registry publication".
- [x] **Hardened workflows** — `ci.yml` without `paths-ignore`, `workflow-lint` (zizmor + checksummed actionlint) as the sixth required check, `harden-runner` in block mode on every Linux job whose hosts are known (dated reasons elsewhere), `codeql.yml` on `actions` + TypeScript with `security-extended` and job-scoped `security-events`, event values through `env:`, Dependabot 7-day cooldown, `setup-verapdf` `home` output, Node 26 advisory (`node-current.yml`). Closes "harden-runner from audit to block mode" and "Least-privilege details".
- [x] **Fuzzing** — ClusterFuzzLite (`fuzz.yml`) over five boundary targets (`fuzz/`: tools/call arguments, base64, images, the output sandbox, the HTTP guards), seeded from the examples and proved locally at every gate (`tests/fuzzing/`); the Jazzer.js engine lives in `.clusterfuzzlite/engine`, never in `package.json`. Closes "Transport-layer fuzz": the boundary is fuzzed where it is ours — whole `tools/call` argument payloads, the base64 and image decoders, the output sandbox and the HTTP guards; the JSON-RPC framing itself belongs to the SDK and is not a target.
- [x] **Smaller parity items** — `examples/README.md` (51 examples), a unit test for `scripts/lib/synthetic-icc.ts` (held to `pdfnative/tools`), `THIRD-PARTY-NOTICES.md` in the verified set, the DCO paragraph in CONTRIBUTING, `verification.validator_covered_by`, the `keyword-count` rule (this file had quoted a keyword figure nearly twice the real one).
- [x] **Security** — every open Dependabot alert closed (twelve GHSA ids, `npm audit --audit-level=high` clean); CodeQL findings closed (`escapeRegExp`, the mock TSA body, calls carrying `password` never cached).
- [x] **Fix: `strict` on `embed_image`** — a strict diagnostic kept being re-wrapped as `VALIDATION_ERROR`; it now carries its own code.

<!-- verify-docs:allow tool-parity -->
_v1.8.0 is the active release. `redact_pdf` stays **deferred** by design (overlay/flatten ≠ content removal)._

---

## Planned

### Blocked upstream

The page-tree tools, the annotation writer (link annotations included since 1.8.0),
the encrypted round-trip, charts, form fill/flatten, the full PAdES LTV ladder with
offline `/VRI` composition, print production, spot colours, metadata updates, native
ECDSA verification and coded decode failures have all shipped on their respective
pdfnative exports. The remaining items stay **blocked/deferred**: pdfnative does not
yet export a content-*removal* API, and implementing one on raw primitives would
contradict this project's faithful, thin-wrapper philosophy; two engine limits are
pinned by `it.fails` tests that go red the day the engine lifts them.

- [ ] **Tool `redact_pdf`** — **deferred by design.** pdfnative can overlay annotations and flatten forms, but not *remove* page content; an overlay-only "redaction" would leave the original bytes intact and create false security, which fails this project's honesty bar. Blocked on an upstream true content-removal API (tracked as a `draft_governance_issue` feature request).
- [ ] **Thai above vowel + tone mark pair** extracts in geometric order on untagged output — `ตั้ง` comes back as `ตัง้`: the pair is canonically equivalent rather than reordered, so the 1.9.0 `/ActualText` span (which covers reordered clusters) does not wrap it, and the ToUnicode entry is right. Rendering is unaffected; tagged output (`pdfA`) round-trips exactly. Pinned with `it.fails` in `tests/scripts.test.ts` (`EXTRACTION_LIMITS`). <!-- demo-language: th (the pair the limit concerns) -->
- [ ] **non-Latin-1 form values** under `fill_form { nonWinAnsi: 'needAppearances' }` — the engine's `fillForm()` writes the low byte of every UTF-16 code unit into `/V`, so `Ω` or `漢` do not come back from `read_form_fields` (`Zürich — Ωmega` reads as `Zürich \u0014 ©mega`); WinAnsi values and every other text string (`/Info`, `/T`, outlines, page labels — pdfnative 1.9.0 #85) round-trip. The read side (`readFormFields` → `decodePdfTextString`) is already in place. A new limit found by this release; pinned with `it.fails` in `tests/upstream-limits.test.ts`. <!-- demo-language: el, zh (the characters the limit concerns) -->
- [ ] **Per-tool HTTP page-by-page streaming** — MCP 2026-07-28 still has no partial `structuredContent` envelope (results are `resultType: 'complete'` only), so large results stay single-shot; pdfnative already provides `streamMergedPdfs` / `streamSplitPdf` / `streamExtractPages`.

### Next

- [ ] **Dev-toolchain majors** — vitest 5 / `@vitest/coverage-v8` 5, TypeScript 7, ESLint 10 (Dependabot ignores the majors on purpose): each may change the reporter, the config format and the coverage figures, so they move one at a time with a gate run and a threshold review, outside an engine-alignment release.
- [ ] **Catalogue compaction, Tier 2** — `tools/list` is ≈ 355 kB under a 384 KiB budget; the next step is structural (shared output schemas, a shorter inline colour union) and needs a fixture refresh reviewed under `docs/API_STABILITY.md` §5 — `$ref` / `$defs` stay excluded by policy (host compatibility).
- [ ] **A storage repository for the fuzz corpora** — ClusterFuzzLite keeps its corpora in the GitHub Actions cache (evicted); a dedicated repository (the ClusterFuzzLite `storage-repo` option) keeps them across evictions. Needs a repository the maintainer creates.
- [ ] **The remaining audit-mode jobs to block mode** — `verapdf.yml`, `scorecard.yml`, `codeql.yml`, `fuzz.yml`, the `workflow-lint` job and the `build` / `registry` jobs of `publish.yml` carry a dated audit reason; once a run has baselined their hosts (software.verapdf.org, Adoptium, ghcr.io, the ClusterFuzzLite images, the Scorecard API, registry.modelcontextprotocol.io) each moves to `egress-policy: block` with its allow-list. Windows runners stay in audit mode (the action's limit); macOS stays without the action.
- [ ] **OpenSSF Best Practices badge** — register the project at bestpractices.dev (a maintainer step: the account is theirs) and link the badge in the README; the self-assessment answers are already true of the repository (tests, CI, signed releases, vulnerability policy).
- [ ] **ORCID / DOI in `CITATION.cff`** — the identifiers are the maintainer's to provide (an ORCID for the author, a Zenodo DOI for the archived release).

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
