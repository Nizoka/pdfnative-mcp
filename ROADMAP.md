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

---

## In Progress

_All v0.3.0 items have been merged into the [v0.3.0 release](release-notes/v0.3.0.md). Next iteration is v0.4.0 — see Planned below._

---

## Planned

### v0.4.0 — Verification & signing ergonomics

- [ ] **Tool `verify_pdf`** — verify CMS digital signatures end-to-end: certificate-chain validation, ByteRange hash check, tampering detection. Blocked on a high-level CMS verify primitive in pdfnative; manual implementation tracked.
- [ ] **`sign_pdf` placeholder auto-injection** — auto-detect PDFs without an AcroForm `/Sig` field and inject a placeholder via incremental update so clients can sign any PDF in a single call.
- [ ] **ECDSA DER private-key input** — accept SEC1 / PKCS#8 DER (base64) in addition to the raw 32-byte scalar (`ecPrivateScalarHex`).
- [ ] **Encrypted-PDF fixtures** — round-trip an AES-128 / AES-256 / RC4 fixture so `inspect_pdf`'s encryption-detection branches are exercised by the unit suite.
- [ ] **Signature appearance streams** — optional visible signature widget (signer name + date drawn into the page).

### v0.5.0 — Document inspection & redaction

- [ ] **Tool `extract_text`** — text extraction with per-page text and reading order, leveraging pdfnative's parser.
- [ ] **Tool `redact_pdf`** — true content-stream redaction (not annotation overlays) for sensitive content.
- [ ] **Tool `merge_pdfs` / `split_pdf`** — page-range merge & split via incremental updates, preserving signatures where possible.
- [ ] **Tool `add_attachment`** — embed file attachments (PDF/A-3 conformant) for invoices, ZUGFeRD / Factur-X.

### v0.6.0 — Performance & scale

- [ ] **Streaming HTTP responses** — chunked PDF emission via `buildDocumentPDFStream()` so large documents don't materialise fully in memory.
- [ ] **Web Worker offload** — opt-in worker pool for parallel generation when multiple tool calls arrive concurrently.
- [ ] **Optional response caching** — content-addressed cache (SHA-256 of canonicalised input) with TTL + size cap, opt-in via env var.

### v1.0.0 — Production-ready milestone

- [ ] **API stability commitment** — semver guarantees on every tool's input / output schema.
- [ ] **Tool versioning** — per-tool `apiVersion` so deprecations land non-breaking.
- [ ] **Conformance test suite** — published JSON-RPC fixture set for downstream MCP clients and AI-eval harnesses.
- [ ] **OpenSSF Best Practices** — passing badge.
- [ ] **CodeQL + Scorecards** — workflows green on `main`.

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
