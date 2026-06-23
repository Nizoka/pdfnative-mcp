# pdfnative-mcp

> **Model Context Protocol (MCP) server** that bridges the [pdfnative](https://github.com/Nizoka/pdfnative) library — a zero-dependency, ISO 32000-1 compliant PDF engine — to any MCP-compatible AI client (Claude Desktop, Cursor, Continue, ChatGPT, Zed, …).

[![npm version](https://img.shields.io/npm/v/pdfnative-mcp.svg?logo=npm&color=cb3837)](https://www.npmjs.com/package/pdfnative-mcp)
[![npm downloads](https://img.shields.io/npm/dm/pdfnative-mcp.svg?logo=npm)](https://www.npmjs.com/package/pdfnative-mcp)
[![Node version](https://img.shields.io/node/v/pdfnative-mcp.svg?logo=node.js)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/Nizoka/pdfnative-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Nizoka/pdfnative-mcp/actions/workflows/ci.yml)
[![MCP](https://img.shields.io/badge/MCP-1.x-6f42c1.svg)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Nizoka/pdfnative-mcp/badge)](https://scorecard.dev/viewer/?uri=github.com/Nizoka/pdfnative-mcp)
[![CodeQL](https://github.com/Nizoka/pdfnative-mcp/actions/workflows/codeql.yml/badge.svg)](https://github.com/Nizoka/pdfnative-mcp/actions/workflows/codeql.yml)

---

## ✨ Features

`pdfnative-mcp` exposes **13 production-grade tools** to any MCP host:

| Tool                               | Purpose                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `generate_basic_pdf`               | Multi-page A4 documents from structured blocks (headings, paragraphs, lists, page breaks). Embedded newlines auto-split into paragraphs. Optional `pdfA`. |
| `add_barcode`                      | QR Code, Code 128, EAN-13, Data Matrix, PDF417 — embedded in a single-page PDF.                 |
| `add_international_text`           | 24 scripts (incl. **Latin** & COLRv1 **colour emoji**) with BiDi & OpenType shaping; multi-lang per document. |
| `add_table`                        | Tabular reports with smart fields (wrap, repeatHeader, zebra, caption, minRowHeight, cellPadding). |
| `add_form`                         | Interactive AcroForm PDFs with text fields, checkboxes, radio buttons, dropdowns.                |
| `embed_image`                      | Embed a JPEG or PNG image (base64) into a titled PDF document.                                  |
| `prepare_signature_placeholder`    | Step 1 of the two-step sign workflow — create a PDF with a `/Sig` AcroForm placeholder.        |
| `sign_pdf`                         | Apply a PAdES-compatible CMS signature (RSA-SHA256 / ECDSA-SHA256 P-256). Auto-injects a placeholder when needed. |
| `verify_pdf`                       | Verify every PAdES signature in a PDF (integrity + signature value + optional chain trust).      |
| `validate_pdf` *(new in v1.1.0)*   | Validate a Tagged PDF for PDF/UA (ISO 14289-1) structural conformance (read-only).              |
| `add_attachment`                   | Generate a PDF/A-3 document with embedded files (Factur-X / ZUGFeRD invoices).                  |
| `extract_text`                     | Best-effort plain-text extraction from a non-encrypted PDF.                                     |
| `inspect_pdf`                      | Read-only inspection: PDF version, page count, encryption, PDF/A claim, signatures, attachments, placeholder state. |

**New in v1.2.0:**

- 🪙 **Token-frugal reads** — the read-only tools (`inspect_pdf`, `verify_pdf`, `validate_pdf`, `extract_text`) accept optional `verbosity: 'summary'` and `fields: […]` inputs for ~90% smaller responses on large results, with no loss of the fields agents branch on. Defaults are unchanged.
- 🪙 **No base64 duplication** — generated PDFs (base64 mode) are returned **once** as an embedded `resource` content block instead of also being copied into `structuredContent`.
- 🔧 **MCP registry publish fix** — `mcpName` now uses the canonical GitHub login casing (`io.github.Nizoka/pdfnative-mcp`) so the registry's case-sensitive validation accepts the npm package.

**New in v1.1.0:**

- 🆕 **Tool `validate_pdf`** — read-only PDF/UA (ISO 14289-1) structural conformance check.
- 🆕 **Six new scripts** — Telugu, Sinhala, Tibetan, Khmer, Myanmar, Ethiopic (**24 scripts** total).
- 🆕 **COLRv1 colour emoji** — native colour emoji with monochrome fallback.
- 🆕 **Newline sanitizer** — embedded `\n` in paragraphs auto-splits into separate paragraphs (Safe PDF/A).
- 🆕 **Automatic NFC normalisation** for `add_international_text`.
- 🛠 **Engine upgrade** — [pdfnative v1.3.0](https://github.com/Nizoka/pdfnative): the Euro sign / CP-1252 symbols now extract correctly, and wrapped table cells get unique per-line MCIDs (PDF/UA-safe).

**New in v1.0.0:**

- 🆕 **Three new tools:** `verify_pdf`, `add_attachment` (Factur-X / ZUGFeRD), `extract_text`.
- 🆕 **Smart-table fields:** `wrap`, `repeatHeader`, `zebra`, `caption`, `minRowHeight`, `cellPadding`.
- 🆕 **`inspect_pdf`** now reports `hasSignaturePlaceholder` and per-attachment summary; new `check` values `'placeholder'` and `'attachments'`.
- 🆕 **Signing ergonomics:** `sign_pdf` accepts ECDSA SEC1 / PKCS#8 DER keys and auto-injects a `/Sig` placeholder when missing (one-call signing of any PDF).
- 🆕 **Opt-in cache** (`PDFNATIVE_MCP_CACHE_DIR`): SHA-256 keyed, 1 h TTL, 256 MiB LRU.
- 🆕 **`_meta.apiVersion`** and per-tool **`_meta.examples`** for AI-agent discovery — see [`docs/API_STABILITY.md`](docs/API_STABILITY.md).
- 🆕 **AI agent guide:** [`docs/AI_GUIDE.md`](docs/AI_GUIDE.md) — decision tree + common pitfalls.
- 🆕 **PDF/A authoring guide:** [`docs/guides/PDFA.md`](docs/guides/PDFA.md).
- 🛠 **Env-var rename:** `PDFNATIVE_MCP_OUTPUT_DIR` (was `PDFNATIVE_MPC_OUTPUT_DIR`; old name still works with a one-shot deprecation warning).
- ⏭ **Deferred to v1.1:** `merge_pdfs`, `split_pdf`, `redact_pdf` (require pdfnative page-tree primitives not yet exported).

All tools support two output modes:

- **`base64`** *(default)* — the generated PDF is returned **once** as an embedded `resource` content block (a `data:application/pdf;base64,…` URI); `structuredContent` carries only `{ mode, sizeBytes }`.
- **`file`** — the PDF is written to a sandboxed directory configured via `PDFNATIVE_MCP_OUTPUT_DIR`. File output is disabled unless this variable is set; absolute paths, path traversal, non-`.pdf` extensions, and NUL bytes are all rejected.

**Token-frugal reads (v1.2.0).** The four read-only tools accept two optional inputs:

- `verbosity: 'summary'` — returns a compact scalar-only verdict (drops the heavy arrays / full text). E.g. `verify_pdf` → `{ signatureCount, allValid, invalid, summary }`.
- `fields: ['a', 'b.c']` — projects the structured result to named dot-paths; composes after `verbosity`. Unknown paths are omitted leniently.

Smallest “is this PDF signed and valid?” probe: `{ "pdfBase64": "…", "verbosity": "summary", "fields": ["allValid"] }`.

### Why pdfnative?

`pdfnative-mcp` inherits every guarantee of the underlying engine:

- **Zero runtime dependencies** — pure JavaScript, no native bindings.
- **ISO 32000-1 (PDF 1.7)** compliant output.
- **PDF/A-1b/2b/3b**, **AES-128/256 encryption**, **AcroForm**, **digital signatures**.
- **16 Unicode scripts** with built-in BiDi reordering, Arabic positional shaping, Thai/Devanagari/Bengali/Tamil OpenType shaping.
- Tree-shakeable ESM build.

---

## 🚀 Installation

```bash
# Run directly with npx (recommended for MCP clients)
npx -y pdfnative-mcp

# Or install globally
npm install -g pdfnative-mcp
pdfnative-mcp
```

Requirements: **Node.js ≥ 22**.

---

## ⚙️ Configuration

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "pdfnative": {
      "command": "npx",
      "args": ["-y", "pdfnative-mcp"],
      "env": {
        "PDFNATIVE_MCP_OUTPUT_DIR": "/Users/you/Documents/mcp-pdfs"
      }
    }
  }
}
```

### Cursor / Continue / Zed / Windsurf / Cline / Roo Code

Any MCP-compatible client that supports stdio servers will work. Use the same `command` + `args` + `env` triple. Example for **Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "pdfnative": {
      "command": "npx",
      "args": ["-y", "pdfnative-mcp"],
      "env": { "PDFNATIVE_MCP_OUTPUT_DIR": "/Users/you/Documents/mcp-pdfs" }
    }
  }
}
```

**Windsurf / Cline / Roo Code** use the same shape inside their respective MCP config files.

### Environment variables

| Variable                      | Purpose                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `PDFNATIVE_MCP_OUTPUT_DIR`    | Absolute path to the sandbox directory. **Required to enable `outputMode: 'file'`.** |
| `PDFNATIVE_MCP_CACHE_DIR`     | Absolute path to enable the persistent SHA-256-keyed result cache (1 h TTL, 256 MiB LRU). When unset, the cache is disabled. |
| `PDFNATIVE_MCP_PORT`          | When set to a valid port (1–65535), starts an HTTP server on `http://127.0.0.1:<port>/mcp` instead of stdio. |

---

## 🛠 Tool reference

### `generate_basic_pdf`

```jsonc
{
  "title": "Q1 2026 Report",
  "blocks": [
    { "type": "heading", "text": "Executive summary", "level": 1 },
    { "type": "paragraph", "text": "Revenue grew 24% year over year." },
    { "type": "list", "style": "bullet", "items": ["Strong APAC", "Stable EU", "Soft NA"] },
    { "type": "pageBreak" },
    { "type": "heading", "text": "Details", "level": 2 }
  ],
  "footerText": "Confidential — Internal use only",
  "outputMode": "base64"
}
```

### `add_barcode`

```jsonc
{
  "format": "qr",
  "data": "https://pdfnative.dev",
  "caption": "Scan to learn more",
  "ecLevel": "H",
  "outputMode": "file",
  "outputPath": "tickets/event-42.pdf"
}
```

Supported formats: `qr`, `code128`, `ean13`, `datamatrix`, `pdf417`.

### `add_international_text`

```jsonc
{
  "title": "مرحبا بالعالم",
  "lang": "ar",
  "paragraphs": [
    "هذا اختبار للنص العربي مع تشكيل OpenType ومحارف ثنائية الاتجاه.",
    "Mixed content: العربية + English ✓"
  ]
}
```

Supported `lang` codes: `ar`, `he`, `th`, `ja`, `zh`, `ko`, `el`, `hi`, `bn`, `ta`, `ru`, `ka`, `hy`, `tr`, `vi`, `pl`, `latin`, `emoji`.

Multi-script documents — pass an array or comma-separated list:

```jsonc
{
  "title": "Mixed Script",
  "lang": ["ar", "emoji"],
  "paragraphs": ["العربية مع رموز 🎉🚀"],
  "pdfA": "pdfa2u"
}
```

### `sign_pdf`

As of v1.0.0, `sign_pdf` auto-injects a `/Sig` placeholder when missing — you can sign **any** PDF in one call:

```jsonc
{
  "pdfBase64": "<any base64 PDF>",
  "algorithm": "rsa-sha256",
  "certDerBase64": "<base64 X.509 cert in DER>",
  "rsaKeyPkcs1DerBase64": "<base64 PKCS#1 RSAPrivateKey DER>",
  "signerName": "Alice",
  "reason": "Approval",
  "location": "Paris, FR",
  "signingTime": "2026-01-15T10:30:00Z"
}
```

For ECDSA P-256: use `algorithm: "ecdsa-sha256"` and supply either `ecPrivateKeyDerBase64` (SEC1 or PKCS#8 DER) or `ecPrivateScalarHex` (64 hex chars).

PEM → DER conversion:

```bash
openssl x509 -in cert.pem -outform DER | base64 -w0                 # cert
openssl rsa  -in key.pem  -outform DER -traditional | base64 -w0    # RSA PKCS#1
openssl pkey -in key.pem  -outform DER | base64 -w0                 # ECDSA
```

> Use `prepare_signature_placeholder` only when you need to customize the placeholder (e.g. larger `placeholderBytes` for >4096-bit RSA keys). Otherwise call `sign_pdf` directly.

---

### `add_table`

```jsonc
{
  "title": "Monthly Sales",
  "headers": ["Region", "Units", "Revenue"],
  "rows": [
    ["APAC", "1200", "$240,000"],
    ["EMEA", "800", "$160,000"]
  ],
  "infoItems": [{ "label": "Period", "value": "January 2025" }],
  "footerText": "Internal use only",
  "outputMode": "base64"
}
```

### `add_form`

```jsonc
{
  "title": "Employee Onboarding",
  "fields": [
    { "fieldType": "text", "name": "fullName", "label": "Full Name", "required": true },
    { "fieldType": "dropdown", "name": "dept", "label": "Department", "options": ["Engineering", "Sales", "HR"] },
    { "fieldType": "checkbox", "name": "agree", "label": "I agree to the terms", "checked": false }
  ],
  "outputMode": "base64"
}
```

### `embed_image`

```jsonc
{
  "title": "Product Photo",
  "imageBase64": "<base64-encoded JPEG bytes>",
  "mimeType": "image/jpeg",
  "caption": "Front view of Model X",
  "width": 400,
  "outputMode": "base64"
}
```

> **Note:** pdfnative does not support alpha-channel PNGs (color type 6). Pre-process such images to remove the alpha channel before embedding.

### `prepare_signature_placeholder`

```jsonc
{
  "title": "Service Agreement",
  "signerName": "Alice Dupont",
  "reason": "Approved",
  "location": "Paris, FR",
  "blocks": [
    { "type": "paragraph", "text": "By signing below, I accept the terms and conditions." }
  ],
  "outputMode": "base64"
}
```

Pass the returned PDF bytes to `sign_pdf` to complete the signing workflow.

### `inspect_pdf`

Read-only structural and security inspection — useful for downstream verification, CI assertions, and AI agents that need to reason about a PDF before acting on it.

```jsonc
{
  "pdfBase64": "<base64 PDF>",
  "pages": true,
  "check": ["pdfa", "signed", "attachments"]
}
```

Returns:

```jsonc
{
  "version": "1.7",
  "pageCount": 3,
  "encryption": "none",          // 'none' | 'aes-128' | 'aes-256' | 'rc4' | 'unknown'
  "pdfA": "3B",                  // null when no PDF/A claim is present
  "signatureCount": 1,
  "hasSignaturePlaceholder": false,
  "attachments": [{ "filename": "factur-x.xml", "mimeType": "application/xml", "sizeBytes": 1234, "relationship": "Source" }],
  "info": { "Producer": "pdfnative", "Title": "Invoice INV-2025-001" },
  "perPage": [{ "index": 0, "width": 595, "height": 842 }],
  "checks": { "pdfa": true, "signed": true, "attachments": true },
  "checksPassed": true
}
```

`check[]` accepts any of `'pdfa'`, `'signed'`, `'encrypted'`, `'placeholder'`, `'attachments'`. `checksPassed` is the AND of all requested checks.

### `validate_pdf`

Read-only **PDF/UA (ISO 14289-1)** structural conformance check for a Tagged PDF. Generate an accessible document with any tool using `pdfA` (e.g. `pdfA: 'pdfa2u'`), then validate the result:

```jsonc
{ "pdfBase64": "<tagged-pdf-base64>" }
```

Returns:

```jsonc
{
  "standard": "pdf-ua-1",
  "valid": true,
  "errors": [],          // blocking structural violations (empty when valid)
  "warnings": [],        // non-blocking best-practice recommendations
  "summary": "PDF/UA structural prerequisites hold."
}
```

It verifies catalog `/MarkInfo /Marked true`, `/StructTreeRoot` (+ `/ParentTree`), `/Metadata` (XMP), `/Lang`, and per-page MCID uniqueness. This is a fast developer-time gate — **not** a substitute for a full reference validator (veraPDF), which additionally checks fonts, colour, and rendering.

### `verify_pdf`, `add_attachment`, `extract_text`

See the dedicated sections in [`docs/AI_GUIDE.md`](docs/AI_GUIDE.md) and the reference in [`docs/KNOWLEDGE_BASE.md`](docs/KNOWLEDGE_BASE.md). Ready-to-run examples live under [`examples/`](examples/).

---

## 🔐 Security model

`pdfnative-mcp` runs **inside the host process** and exposes a stdio MCP server. It does **not** open network sockets and does **not** perform any I/O outside the configured sandbox.

- **File writes** are gated by `PDFNATIVE_MCP_OUTPUT_DIR`. When unset, the `file` output mode is rejected with a `SecurityError`.
- **Path resolution** rejects absolute paths, traversal sequences (`..`), NUL bytes, and any extension other than `.pdf`.
- **Output size** is capped at 50 MB per call.
- **Inputs** are validated against strict JSON Schemas + Zod runtime checks at the boundary of every tool.

See [SECURITY.md](SECURITY.md) for the responsible disclosure process.

---

## 🧪 Local development

```bash
git clone https://github.com/Nizoka/pdfnative-mcp.git
cd pdfnative-mcp
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

Smoke-test the server over stdio:

```bash
node dist/cli.js
# In another terminal, send a JSON-RPC initialize request via stdin (e.g. with mcp-inspector).
```

## 📣 Release process

`pdfnative-mcp` follows the same release formalism as `pdfnative`:

- One release note file per tag in `release-notes/vX.Y.Z.md`
- `CHANGELOG.md` mirrors each release bullet list
- GitHub Release body is copied from `release-notes/vX.Y.Z.md`
- npm publication is handled by GitHub Actions Trusted Publishing (OIDC), without `NPM_TOKEN`

See `release-notes/TEMPLATE.md` for the canonical structure and publication checklist.

---

## 📚 Project structure

```
src/
├── cli.ts                      # stdio entrypoint (#!/usr/bin/env node)
├── index.ts                    # public library exports
├── server.ts                   # McpServer factory + tool registry
├── output.ts                   # sandboxed file writer / base64 emitter
├── text.ts                     # newline sanitizer (Safe PDF/A)
├── errors.ts                   # ToolError, SecurityError
└── tools/
    ├── generate-basic-pdf.ts
    ├── add-barcode.ts
    ├── sign-pdf.ts
    ├── add-international-text.ts
    ├── add-table.ts
    ├── add-form.ts
    ├── embed-image.ts
    ├── inspect-pdf.ts
    ├── verify-pdf.ts
    ├── validate-pdf.ts
    ├── add-attachment.ts
    ├── extract-text.ts
    └── prepare-signature-placeholder.ts
tests/                          # vitest suites
```

---

## 🗺 Roadmap

v1.1.0 is shipped. The full plan — released milestones, in-progress work, and long-term direction — lives in [ROADMAP.md](ROADMAP.md).

**Blocked upstream (page-tree manipulation):**

- `merge_pdfs`, `split_pdf`, `redact_pdf` — pdfnative does not yet export the page-tree manipulation primitives required to build these safely. They remain on the roadmap, blocked on an upstream API.

Have a feature idea? Open an issue or PR.

---

## ⭐ Star the project

If `pdfnative-mcp` is useful to you, please ⭐ this repository — and consider also starring the underlying engine [Nizoka/pdfnative](https://github.com/Nizoka/pdfnative). Stars help others discover the project and motivate continued development.

---

## 🤝 Contributing

Contributions are very welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md), check the [open issues](https://github.com/Nizoka/pdfnative-mcp/issues), and follow the [code of conduct](CODE_OF_CONDUCT.md).

---

## 📄 License

[MIT](LICENSE) © 2026 Nizoka

`pdfnative-mcp` is built on top of [`pdfnative`](https://github.com/Nizoka/pdfnative) and the [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).


