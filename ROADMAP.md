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

---

## In Progress

_v1.0.0 is the active release. The v1.1 milestone re-opens the three explicitly deferred page-tree tools._

---

## Planned

### v1.1.0 — Page-tree manipulation

- [ ] **Tool `merge_pdfs`** — concatenate 2–50 PDFs, optionally drop signatures; blocked on pdfnative page-tree export.
- [ ] **Tool `split_pdf`** — extract page ranges into individual PDFs.
- [ ] **Tool `redact_pdf`** — overlay-mode (annotation rectangles + replacement text) in v1.1; content-stream redaction tracked for v1.2 once pdfnative exposes content-stream rewriting.
- [ ] **Encrypted-PDF round-trip fixtures** — once pdfnative exposes a Standard Security Handler writer.
- [ ] **Per-tool HTTP page-by-page streaming** — once MCP allows partial structuredContent envelopes.

### Long-Term

- [ ] **OCR ingestion** — accept scanned-image PDFs and produce searchable PDF/A via an external OCR engine (opt-in, sandboxed).
- [ ] **PDF/UA accessibility** — full PDF/UA-1 conformance (Tagged PDF + structure tree validation) with `inspect_pdf` reporting accessibility issues.
- [ ] **Native MCP resources** — expose generated PDFs as MCP `resource` URIs so AI clients can re-reference them across calls.
- [ ] **Tool discovery hints** — per-tool `examples[]` so AI clients can prime themselves with high-quality call patterns.
- [ ] **Telemetry hook (opt-in, off by default)** — anonymous usage counts via OpenTelemetry for adoption metrics; never includes PDF content.

---

## How to influence the roadmap

- **Feature requests:** [open an issue](https://github.com/Nizoka/pdfnative-mcp/issues/new?template=feature_request.md)
- **Pull requests:** community contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md)
- **Sponsorship:** sponsored features get prioritised — see [funding options](https://github.com/sponsors/Nizoka)
- **Discussion:** weigh in on the [v0.4.0 milestone](https://github.com/Nizoka/pdfnative-mcp/milestones)
