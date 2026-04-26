# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Nizoka/pdfnative-mcp/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Nizoka/pdfnative-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Nizoka/pdfnative-mcp/releases/tag/v0.1.0


