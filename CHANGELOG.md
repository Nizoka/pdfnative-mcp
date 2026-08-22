# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.6.0] - 2026-08-23

A minor, backward-compatible release that aligns the server with
[pdfnative v1.7.0](https://github.com/Nizoka/pdfnative) and the MCP 2026-07-28
specification, and grows the catalogue to **27 tools**: the full PAdES baseline
ladder (`sign_pdf` timestamps, `add_ltv`, `timestamp_pdf`), print production,
charts v2, PDF/A conformance diagnostics with `embedFonts`, `update_metadata`,
the SDK v2 transport with legacy fallback, and a network charter that keeps the
server offline by default (operator-configured TSA / OCSP / CRL endpoints only).
Default tool outputs stay byte-identical except where pdfnative 1.7.0 corrected
previously-wrong output (see `release-notes/v1.6.0.md` → Upgrade).

### Added

- **feat(tool): add_ltv** — PAdES B-LT Document Security Store; `mode: 'online'` (operator revocation provider, `REVOCATION_NOT_CONFIGURED` otherwise) or `mode: 'offline'` (parse-validated caller material); `summary` in the structured result.
- **feat(tool): timestamp_pdf** — PAdES B-LTA document timestamp through the operator TSA (`TSA_NOT_CONFIGURED` otherwise), verified before embedding, auto-suffixed field names for periodic re-timestamping.
- **feat(tool): update_metadata** — incremental `/Info` + XMP rewrite (title / author / subject / keywords / pinned `modDate`); encrypted sources rejected.
- **feat(sign): sign_pdf** — `profile`, `timestamp`, `algorithm` rsa-sha384 / rsa-sha512, `certChainDerBase64`, `fieldName`, `allowMultiple`; errors `PLACEHOLDER_AMBIGUOUS`, `SIGNATURE_FIELD_NOT_FOUND`, `TSA_REJECTED`.
- **feat(sign): prepare_signature_placeholder** — `subFilter`, `reserveTimestamp`.
- **feat(verify): verify_pdf** — `/DocTimeStamp` entries verified as RFC 3161 tokens, per-signature `subFilter`, opt-in `ltv` view (`profile`, `timestamp`, `revocation`, `ltvLevel`, document-level `dss` / `ltvLevel` / `caveats`).
- **feat(inspect): inspect_pdf** — `signatures: true` inventory (`subFilter`, `isDocTimestamp`, `isPlaceholder`, `byteRange`, `vriKey`), presence-gated `dss` / `docTimestampCount` / `trapped`, page boxes + `userUnit` under `pages: true`, `check` values `dss` / `docTimestamp` / `trapped`.
- **feat(print):** `print`, `outputIntent`, `metadata`, `strict`, `includeDiagnostics`, `embedFonts` on generate_basic_pdf, add_table (both backends), add_international_text (no `embedFonts` — fonts are always embedded), add_chart, add_barcode, embed_image, add_form, add_attachment, prepare_signature_placeholder; `viewerPreferences` gains `duplex`, `pickTrayByPDFSize`, `printPageRange`, `numCopies`. Errors `PRINT_ERROR`, `GENERATION_FAILED`; `PDF_A_COMPLIANCE_VIOLATION` also covers strict diagnostics and `userUnit` under pdfa1b.
- **feat(chart):** charts v2 fields on `add_chart` and the `chart` block of `generate_basic_pdf`; engine cross-field rules surface as `CHART_ERROR` with the remedy.
- **feat(mcp):** MCP 2026-07-28 on `@modelcontextprotocol/server` ^2.0.0 with legacy fallback; `SERVER_CACHE_HINTS`; dependency-free node:http bridge (`src/http.ts`); stdio smoke and 2026-era HTTP conformance tests.
- **feat(network):** `src/network.ts` — operator-configured TSA / OCSP / CRL providers with the SSRF guard; env vars `PDFNATIVE_MCP_TSA_URL`, `PDFNATIVE_MCP_TSA_AUTH`, `PDFNATIVE_MCP_REVOCATION`, `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS`, `PDFNATIVE_MCP_NETWORK_TIMEOUT_MS`; errors `TSA_NOT_CONFIGURED`, `REVOCATION_NOT_CONFIGURED`, `NETWORK_HOST_NOT_ALLOWED`, `NETWORK_ERROR`, `LTV_NO_SIGNATURE`, `LTV_EMPTY`, `LTV_MATERIAL_INVALID`, `LTV_ERROR`, `METADATA_ERROR`.
- **feat(validation):** advisory veraPDF corpus — `npm run corpus:pdfa` / `npm run validate:pdfa` (pinned veraPDF 1.30.2, Windows `.bat` launcher supported) and the non-blocking `verapdf.yml` workflow.
- **test:** offline mock PKI (`tests/_ltv-fixtures.ts`), loopback RFC 3161 server (`tests/_tsa-server.ts`), in-memory MCP harness (`tests/_mcp-harness.ts`), HTTP fixture; 635 tests across 54 files; coverage thresholds raised to 89 / 80 / 90 / 91.
- **docs:** guides `LTV.md`, `PRINT.md`; examples `pades-ltv-ladder`, `ltv-offline`, `multi-signature`, `update-metadata`, `stacked-bar-chart`, `dual-axis-time-chart`, `scatter-log-chart`, `print-bleed-marks`, `pdfa-embed-fonts`.

### Changed

- **chore(deps): pdfnative** `^1.6.0` → `^1.7.0` (additive, 0 removed exports). Free wins: colour-emoji flag and ZWJ sequences render as single glyphs; Arabic ALEF joining and Persian forms, RTL digit order and paired-delimiter mirroring are now UAX #9 conformant; incremental writer / xref reader hardening.
- **chore(deps): MCP SDK** `@modelcontextprotocol/sdk` ^1.29 → `@modelcontextprotocol/server` ^2.0.0 (+ `@modelcontextprotocol/core`); `zod` ^4.2.0. Still three runtime dependencies; the transitive tree no longer contains hono / express / jose.
- **chore(api):** `_meta.apiVersion` `1.5.0` → `1.6.0`; package / server versions → `1.6.0`.
- **chore(governance):** the charter keeps "no GitHub write path" and "no telemetry" absolute and now states the single permitted egress class: operator-configured TSA / OCSP / CRL endpoints, never a URL from a tool argument (`ai-governance.json`, `AGENT_RULES.md`, MCP governance prompts).
- **chore(http):** GET / DELETE on `/mcp` answer 405 (stateless serving, no SSE resumability — unchanged for the stateless mode v1.5 already used); Host / Origin loopback guard kept.

### Fixed

- **fix(sign):** `signerName` / `reason` / `location` / `contactInfo` / `signingTime` never reached the `/Sig` dictionary — pdfnative < 1.7 dropped the values passed at placeholder time and wrote `/M` = *now*. They are now baked into the placeholder (`sign_pdf` when it injects one, `prepare_signature_placeholder` always), so `verify_pdf` reports them and a pinned `signingTime` lands in `/M` (a pre-built placeholder keeps its own `/M`).
- **fix(verify):** a `/DocTimeStamp` field was parsed as a CMS signature and flipped `allValid` to `false` on every B-LTA document; document timestamps are now verified as RFC 3161 tokens.
- **fix(docs):** the PDF/A guide claimed every font was embedded; base-14 Helvetica text is not. See `embedFonts`.

### Upgrade notes

No breaking changes. Drop-in replacement for v1.5.0. Deliberate behaviour changes inherited from pdfnative 1.7.0 — in each case the previous output was wrong or non-conformant:

- **RTL text** (`add_international_text`): digit runs keep logical order, paired delimiters mirror, ALEF joins correctly and Persian letters take positional forms — every Arabic-script document renders differently, and correctly.
- **Forms** (`add_form`, `fill_form`): the AcroForm `/Helv` font carries `/ToUnicode` in every mode (form text becomes searchable); all form outputs change bytes.
- **Tagged / PDF/A documents on base-14 fonts** (`pdfA` on the document tools): the shared WinAnsi `/ToUnicode` CMap is emitted; bytes change. The same configuration now raises the `PDFA_NO_FONT_ENTRIES` diagnostic — silent by default, visible with `includeDiagnostics`, fatal with `strict`; fix it with `embedFonts: true`.
- **Incremental outputs** (`prepare_signature_placeholder`, `sign_pdf`, `annotate_pdf`, `fill_form`, the new LTV tools): `/ID[1]` is regenerated per revision and an EOL is inserted before the appended revision; earlier revisions stay a byte-exact prefix.
- **CMS signatures**: signed attributes are encoded in canonical DER order; signatures remain valid.
- **Charts** whose x labels previously overlapped now draw every Nth label; `labelStride: 1` restores the old draw-everything behaviour.
- **Colour emoji** (`add_international_text` with `emoji`): COLRv1 `PaintComposite` layers are now rendered, so flag sequences draw as flat flags instead of tofu — output bytes change for every document containing emoji input.
- **`draft_governance_issue`**: the `HUMAN_GATE` charter sentence was reworded to state the single permitted egress class (operator-configured TSA / OCSP / CRL, never GitHub), so the draft markdown and `complianceReport.humanGate` text differ from v1.5.0. Deliberate charter update; the report shape is unchanged.
- **`sign_pdf` placeholder size**: the default reservation is now `max(16384, estimateContentsSize(cert, algorithm))` instead of a flat 16384 bytes — identical for signer certificates up to roughly 10 KB, larger (different bytes) beyond, where the old size risked an overflow. Pass `placeholderBytes` to pin it.
- **MCP transport**: hosts that speak MCP 2026-07-28 now receive `resultType`, cache hints and `_meta.serverInfo`; 2025-era hosts see no difference. Programmatic consumers of `createServer()` now receive an `@modelcontextprotocol/server` `Server` instance.

### Security

- **Network egress policy** — no outbound request by default; the only permitted egress goes to operator-configured RFC 3161 / OCSP / CRL endpoints (`PDFNATIVE_MCP_TSA_URL`, `PDFNATIVE_MCP_REVOCATION`, `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS`). Certificate-supplied OCSP / CRL URLs pass an SSRF guard: http(s) only, no embedded credentials, no redirects, allow-listed hosts, loopback / link-local / private / unique-local / multicast literals rejected unless listed verbatim, response-size caps, per-request timeouts, secrets never echoed.
- **Dependency surface** — the MCP SDK v2 swap removes hono / express / jose from the transitive tree; `npm audit` reports 0 vulnerabilities.

### Deferred by design

- **redact_pdf** stays deferred (overlay / flatten ≠ content removal; pdfnative 1.7.0 exports no content-removal API). `verify_pdf` keeps its local P-256 ECDSA verifier (`ecdsaVerifyHash` still not exported). Per-tool HTTP page streaming remains blocked: MCP 2026-07-28 still has no partial `structuredContent` envelope.
- The opt-in telemetry hook stays a long-term item and is intentionally not part of this release.

## [1.5.0] - 2026-07-21

A minor, backward-compatible release that aligns the server with
[pdfnative v1.6.0](https://github.com/Nizoka/pdfnative) and takes the catalogue to
**24 tools**. It adds native vector charts, AcroForm fill/flatten, an encryption
round-trip (decrypt + AES-128/256 re-encrypt), rewrites `extract_text` onto real
Unicode extraction with positioned runs, threads a `password` input through the
read-only and page-tree tools, and exposes generated PDFs as native **MCP
resources**. Default tool calls return responses identical to v1.4.0 — all new
behaviour is opt-in.

### Added

- **Tool `add_chart`** (new): native vector charts — `bar`, `barH`, `line`, `pie`, `donut` — rendered as pure PDF path operators (zero rasterisation) via pdfnative v1.6.0's `ChartBlock`. Multi-series, legends, nice axis ticks, gridlines, negative values, hex palettes, and an auto-generated tagged-PDF `/Figure` + `/Alt` (PDF/A-safe). `generate_basic_pdf` also accepts a `chart` block for composition with text/tables.
- **Tool `read_form_fields`** (new, read-only): enumerate an existing AcroForm's field tree (name, type, value, flags, options, widget placements) — the input inventory for `fill_form`.
- **Tool `fill_form`** (new): fill and/or flatten an *existing* AcroForm via pdfnative's `fillForm`/`flattenForm` (non-destructive incremental update). Values map field name → string | boolean | string[]; `flatten:true` bakes appearances in; a pure flatten needs no values. Typed errors `FORM_FIELD_NOT_FOUND`, `FORM_VALUE_TYPE_ERROR`, `FORM_UNSUPPORTED`.
- **Tool `encrypt_pdf`** (new): re-secure a PDF with the Standard Security Handler (AES-128 V4/R4 default, AES-256 V5/R6; RC4 never emitted). Owner/user passwords, permissions, and one-call password rotation of an already-encrypted source.
- **Tool `decrypt_pdf`** (new): open an encrypted PDF (RC4 / AES-128 / AES-256) and emit an unencrypted copy.
- **`password` input** on the read-only tools `inspect_pdf`, `verify_pdf`, `extract_text`, `extract_attachments` — open encrypted sources transparently (empty-user-password documents need no password). New error codes `PASSWORD_REQUIRED`, `PASSWORD_INVALID`, `ENCRYPTION_UNSUPPORTED`.
- **`inspect_pdf`**: optional `encryptionInfo` output field (`{ algorithm, revision, authenticatedAs }`) sourced from `reader.encryption`.
- **`extract_text`**: rewritten onto pdfnative's `extractText()` — real Unicode via `/ToUnicode` (subset fonts decode to characters, not glyph indices), optional `includeRuns` returning positioned runs (`{ text, x, y, fontSize, fontName }`), `password`, and a `maxTextLength` memory cap. Output schema unchanged; `runs` is additive.
- **`merge_pdfs` / `split_pdf` / `extract_pages`**: optional `password` (ingest encrypted sources) and `encrypt` (re-secure the output) — completing the encrypted round-trip *open → edit → re-secure*.
- **Native MCP resources:** the server advertises the `resources` capability. PDFs written in `outputMode:'file'` are exposed as `resources/list` + `resources/read` (and a `resources/templates/list` template `pdfnative://output/{path}`), and file-mode tool results carry a `resource_link` for cross-call re-reference.
- **Tool annotations:** every tool now advertises MCP `annotations` (`readOnlyHint`, `destructiveHint:false`, `idempotentHint`, `openWorldHint:false`).
- **Examples:** `chart-report.json`, `fill-form.json`, `encrypt-decrypt-roundtrip.json`, `encrypted-merge.json`, `extract-text-runs.json`.
- **Tests:** `add-chart.test.ts`, `read-form-fields.test.ts`, `fill-form.test.ts`, `encrypt-pdf.test.ts`, `decrypt-pdf.test.ts`, `resources.test.ts`, `encrypted-reads.test.ts`, `pagetree-encryption.test.ts`, `add-barcode.test.ts` (coverage gap), plus in-process encrypted fixtures `tests/_encrypted-fixtures.ts` (unblocks the roadmap's encrypted round-trip fixtures). `extract-text.test.ts` rewritten for the Unicode/runs/password surface.
- **Docs:** new guides `docs/guides/CHARTS.md`, `docs/guides/FORMS.md`, `docs/guides/ENCRYPTION.md`; new `CLAUDE.md` (Claude Code guidance).

### Changed

- **Dependency:** `pdfnative` bumped `^1.5.0` → `^1.6.0` (additive; decrypt/re-encrypt, `extractText`, fill/flatten, charts, streaming). Free improvements surfaced: colour-emoji subset 221 → 1167 glyphs, spec-compliant AES-256 (R6) hashing, encryption of all strings, arrows routed to the math font, and a more tolerant xref reader.
- **MCP `_meta.apiVersion`** bumped `1.4.0` → `1.5.0` on every tool; `SERVER_VERSION`, `server.json` versions, and `package.json` version → `1.5.0`.
- **Server:** `SERVER_DESCRIPTION` and `SERVER_INSTRUCTIONS` extended to **24 tools** (charts, forms, encryption branches, MCP resources note).
- **Page-tree tools:** encrypted sources are no longer rejected outright — a password-protected source without a password now returns `PASSWORD_REQUIRED` (was `ENCRYPTED_SOURCE`), and empty-user-password documents process transparently. Signatures/AcroForm are still dropped by a page-tree edit.
- **Docs:** README, `AGENTS.md`, `docs/API_STABILITY.md`, `docs/AI_GUIDE.md`, `docs/KNOWLEDGE_BASE.md`, `ROADMAP.md`, `llms.txt`, and `.github/copilot-instructions.md` refreshed for the v1.5.0 surface.

### Fixed

- **`extract_text`** no longer emits glyph indices for subset fonts that ship a `/ToUnicode` CMap — the long-standing "best-effort" limitation is resolved by pdfnative v1.6.0's decoder.
- **`add_barcode`** gains a dedicated test file (previously only two cases folded into `tools.test.ts`).

### Security

- **Encryption tools are never cached.** `encrypt_pdf` and `decrypt_pdf` are excluded from the opt-in response cache (`PDFNATIVE_MCP_CACHE_DIR`), so decrypted plaintext (or freshly-protected bytes) of a deliberately-encrypted document is never persisted at rest. `draft_governance_issue` is now correctly annotated `readOnlyHint:false` (it writes a `.md` in `outputMode:'file'`).

### Deferred by design

- **`redact_pdf`** stays deferred — pdfnative can overlay/flatten but not *remove* page content; an overlay-only redaction would create false security. `verify_pdf` continues to ship a local P-256 ECDSA verifier because pdfnative does not export `ecdsaVerifyHash` (public crypto surface unchanged in 1.6.0). Per-tool HTTP page-by-page streaming remains blocked on MCP partial `structuredContent` envelopes.

## [1.4.0] - 2026-07-14

A minor, backward-compatible release that brings the pdfnative AI-governance /
Human-In-The-Loop (HITL) system to the MCP surface, adds markup annotations and a
local, network-free GitHub-issue drafter (taking the catalogue to **19 tools**),
surfaces page labels in `inspect_pdf`, adds an explicit `math` script to
`add_international_text`, advertises the MCP `prompts` capability, and upgrades to
[pdfnative v1.5.0](https://github.com/Nizoka/pdfnative). Default tool calls return
responses identical to v1.3.0 — all new behaviour is opt-in.

### Added

- **Tool `draft_governance_issue`** (19th tool): assembles a governance-compliant GitHub issue draft plus a structured `compliance` report and returns them — never submits, no network call. Rejects contract breaches (runtime dependency, missing reproduction, `duplicateSearchPerformed:false`) with the new `GOVERNANCE_VIOLATION` error.
- **Tool `annotate_pdf`** (18th tool): overlay markup annotations (`text`, `highlight`, `underline`, `strikeout`, `squiggly`, `square`, `circle`, `line`, `freetext`) on an existing PDF via pdfnative v1.5.0's incremental-update annotation writer. Visual overlay only — not a redaction. Encrypted sources → `ENCRYPTED_SOURCE`.
- **`inspect_pdf`**: optional `pageLabels[]` output field (`{ startPage, style?, prefix?, start? }`), present only when the PDF declares `/PageLabels`.
- **`add_international_text`**: explicit `math` lang code (Noto Sans Math), embedded on demand only when requested (no global auto-routing).
- **MCP prompts:** the server now advertises the `prompts` capability with `governance_contract` and `draft_issue_workflow`.
- **Governance:** new `src/governance.ts`, `src/version.ts`, `src/fonts.ts`, `GovernanceError` in `src/errors.ts`, `writeSandboxedText()` in `src/output.ts`; contract files `.github/ai-governance.json`, `.github/AGENT_RULES.md`, `.github/drafts/README.md`; `scripts/verify-issue.mjs` CLI (`npm run verify:issue`).
- **Docs:** new `docs/guides/AI_GOVERNANCE.md` (HITL contract + workflow).
- **Examples:** `annotate-pdf.json`, `draft-governance-issue.json`, `math-symbols.json`, `page-labels-inspect.json`.
- **Tests:** `annotate-pdf.test.ts`, `draft-governance-issue.test.ts`, `governance.test.ts`, `fonts.test.ts`; extended `server.test.ts` (prompts + 19 tools), `inspect-pdf.test.ts` (`pageLabels`), `output.test.ts` (`.md` writer).

### Changed

- **Dependency:** `pdfnative` bumped `^1.4.0` → `^1.5.0` (additive; new annotation writer + page-label reader).
- **MCP `_meta.apiVersion`** bumped `1.3.0` → `1.4.0` on every tool; `SERVER_VERSION`, `server.json` versions, and `package.json` version → `1.4.0`.
- **Server:** `SERVER_DESCRIPTION` and `SERVER_INSTRUCTIONS` extended to **19 tools** (governance decision branch + corrected math note — explicit lang, not global auto-routing).
- **Docs:** README, `AGENTS.md`, `docs/AI_GUIDE.md`, `docs/API_STABILITY.md`, `docs/KNOWLEDGE_BASE.md`, `ROADMAP.md`, `llms.txt`, and `.github/copilot-instructions.md` refreshed for the v1.4.0 surface.

### Deferred by design

- **`redact_pdf`** stays deferred. pdfnative v1.5.0's annotation writer can only *overlay* content; an overlay-only "redaction" would leave the original bytes intact and create false security, which fails this project's honesty bar. Tracked as an upstream content-removal feature request. An **encrypted-PDF round-trip** likewise remains blocked on a Standard Security Handler writer.

## [1.3.0] - 2026-07-07

A minor, backward-compatible release that adds three page-tree tools
(`merge_pdfs`, `split_pdf`, `extract_pages` — taking the catalogue to **17 tools**),
threads the new [pdfnative v1.4.0](https://github.com/Nizoka/pdfnative) document
features (bookmarks, page labels, nested lists, viewer preferences, table cell
borders) into the authoring tools, and hardens `sign_pdf` with a constant-time
`node:crypto` signature provider (transparent pure-JS fallback). Default tool calls
return responses identical to v1.2.0 — all new behaviour is opt-in.

### Added

- **Tool `merge_pdfs`** (new): concatenate 2–50 PDFs (`pdfsBase64[]`) into one via pdfnative's page-tree API. Optional `dropAnnotations`/`maxOutputSizeBytes`. Encrypted sources → `ENCRYPTED_SOURCE`; oversize output → `OUTPUT_TOO_LARGE`.
- **Tool `split_pdf`** (new): split one PDF into one document per page range (`ranges: [{ start, end? }]`, 0-based inclusive). Returns the new multi-output shape `{ mode, count, totalSizeBytes, parts[] }`; file mode writes indexed paths (`report-1.pdf`, …).
- **Tool `extract_pages`** (new): pull an arbitrary page subset (`pages: number[]`, 0-based, max 5000) into a single PDF.
- **`generate_basic_pdf`**: optional `outline` (`'auto'` or explicit `[{ title, pageIndex, children?, open? }]` tree), `pageLabels` (`[{ startPage, style?, prefix?, start? }]`), nested `list` items (`{ text, items?, style? }`), and `viewerPreferences`.
- **`add_table`**: optional `cellBorders`, `cellVAlign` (`'top'|'middle'|'bottom'`), and `viewerPreferences` (any forces the document backend).
- **`add_international_text`**: optional `viewerPreferences`.
- **Signing:** new `src/crypto-provider.ts` constant-time `node:crypto` provider; new `emitPdfMulti()` + `MultiOutputResult`/`MultiOutputPart` in `src/output.ts`; new `src/pagetree.ts` error mapping; new `src/doc-features.ts` shared schemas/mappers.
- **Security (HTTP transport):** the optional Streamable HTTP transport (`PDFNATIVE_MCP_PORT`) now enables DNS-rebinding protection — `Host`/`Origin` pinned to the loopback authority; foreign values are rejected with **403** (MCP Security Best Practices). stdio is unaffected.
- **serverInfo metadata:** the server now advertises a human-readable `title` + `description` (MCP `Implementation`, mirroring `server.json`).
- **Examples:** `merge-pdfs.json`, `split-pdf.json`, `extract-pages.json`, `bookmarked-report.json`, `bordered-table.json`.
- **Tests:** `merge-pdfs.test.ts`, `split-pdf.test.ts`, `extract-pages.test.ts`, `crypto-provider.test.ts`, `sign-pdf-provider.test.ts`, `doc-features.test.ts`, `http-transport.test.ts` (DNS-rebinding 403), a JSON-Schema-2020-12 dialect guard + `serverInfo` metadata assertions, `_pagetree-fixtures.ts`.

### Changed

- **Dependency:** `pdfnative` bumped `^1.3.0` → `^1.4.0` (additive; new page-tree, outline, page-label, viewer-preference, nested-list, and cell-border APIs).
- **Signing:** RSA and EC-DER keys now sign through a per-call `node:crypto` provider (constant-time) with a transparent pure-JS fallback; the raw-scalar `ecPrivateScalarHex` path stays pure-JS. Produced signatures are interoperable and verify identically.
- **MCP `_meta.apiVersion`** bumped `1.2.0` → `1.3.0` on every tool; `SERVER_VERSION` and `server.json` versions → `1.3.0`.
- **Server:** `SERVER_INSTRUCTIONS` decision tree extended to 17 tools; new `MULTI_PDF_OUTPUT_SCHEMA` advertised for `split_pdf`.
- **MCP protocol alignment:** built on `@modelcontextprotocol/sdk` ^1.29, which negotiates the latest **2025-11-25** revision (fallback `2025-06-18`/`2025-03-26`); tool schemas are JSON Schema 2020-12 (dialect-agnostic); `merge_pdfs`' `maxOutputSizeBytes` documented as the in-memory assembly guard (distinct from the 50 MiB emit cap).
- **Docs:** README, `AGENTS.md`, `docs/AI_GUIDE.md`, `docs/API_STABILITY.md`, `docs/KNOWLEDGE_BASE.md`, `docs/guides/LOCAL_TESTING.md`, `ROADMAP.md`, `llms.txt`, and `.github/copilot-instructions.md` refreshed for the v1.3.0 surface + protocol alignment.

### Deferred (still blocked upstream)

- **`redact_pdf`** and an **encrypted-PDF round-trip** — pdfnative does not yet export a content-redaction API or a Standard Security Handler writer. Remain on the roadmap. (`merge_pdfs`, `split_pdf`, `extract_pages` shipped in this release.)

## [1.2.0] - 2026-06-23

A minor, backward-compatible release that adds a 14th tool (`extract_attachments`),
text watermarks and opt-in Unicode normalization, makes the read-only tools
token-frugal for AI agents (typically ~90% fewer output tokens on large results),
upgrades to zod 4, and fixes the MCP registry publish block caused by `mcpName`
casing. Default tool calls return responses identical to v1.1.0 — all new
behaviour is opt-in.

### Added

- **Tool `extract_attachments`** (new, read-only): extract embedded files from a PDF byte-for-byte, completing the Factur-X / ZUGFeRD round-trip with `add_attachment`. Returns `{ attachmentCount, attachments: [{ name, sizeBytes?, mimeType?, relationship?, description?, dataBase64? }] }`. Shares the `collectEmbeddedFiles()` collector with `inspect_pdf`; supports a `filename` filter and an `includeData: false` metadata-only probe; rejects encrypted PDFs (`EXTRACTION_UNSUPPORTED`); caps payloads at 16 MiB/file and 32 MiB aggregate.
- **Watermarks:** `generate_basic_pdf` and `add_table` gain an optional `watermark` ({ text, fontSize?, opacity?, angle?, color? [r,g,b] 0–1, position? }) rendered on every page. Omitted = byte-identical output; a semi-transparent watermark (`opacity < 1.0`, including the 0.15 default) is rejected under `pdfA: 'pdfa1b'` with a stable `PDF_A_COMPLIANCE_VIOLATION` error (ISO 19005-1 §6.4 forbids transparency).
- **Unicode `normalize`:** `generate_basic_pdf` and `add_international_text` gain an optional `normalize` (`'NFC'|'NFD'|'NFKC'|'NFKD'`). `add_international_text` keeps its `'NFC'` default; `generate_basic_pdf` defaults to no normalization (byte-stable).
- **Token-frugal reads:** `inspect_pdf`, `verify_pdf`, `validate_pdf`, `extract_text`, and `extract_attachments` gain an optional `verbosity` input (`'summary'` | `'full'`, default `'full'`). `'summary'` returns a canonical scalar subset — e.g. `verify_pdf` → `{ signatureCount, allValid, invalid, summary }`, `extract_text` → `{ pageCount, extractedPageCount, extractable, charCount }` — dropping the heavy arrays / full text.
- **Field projection:** the read-only tools gain an optional `fields` input — a dot-path projection (e.g. `['allValid']`, `['signatures.valid']`) applied **after** `verbosity` (order: `verbosity` shapes, then `fields` projects, then unknown paths are omitted leniently — never an error). Backed by a new dependency-free `src/projection.ts` module.
- **Docs:** new root `AGENTS.md` agent operations manual (catalogue, decision tree, recipes, error table).
- **Tooling:** examples-as-tests — `tests/examples.test.ts` executes every `examples/*.json` (validates tool names; runs self-contained examples and checks produced PDFs with the new `assertValidPdf` helper). New example files (`watermarked-report.json`, `basic-watermark-normalize.json`, `factur-x-roundtrip.json`, `token-frugal-read.json`) and an `examples:check` script.
- **Docs (contributing):** new `docs/guides/LOCAL_TESTING.md` covering the quality gate, examples runner, verifying PDF correctness, file output + viewer, optional veraPDF, and the MCP Inspector — linked from README and CONTRIBUTING.

### Changed

- **Dependency:** upgraded `zod` `^3.23.8` → `^4.0.0`. The MCP SDK peer range already permitted zod 4. Tool error **codes** are unchanged — clients branch on `error.code`, not zod prose.
- **MCP registry ID:** `mcpName` (`package.json`) and `name` (`server.json`) → `io.github.Nizoka/pdfnative-mcp` (canonical GitHub login casing). The npm package name stays lowercase `pdfnative-mcp`.
- **MCP `_meta.apiVersion`** bumped `1.1.0` → `1.2.0` on every tool; `SERVER_VERSION` and `server.json` versions → `1.2.0`.
- **Base64 delivery:** base64-mode PDF-producing tools no longer duplicate the PDF into `structuredContent.base64`; the bytes are delivered once via the embedded `resource` content block. `structuredContent` for base64 mode is now `{ mode, sizeBytes }`. File mode is unchanged.
- **Docs:** README, `AGENTS.md`, `docs/AI_GUIDE.md`, `docs/API_STABILITY.md`, `docs/KNOWLEDGE_BASE.md`, `ROADMAP.md`, and `llms.txt` refreshed for the v1.2.0 surface.

### Fixed

- **MCP registry publication** failed because validation compares `mcpName` to the GitHub namespace with case-sensitive equality (`Nizoka`), while the published metadata used lowercase `nizoka`. Corrected to `io.github.Nizoka/pdfnative-mcp`.
- **Stale example** `multilingual-doc.json` used the removed `text` field instead of `paragraphs`; corrected and now guarded by examples-as-tests.

## [1.1.0] - 2026-06-09

A minor, fully backward-compatible release that upgrades the engine to
[pdfnative v1.3.0](https://github.com/Nizoka/pdfnative/releases/tag/v1.3.0) and
hardens the server for AI agents. Adds a 13th tool (`validate_pdf`), six new
scripts, COLRv1 colour emoji, and a deterministic newline sanitizer. No breaking
changes.

### Added

- **Tool `validate_pdf`** (new, read-only): PDF/UA (ISO 14289-1) structural conformance check wrapping pdfnative's `validatePdfUA()`. Verifies catalog `/MarkInfo /Marked true`, `/StructTreeRoot` (+ `/ParentTree`), `/Metadata` (XMP), `/Lang`, and per-page MCID uniqueness. Returns `{ standard: 'pdf-ua-1', valid, errors[], warnings[], summary }`. A fast developer-time gate, not a substitute for a full reference validator (veraPDF).
- **`add_international_text`**: six new scripts — Telugu (`te`), Sinhala (`si`), Tibetan (`bo`), Khmer (`km`), Myanmar (`my`), Ethiopic (`am`) — for **24 scripts** total, via pdfnative v1.3's new bundled Noto font modules.
- **`add_international_text`**: COLRv1 colour emoji via the `emoji` lang code (`noto-color-emoji-data.js`), with automatic monochrome fallback.
- **Newline auto-split sanitizer** (`src/text.ts`): paragraphs containing `\n` / `\r\n` / `\r` are split into discrete paragraph blocks in `generate_basic_pdf` and `add_international_text`, eliminating `.notdef` tofu from LLM-style multi-line text. Whitespace-only paragraphs are rejected with `VALIDATION_ERROR`.

### Changed

- **Dependency:** `pdfnative` bumped `^1.2.0` → `^1.3.0`.
- **`add_international_text`** now passes `normalize: 'NFC'` to the document builder for maximal glyph coverage (intentionally changes output bytes for some decomposed inputs).
- **MCP `_meta.apiVersion`** bumped `1.0.0` → `1.1.0` on every tool; `SERVER_VERSION` → `1.1.0`.
- **`SERVER_INSTRUCTIONS` / `llms.txt`**: refreshed decision tree (13 tools), 24-script copy, and PDF/A survival directives.
- Tool count: **13** (was 12 in v1.0.0).

### Fixed

- **Euro sign and CP-1252 symbols** (`€ ‚ ƒ „ … † ‡ ™ œ ž Ÿ`) now render and extract correctly thanks to pdfnative v1.3 ([pdfnative #48](https://github.com/Nizoka/pdfnative/issues/48)); the previous `EUR` workaround is no longer needed.
- **Duplicate MCID in wrapped table cells** — pdfnative v1.3 assigns a unique MCID per line, making tagged/PDF-A tables with wrapping cells PDF/UA-safe.

### Deferred (still blocked)

- **`merge_pdfs`**, **`split_pdf`**, **`redact_pdf`** — pdfnative v1.3 still does not export the page-tree manipulation primitives required; building them on raw `openPdf` / `createModifier` would require production-unsafe page-tree surgery that contradicts the thin-wrapper philosophy. Remain on the roadmap, blocked upstream.

### Upgrade guide

1. Bump your dependency to `^1.1.0` — no code changes required.
2. Stop pre-splitting multi-line text or substituting `EUR` for `€`; write naturally.
3. After producing a tagged/PDF-A document, call `validate_pdf` to assert PDF/UA structural conformance.

## [1.0.0] - 2026-01-15

This is the **first stable release** of `pdfnative-mcp`. It consolidates the
deferred roadmap (v0.4 → v1.0) into a single major release and commits to API
stability via the new per-tool `_meta.apiVersion` field. Built on top of
[pdfnative v1.2.0](https://github.com/Nizoka/pdfnative/releases/tag/v1.2.0).

### Added

- **Tool `verify_pdf`** (new): read-only verification of every PAdES Baseline / `adbe.pkcs7.detached` signature in a PDF. For each `/Sig` widget, recomputes the `ByteRange` SHA-256, validates the CMS `messageDigest` (integrity), and verifies the CMS `signatureValue` with the embedded signer certificate. Optional `trustedRootsDerBase64` enables chain trust (otherwise `chainTrust` is `self-signed` or `unverified`). Supports **RSA-SHA256** and **ECDSA-SHA256 (P-256)**.
- **Tool `add_attachment`** (new): generate a **PDF/A-3 (ISO 19005-3)** document with one or more embedded files. Primary use case is **Factur-X / ZUGFeRD electronic invoices** (XML payload with `relationship: 'Source'`). Each attachment is validated against an 8 MiB per-file cap.
- **Tool `extract_text`** (new): best-effort plain-text extraction from a non-encrypted PDF. Walks each page's content stream and pulls the operands of `Tj` / `'` / `"` / `TJ` text operators. Reports `extractable: false` when a page has a non-empty content stream but yields no text (typically subset fonts without `/ToUnicode`). Encrypted PDFs are rejected with `EXTRACTION_UNSUPPORTED`.
- **`add_table`** now exposes six pdfnative v1.2 smart-table fields: `wrap`, `repeatHeader`, `zebra`, `caption`, `minRowHeight`, `cellPadding`.
- **`sign_pdf`** now accepts `ecPrivateKeyDerBase64` (SEC1 / PKCS#8) in addition to the raw scalar form, and `autoInjectPlaceholder: true` (default) transparently calls `addSignaturePlaceholder()` when the input PDF lacks a `/Sig` widget.
- **`inspect_pdf`** now reports `hasSignaturePlaceholder: boolean` (true when any `/Sig` widget has an empty `/Contents`, i.e. an unsigned placeholder awaiting `sign_pdf`) and an `attachments[]` summary (name, mimeType, size, relationship, description from `/Names/EmbeddedFiles`). Two new `check` enum values: `placeholder`, `attachments`.
- **Opt-in content-addressed response cache** (`src/cache.ts`): enabled by `PDFNATIVE_MCP_CACHE_DIR`. SHA-256 key over canonical JSON of `{tool, apiVersion, input}`, 1 h TTL, 256 MiB LRU cap (evict oldest by mtime). Skips `outputMode='file'` calls.
- **MCP `_meta.apiVersion = '1.0.0'`** on every tool listing (anchored to the new `docs/API_STABILITY.md` policy — server bumps the field when input or output schema changes incompatibly).
- **Per-tool `_meta.examples`** — every tool ships with 1–2 minimal call shapes for AI-agent discovery (drives Claude/Cursor/ChatGPT context grounding).
- **Documentation:** new [`docs/guides/PDFA.md`](docs/guides/PDFA.md) (tight, copy-paste-ready PDF/A authoring guide for AI agents).
- **Examples**: `examples/financial-report.json`, `examples/factur-x-invoice.json`, `examples/multilingual-doc.json`, `examples/sign-and-verify.json`.
- **Discovery:** `mcpName: "io.github.nizoka/pdfnative-mcp"` in `package.json`, new top-level `server.json` (MCP registry manifest) and `llms.txt` (llmstxt.org ingestion). Keywords expanded from 39 → 70+.
- **Citation & funding:** new `CITATION.cff` and `.github/FUNDING.yml`. README now shows OpenSSF Scorecard + CodeQL badges.

### Changed

- **Dependency:** `pdfnative` bumped `^1.1.0` → `^1.2.0`. pdfnative v1.2 fixes [#45](https://github.com/Nizoka/pdfnative/issues/45) (X.509 SubjectPublicKeyInfo unwrapping for raw cert slicing) and [#46](https://github.com/Nizoka/pdfnative/issues/46) (signature placeholder helper) used by `sign_pdf` and `prepare_signature_placeholder`.
- **`prepare_signature_placeholder`** now delegates to pdfnative's `addSignaturePlaceholder()` (the local v0.2 placeholder writer was removed; behaviour is byte-identical and the operation is idempotent against an already-placeholder'd PDF).
- **`inspect_pdf`**: the `signed` check is now `signatureCount > 0 && !hasSignaturePlaceholder` (a placeholder alone is no longer treated as a signed document — use the new `placeholder` check for that).
- Per-tool `_meta.apiVersion` introduced as the cache key's stability anchor. Initial value: `1.0.0` for every tool.
- Tool count: **12** (was 9 in v0.3.0).

### Fixed

- **Env-var typo:** the canonical name is now `PDFNATIVE_MCP_OUTPUT_DIR` (was `PDFNATIVE_MPC_OUTPUT_DIR`). The misspelt name continues to work as a deprecated alias and emits a one-shot stderr warning. Scheduled for removal in v2.0.0.

### Deferred to v1.1

- **`merge_pdfs`**, **`split_pdf`**, **`redact_pdf`** — pdfnative v1.2 does not yet export the page-tree manipulation primitives required for production-grade implementations. Shipping `501` stubs would weaken the v1.0 API surface, so these tools are explicitly held back.
- **Per-tool HTTP page-by-page streaming** — the MCP `structuredContent` envelope requires full bytes; `StreamableHTTPServerTransport` already chunks the response.
- **Encrypted-PDF round-trip fixtures** — would require implementing the PDF Standard Security Handler in pdfnative.

### Upgrade guide

1. Bump your dependency to `^1.0.0`.
2. Replace `PDFNATIVE_MPC_OUTPUT_DIR` with `PDFNATIVE_MCP_OUTPUT_DIR` in your MCP client configuration (the old name still works but logs a one-shot deprecation warning).
3. If you previously asserted `inspect_pdf` `checks.signed === true` against a PDF that contained only an *unsigned* placeholder, switch to `check: ['placeholder']`.
4. Want to verify signatures? Add a `verify_pdf` call after `sign_pdf` (see [`examples/sign-and-verify.json`](examples/sign-and-verify.json)).
5. Want a Factur-X invoice? Use `add_attachment` (it automatically emits PDF/A-3b).

## [0.3.0] - 2026-04-30

### Added

- **Tool `inspect_pdf`** (new): read-only inspection of an existing PDF reporting version, page count, encryption state (`none` / `aes-128` / `aes-256` / `rc4` / `unknown`), PDF/A claim (parsed from XMP), AcroForm signature count, and `/Info` dictionary. Optional `pages` flag returns per-page sizes; optional `check` array AND-evaluates CI assertions (`pdfa` | `signed` | `encrypted`) into a single `checksPassed` flag.
- **PDF/A output** on every document tool via the new optional `pdfA` flag (`pdfa1b` | `pdfa2b` | `pdfa2u` | `pdfa3b`). Powered by pdfnative v1.1's `tagged` layout option.
- **`add_international_text`**: support for `latin` and `emoji` font packs from pdfnative v1.1, plus polymorphic `lang` (string, array, or comma-separated) so a single document can mix scripts (e.g. `["ar", "emoji"]`). Auto-registers the `latin` font when `pdfA` is set.
- **`add_table`**: optional `autoFitColumns` and `clipCells` flags (pdfnative v1.1). When set, the tool transparently switches to the document-block backend (`buildDocumentPDFBytes` + `TableBlock`).
- Per-tool MCP **`outputSchema`** advertised in `tools/list` (per the MCP 2025-06-18 spec) so clients can validate responses statically.

### Changed

- Bumped `pdfnative` dependency to `^1.1.0` (zero-dependency engine adds Latin/Emoji fonts, PDF/A v2u/v3b, table autoFit/clip, hardened `openPdf` reader).
- Server version bumped to `0.3.0`.
- `SERVER_INSTRUCTIONS` updated to document all 9 tools and the new `pdfA` flag.
- `ensureCompressionReady()` now also awaits `initCrypto()` so the first signing or inspection call no longer pays an init penalty.
- Expanded npm `keywords` (now 39) and refreshed package description for better discoverability.

### Deferred to v0.4.0

- **`verify_pdf`** — deferred because pdfnative 1.1 does not yet expose a high-level CMS verification primitive; the manual byte-range + ASN.1 decode path will land in v0.4.0.
- **`sign_pdf` placeholder auto-injection** (today still requires `prepare_signature_placeholder`).
- **ECDSA DER-encoded private-key input** (today only the raw 32-byte scalar is accepted).
- **Encrypted-PDF fixtures** for `inspect_pdf` so the AES-128 / AES-256 / RC4 detection branches are exercised by unit tests.

## [0.2.0] - 2025-07-29

### Added

- Tool `add_table`: tabular PDF reports from column headers + data rows via `buildPDFBytes`. Supports `infoItems`, `footerText`, and file output mode.
- Tool `add_form`: interactive AcroForm PDFs with text fields, text areas, checkboxes, radio buttons, and dropdowns via `formField` blocks.
- Tool `embed_image`: embed a JPEG or PNG image (base64-encoded) into a titled PDF document with optional caption and render dimensions. Magic-byte validation prevents mime type mismatch.
- Tool `prepare_signature_placeholder`: creates a PDF with an embedded `/Sig` AcroForm placeholder ready for `sign_pdf` (step 1 of a two-step signing workflow). Supports signer metadata and optional body blocks.
- HTTP transport: `PDFNATIVE_MCP_PORT` environment variable enables Streamable HTTP mode on `http://127.0.0.1:<port>/mcp` (falls back to stdio when unset).

### Changed

- Server version bumped to `0.2.0`.
- `SERVER_INSTRUCTIONS` updated to document all 8 tools.

## [0.1.0] - 2026-04-26

### Added

- Initial public release.
- MCP server (`@modelcontextprotocol/sdk` v1.x, stdio transport) named `pdfnative-mcp`.
- Tool `generate_basic_pdf`: multi-page documents from headings, paragraphs, lists, page breaks, spacers.
- Tool `add_barcode`: QR / Code 128 / EAN-13 / Data Matrix / PDF417 in a single-page PDF.
- Tool `add_international_text`: 16 non-Latin scripts via embedded Noto fonts (Arabic, Hebrew, Thai, CJK, Devanagari, Bengali, Tamil, Cyrillic, Greek, Georgian, Armenian, Vietnamese, Turkish, Polish).
- Tool `sign_pdf`: PAdES CMS digital signatures (RSA-SHA256, ECDSA-SHA256 P-256), faithful wrapper around `pdfnative.signPdfBytes`.
- Sandboxed file output gated by `PDFNATIVE_MPC_OUTPUT_DIR` with strict path traversal protection.
- Strict JSON Schema + Zod validation at every tool boundary.
- Vitest test suite with sandbox security checks.

[Unreleased]: https://github.com/Nizoka/pdfnative-mcp/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/Nizoka/pdfnative-mcp/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/Nizoka/pdfnative-mcp/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/Nizoka/pdfnative-mcp/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Nizoka/pdfnative-mcp/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Nizoka/pdfnative-mcp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Nizoka/pdfnative-mcp/compare/v0.3.0...v1.0.0
[0.3.0]: https://github.com/Nizoka/pdfnative-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Nizoka/pdfnative-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Nizoka/pdfnative-mcp/releases/tag/v0.1.0


