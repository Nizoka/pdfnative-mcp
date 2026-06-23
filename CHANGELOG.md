# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-06-23

A minor, backward-compatible release that makes the four read-only tools token-frugal
for AI agents (typically ~90% fewer output tokens on large results) and fixes the MCP
registry publish block caused by `mcpName` casing. Default tool calls return responses
identical to v1.1.0 — the new behaviour is fully opt-in.

### Added

- **Token-frugal reads:** `inspect_pdf`, `verify_pdf`, `validate_pdf`, and `extract_text` gain an optional `verbosity` input (`'summary'` | `'full'`, default `'full'`). `'summary'` returns a canonical scalar subset — e.g. `verify_pdf` → `{ signatureCount, allValid, invalid, summary }`, `extract_text` → `{ pageCount, extractedPageCount, extractable, charCount }` — dropping the heavy arrays / full text.
- **Field projection:** the same four tools gain an optional `fields` input — a dot-path projection (e.g. `['allValid']`, `['signatures.valid']`) applied after `verbosity`; unknown paths are omitted leniently. Backed by a new dependency-free `src/projection.ts` module.

### Changed

- **MCP registry ID:** `mcpName` (`package.json`) and `name` (`server.json`) → `io.github.Nizoka/pdfnative-mcp` (canonical GitHub login casing). The npm package name stays lowercase `pdfnative-mcp`.
- **MCP `_meta.apiVersion`** bumped `1.1.0` → `1.2.0` on every tool; `SERVER_VERSION` and `server.json` versions → `1.2.0`.
- **Base64 delivery:** base64-mode PDF-producing tools no longer duplicate the PDF into `structuredContent.base64`; the bytes are delivered once via the embedded `resource` content block. `structuredContent` for base64 mode is now `{ mode, sizeBytes }`. File mode is unchanged.
- **Docs:** README, `docs/AI_GUIDE.md`, `docs/API_STABILITY.md`, `docs/KNOWLEDGE_BASE.md`, and `llms.txt` refreshed for the v1.2.0 surface.

### Fixed

- **MCP registry publication** failed because validation compares `mcpName` to the GitHub namespace with case-sensitive equality (`Nizoka`), while the published metadata used lowercase `nizoka`. Corrected to `io.github.Nizoka/pdfnative-mcp`.

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

[Unreleased]: https://github.com/Nizoka/pdfnative-mcp/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/Nizoka/pdfnative-mcp/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Nizoka/pdfnative-mcp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Nizoka/pdfnative-mcp/compare/v0.3.0...v1.0.0
[0.3.0]: https://github.com/Nizoka/pdfnative-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Nizoka/pdfnative-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Nizoka/pdfnative-mcp/releases/tag/v0.1.0


