# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Nizoka/pdfnative-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Nizoka/pdfnative-mcp/releases/tag/v0.1.0
