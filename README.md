# pdfnative-mcp

> **Model Context Protocol (MCP) server** that bridges the [pdfnative](https://github.com/Nizoka/pdfnative) library — a zero-dependency, ISO 32000-1 compliant PDF engine — to any MCP-compatible AI client (Claude Desktop, Cursor, Continue, ChatGPT, Zed, …).

[![npm version](https://img.shields.io/npm/v/pdfnative-mcp.svg?logo=npm&color=cb3837)](https://www.npmjs.com/package/pdfnative-mcp)
[![npm downloads](https://img.shields.io/npm/dm/pdfnative-mcp.svg?logo=npm)](https://www.npmjs.com/package/pdfnative-mcp)
[![Node version](https://img.shields.io/node/v/pdfnative-mcp.svg?logo=node.js)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/Nizoka/pdfnative-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Nizoka/pdfnative-mcp/actions/workflows/ci.yml)
[![MCP](https://img.shields.io/badge/MCP-1.x-6f42c1.svg)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

---

## ✨ Features

`pdfnative-mcp` exposes four production-grade tools to any MCP host:

| Tool                       | Purpose                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `generate_basic_pdf`       | Multi-page A4 documents from structured blocks (headings, paragraphs, lists, page breaks). |
| `add_barcode`              | QR Code, Code 128, EAN-13, Data Matrix, PDF417 — embedded in a single-page PDF.            |
| `add_international_text`   | 16 non-Latin scripts (Arabic, Hebrew, Thai, CJK, Devanagari, Bengali, Tamil, …) with BiDi & OpenType shaping. |
| `sign_pdf`                 | PAdES-style CMS digital signatures (RSA-SHA256 / ECDSA-SHA256 P-256).                      |

All tools support two output modes:

- **`base64`** *(default)* — the PDF is returned inline in the MCP response (suitable for pipelines that immediately consume the bytes).
- **`file`** — the PDF is written to a sandboxed directory, configured via the `PDFNATIVE_MPC_OUTPUT_DIR` environment variable. **File output is disabled unless this variable is set**, and all paths are confined to that directory (path traversal, absolute paths, non-`.pdf` extensions and NUL bytes are rejected).

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
        "PDFNATIVE_MPC_OUTPUT_DIR": "/Users/you/Documents/mcp-pdfs"
      }
    }
  }
}
```

### Cursor / Continue / Zed

Any MCP-compatible client that supports stdio servers will work. Use the same `command` + `args` + `env` triple.

### Environment variables

| Variable                      | Purpose                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `PDFNATIVE_MPC_OUTPUT_DIR`    | Absolute path to the sandbox directory. **Required to enable `outputMode: 'file'`.** |

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

Supported `lang` codes: `ar`, `he`, `th`, `ja`, `zh`, `ko`, `el`, `hi`, `bn`, `ta`, `ru`, `ka`, `hy`, `tr`, `vi`, `pl`.

### `sign_pdf`

```jsonc
{
  "pdfBase64": "<base64 PDF that already contains a /Sig placeholder>",
  "algorithm": "rsa-sha256",
  "certDerBase64": "<base64 X.509 cert in DER>",
  "rsaKeyPkcs1DerBase64": "<base64 PKCS#1 RSAPrivateKey DER>",
  "signerName": "Alice",
  "reason": "Approval",
  "location": "Paris, FR",
  "signingTime": "2026-01-15T10:30:00Z"
}
```

For ECDSA P-256: omit `rsaKeyPkcs1DerBase64`, use `algorithm: "ecdsa-sha256"`, and supply `ecPrivateScalarHex` (64 hex chars).

> **Note on placeholder PDFs.** `sign_pdf` is a faithful wrapper around `pdfnative.signPdfBytes`, which expects a PDF that already contains a `/Sig` dictionary with a reserved `/Contents` placeholder. Producing such a PDF is the caller's responsibility (see [pdfnative's signature samples](https://github.com/Nizoka/pdfnative/tree/main/scripts/generators)). A higher-level "create + sign in one shot" tool may be added in a future release.

---

## 🔐 Security model

`pdfnative-mcp` runs **inside the host process** and exposes a stdio MCP server. It does **not** open network sockets and does **not** perform any I/O outside the configured sandbox.

- **File writes** are gated by `PDFNATIVE_MPC_OUTPUT_DIR`. When unset, the `file` output mode is rejected with a `SecurityError`.
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
├── errors.ts                   # ToolError, SecurityError
└── tools/
    ├── generate-basic-pdf.ts
    ├── add-barcode.ts
    ├── sign-pdf.ts
    └── add-international-text.ts
tests/                          # vitest suites
```

---

## 🗺 Roadmap

- [ ] `prepare_signature_placeholder` — high-level helper that builds a PDF already containing the `/Sig` placeholder.
- [ ] `add_table` — structured tabular output exposing pdfnative's `buildPDFBytes`.
- [ ] `add_form` — AcroForm field generation.
- [ ] Streamable HTTP transport (in addition to stdio).
- [ ] Image embedding tool (JPEG / PNG via base64).

Open an issue or PR if you'd like to contribute one of these.

---

## 🤝 Contributing

Contributions are very welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md), check the [open issues](https://github.com/Nizoka/pdfnative-mcp/issues), and follow the [code of conduct](CODE_OF_CONDUCT.md).

---

## 📄 License

[MIT](LICENSE) © 2026 Nizoka

`pdfnative-mcp` is built on top of [`pdfnative`](https://github.com/Nizoka/pdfnative) and the [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).
