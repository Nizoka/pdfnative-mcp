# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Nizoka/pdfnative-mcp/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Nizoka/pdfnative-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Nizoka/pdfnative-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Nizoka/pdfnative-mcp/releases/tag/v0.1.0


