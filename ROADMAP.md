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
- [x] **npm metadata** — 39 keywords, refreshed description, ⭐ star call-out.

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

- [x] **pdfnative v1.3.0** — dependency bump `^1.2.0` → `^1.3.0` (additive, no breaking changes).
- [x] **Tool `validate_pdf`** — read-only PDF/UA (ISO 14289-1) structural conformance check wrapping pdfnative's `validatePdfUA()`. 13th tool.
- [x] **Six new scripts** — `add_international_text` reaches **24 scripts**: Telugu, Sinhala, Tibetan, Khmer, Myanmar, Ethiopic.
- [x] **COLRv1 colour emoji** — native colour emoji via the `emoji` lang code, with monochrome fallback.
- [x] **Newline sanitizer (Safe PDF/A)** — embedded `\n` in a paragraph auto-splits into separate paragraphs; eliminates `.notdef` tofu from LLM-style multi-line text.
- [x] **Automatic NFC normalisation** — `add_international_text` normalises input to NFC for maximal glyph coverage.
- [x] **Engine fixes surfaced** — Euro/CP-1252 symbols extract correctly ([pdfnative #48](https://github.com/Nizoka/pdfnative/issues/48)); wrapped table cells get unique per-line MCIDs (PDF/UA-safe).
- [x] **Survival directives** — refreshed `SERVER_INSTRUCTIONS`, `llms.txt`, and docs for AI agents.

### v1.2.0 — token-frugal responses, attachment round-trip, watermarks

- [x] **Tool `extract_attachments`** — read-only extraction of embedded files (byte-for-byte), completing the Factur-X / ZUGFeRD round-trip. **14th tool.**
- [x] **Watermarks** — optional `watermark` (text, opacity, angle, colour, position) on `generate_basic_pdf` and `add_table`.
- [x] **Unicode `normalize`** — opt-in `NFC`/`NFD`/`NFKC`/`NFKD` on `generate_basic_pdf` and `add_international_text`.
- [x] **Token-frugal reads** — optional `verbosity: 'summary'` + `fields: […]` on every read-only tool (~90% smaller responses); no base64 duplication in `structuredContent`.
- [x] **MCP registry publish fix** — canonical `io.github.Nizoka/pdfnative-mcp` casing.
- [x] **Dependency** — upgraded to **zod 4**.
- [x] **AGENTS.md** — root agent operations manual (catalogue, decision tree, recipes, error table).

### v1.3.0 — page-tree tools, pdfnative 1.4 features, constant-time signing

- [x] **pdfnative v1.4.0** — dependency bump `^1.3.0` → `^1.4.0` (additive, no breaking changes).
- [x] **Tool `merge_pdfs`** — concatenate 2–50 PDFs into one via pdfnative's page-tree API; rejects encrypted sources. **15th tool.**
- [x] **Tool `split_pdf`** — split one PDF into one document per page range (multi-output `{ count, totalSizeBytes, parts[] }`). **16th tool.**
- [x] **Tool `extract_pages`** — pull an arbitrary page subset into a single PDF. **17th tool.**
- [x] **Bookmarks & page labels** — `generate_basic_pdf` gains `outline` (`'auto'` or explicit tree), `pageLabels`, and nested multi-level `list` items.
- [x] **Viewer preferences** — optional `viewerPreferences` on `generate_basic_pdf`, `add_table`, and `add_international_text`.
- [x] **Table cell borders & alignment** — `add_table` gains `cellBorders` and `cellVAlign`.
- [x] **Constant-time signing** — `sign_pdf` signs RSA and EC-DER keys through a `node:crypto` provider with a transparent pure-JS fallback; signatures stay interoperable.

### v1.4.0 — AI governance + HITL, annotations, pdfnative 1.5

- [x] **pdfnative v1.5.0** — dependency bump `^1.4.0` → `^1.5.0` (additive, no breaking changes).
- [x] **Tool `annotate_pdf`** — overlay markup annotations (highlight, note, underline, strikeout, squiggly, square, circle, line, freetext) on an existing PDF via incremental update. Visual review layer, **not** a redaction. **18th tool.**
- [x] **Tool `draft_governance_issue`** — draft a governance-compliant GitHub issue **locally** (draft `.md` + machine-readable compliance report) for human review; never submits, no outbound network; rejects contract breaches with `GOVERNANCE_VIOLATION`. **19th tool.**
- [x] **AI governance + human-in-the-loop** — the agent is a *draftsman, never an autonomous submitter*; contract files under `.github/` (`ai-governance.json`, `AGENT_RULES.md`), a `verify:issue` CLI gate, and the `docs/guides/AI_GOVERNANCE.md` guide.
- [x] **MCP prompts** — the server advertises the `prompts` capability with `governance_contract` and `draft_issue_workflow`.
- [x] **Page labels in `inspect_pdf`** — read-only surfacing of `/PageLabels` ranges.
- [x] **Math / scientific script** — `add_international_text` accepts the explicit `math` lang (Noto Sans Math), embedded on demand only (no global auto-routing).

### v1.5.0 — charts, forms, encryption round-trip, MCP resources, pdfnative 1.6

- [x] **pdfnative v1.6.0** — dependency bump `^1.5.0` → `^1.6.0` (additive, no breaking changes).
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

_v1.5.0 is the active release. `redact_pdf` stays **deferred** by design (overlay/flatten ≠ content removal)._

---

## Planned

### Blocked upstream

The page-tree tools, the annotation writer, and (in v1.5.0) the encrypted
round-trip, charts and form fill/flatten have all shipped on their respective
pdfnative exports. The remaining items stay **blocked/deferred**: pdfnative does
not yet export a content-*removal* API, and implementing one on raw primitives
would contradict this project's faithful, thin-wrapper philosophy.

- [ ] **Tool `redact_pdf`** — **deferred by design.** pdfnative can overlay annotations and flatten forms, but not *remove* page content; an overlay-only "redaction" would leave the original bytes intact and create false security, which fails this project's honesty bar. Blocked on an upstream true content-removal API (tracked as a `draft_governance_issue` feature request).
- [ ] **`verify_pdf` native ECDSA verify** — replace the local P-256 verifier once pdfnative exports `ecdsaVerifyHash` (still internal-only in 1.6.0).
- [ ] **Per-tool HTTP page-by-page streaming** — once MCP allows partial structuredContent envelopes (pdfnative 1.6 already provides `streamMergedPdfs` / `streamSplitPdf` / `streamExtractPages`).

### Long-Term

- [ ] **OCR ingestion** — accept scanned-image PDFs and produce searchable PDF/A via an external OCR engine (opt-in, sandboxed).
- [ ] **PDF/UA accessibility** — full PDF/UA-1 conformance (Tagged PDF + structure tree validation) with `inspect_pdf` reporting accessibility issues.
- [ ] **Telemetry hook (opt-in, off by default)** — anonymous usage counts via OpenTelemetry for adoption metrics; never includes PDF content.

---

## How to influence the roadmap

- **Feature requests:** [open an issue](https://github.com/Nizoka/pdfnative-mcp/issues/new?template=feature_request.md)
- **Pull requests:** community contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md)
- **Sponsorship:** sponsored features get prioritised — see [funding options](https://github.com/sponsors/Nizoka)
- **Discussion:** weigh in on the [v0.4.0 milestone](https://github.com/Nizoka/pdfnative-mcp/milestones)
