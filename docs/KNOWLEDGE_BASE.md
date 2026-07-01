# pdfnative-mcp — Knowledge Base

> Reference for AI assistants (GitHub Copilot, Claude, Cursor, Continue, Zed, Windsurf, Cline, Roo Code)
> and human contributors. Captures the full context needed to understand, extend, and debug
> pdfnative-mcp **v1.3.0** without reading every source file.

> If you are an AI agent calling pdfnative-mcp from a chat session, also read
> [`AI_GUIDE.md`](AI_GUIDE.md) — the short, action-oriented decision tree.

---

## 1. Context

**What is pdfnative-mcp?**
An MCP (Model Context Protocol) server that bridges the zero-dependency
[`pdfnative`](https://github.com/Nizoka/pdfnative) library (v1.4.x) to AI clients
(Claude Desktop, ChatGPT, Cursor, Continue, Zed, Windsurf, Cline, Roo Code, …).
It exposes **17** PDF tools over a stdio transport so AI agents can generate, sign,
verify, validate, attach, inspect, extract, merge, split and carve PDF files.

**Philosophy:**
- `pdfnative` is the only runtime dependency — all PDF logic lives there.
- The MCP server is a thin, secure dispatch layer: validate inputs with Zod → call pdfnative → emit PDF as base64 or to a sandboxed file.
- Every tool is fully self-contained (its own file in [src/tools/](../src/tools)).
- Security at every boundary: Zod validation on all inputs, path traversal prevention on file output, no key-material echo in logs or errors.
- Every tool ships `_meta.apiVersion = '1.3.0'` and worked-example `_meta.examples` so AI clients can introspect supported behavior — see [`API_STABILITY.md`](API_STABILITY.md).

**Runtime:** Node.js ≥ 22 (ESM, strict TypeScript). Transport: stdio.

**Repositories**
- MCP server: <https://github.com/Nizoka/pdfnative-mcp>
- Core library: <https://github.com/Nizoka/pdfnative>
- CLI companion: <https://github.com/Nizoka/pdfnative-cli>
- npm: <https://www.npmjs.com/package/pdfnative-mcp>

---

## 2. Architecture

```
src/
├── cli.ts            # Entry point: stdio transport, signal handling, lazy init
├── server.ts         # createServer(): MCP tool registry + request handlers
├── output.ts         # outputMode logic: base64 inline vs sandboxed file write (single + multi)
├── cache.ts          # In-process LRU cache for idempotent tool results
├── text.ts           # newline sanitizer (Safe PDF/A)
├── watermark.ts      # shared text-watermark schema + WatermarkOptions mapping
├── normalize.ts      # shared Unicode-normalization schema
├── doc-features.ts   # shared schemas/mappers: nested lists, outline, page labels, viewer prefs
├── pagetree.ts       # shared page-tree error mapping (merge/split/extract)
├── crypto-provider.ts# node:crypto constant-time signature provider
├── errors.ts         # ToolError + SecurityError
└── tools/
    ├── generate-basic-pdf.ts          # generate_basic_pdf
    ├── add-barcode.ts                 # add_barcode
    ├── add-international-text.ts      # add_international_text
    ├── add-table.ts                   # add_table
    ├── add-form.ts                    # add_form
    ├── embed-image.ts                 # embed_image
    ├── prepare-signature-placeholder.ts  # prepare_signature_placeholder
    ├── sign-pdf.ts                    # sign_pdf
    ├── verify-pdf.ts                  # verify_pdf
    ├── validate-pdf.ts                # validate_pdf (PDF/UA)
    ├── inspect-pdf.ts                 # inspect_pdf
    ├── add-attachment.ts              # add_attachment (PDF/A-3 / Factur-X)
    ├── extract-attachments.ts         # extract_attachments (read-only)
    ├── extract-text.ts                # extract_text
    ├── merge-pdfs.ts                  # merge_pdfs (page-tree)
    ├── split-pdf.ts                   # split_pdf (page-tree, multi-output)
    └── extract-pages.ts               # extract_pages (page-tree)
```

### Request Dispatch Flow

```
AI client (Claude / Cursor / Copilot / etc.)
    │  MCP JSON-RPC over stdio
    ▼
src/cli.ts
  initCrypto() + initNodeCompression() ← awaited lazily, once
  createServer()                       ← builds the MCP Server instance
  connect(StdioServerTransport)
    │
    ▼
src/server.ts  (createServer)
  ListToolsRequest  → TOOLS registry → JSON schemas + _meta (apiVersion + examples)
  CallToolRequest   → TOOL_INDEX.get(name) → handler(args)
    │
    ▼
src/tools/<tool>.ts
  Zod.parse(args)                   ← throws ToolError('VALIDATION_ERROR') on bad input
  (cache lookup via src/cache.ts for read-only / idempotent tools)
  call pdfnative API
  emitPdf(bytes, { mode, outputPath })  ← src/output.ts
    │
    ├── mode='base64' → PDF returned once as an embedded `resource` content block (data: URI); structuredContent = { mode, sizeBytes }
    └── mode='file'   → write to sandboxed path → return filePath + sizeBytes
```

Read-only tools (`inspect_pdf`, `verify_pdf`, `validate_pdf`, `extract_text`, `extract_attachments`) additionally
apply an opt-in projection layer (`src/projection.ts`) before emitting `structuredContent`:
`verbosity: 'summary'` swaps the full result for a compact scalar subset, then
`fields: ['a','b.c']` projects to named dot-paths. Defaults (`'full'`, no `fields`) are
unchanged.

---

## 3. Tool Registry ([src/server.ts](../src/server.ts))

Each tool is registered in the `TOOLS: readonly ToolDefinition[]` array with:

```typescript
interface ToolDefinition {
    name: string;
    title: string;
    description: string;
    inputSchema: unknown;             // JSON Schema for ListTools response
    outputSchema?: unknown;           // JSON Schema for the tool result
    annotations?: {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
        openWorldHint?: boolean;
    };
    examples?: ReadonlyArray<{ title: string; input: Record<string, unknown> }>;
    handler: (args: unknown) => Promise<OutputResult | MultiOutputResult | InspectPdfResult | VerifyPdfResult | ExtractTextResult | ValidatePdfResult | ExtractAttachmentsResult>;
}
```

A `TOOL_INDEX: ReadonlyMap<string, ToolDefinition>` is derived from the array for O(1) lookup on `CallToolRequest`.

**`_meta` per tool** — emitted in the `ListTools` response so AI clients can introspect:
- `_meta.apiVersion` = `'1.3.0'` (see [`API_STABILITY.md`](API_STABILITY.md) for the bump policy)
- `_meta.examples`   = at least one worked example per tool

**Server metadata:**
- `SERVER_NAME = 'pdfnative-mcp'`
- `SERVER_VERSION = '1.3.0'`
- `serverInfo._meta.mcpName = 'io.github.Nizoka/pdfnative-mcp'` (registry ID in `package.json` `mcpName` / `server.json` `name`; uses the canonical GitHub login casing `Nizoka` so the MCP registry's case-sensitive validation accepts the lowercase npm package `pdfnative-mcp`)
- `SERVER_INSTRUCTIONS` — high-level decision tree + common-pitfall guide returned to the client in `serverInfo.instructions`

**Boot:** `initCrypto()` and `initNodeCompression()` are awaited lazily on the first request so the cold start is not paid up-front.

---

## 4. Tools — Full Reference

### `generate_basic_pdf`

**Purpose:** Multi-page A4 document from structured content blocks. Default tool for plain documents.

**Block types (`blocks[]`):**

```jsonc
{ "type": "heading",    "text": "...",  "level": 1 }       // level: 1 | 2 | 3
{ "type": "paragraph",  "text": "..." }
{ "type": "list",       "items": ["..."],  "style": "bullet" | "numbered" }
{ "type": "pageBreak" }
{ "type": "spacer",     "height": 12 }                      // points, 1–500
{ "type": "image",      "imageBase64": "...", "mimeType": "image/jpeg" | "image/png" }
{ "type": "table",      "headers": ["..."], "rows": [["..."]] }
{ "type": "formField",  "fieldType": "text" | "textarea" | "checkbox" | "radio" | "dropdown",
                         "name": "field1", "label": "...", "options": ["..."] }
```

Optional `pdfA: 'pdfa1b' | 'pdfa2b' | 'pdfa2u' | 'pdfa3b'` produces an archival document.
Optional `watermark: { text, fontSize?, opacity?, angle?, color?, position? }` renders a text watermark on every page (`color` is an `[r,g,b]` 0–1 triple; `opacity < 1.0` is rejected under `pdfa1b`). Optional `normalize: 'NFC'|'NFD'|'NFKC'|'NFKD'` applies Unicode normalization (omit for byte-stable output).

**Document features (v1.3.0, threaded from pdfnative v1.4.0):**
- `list` blocks accept nested `items` (a string, or `{ text, items?, style? }` up to 6 levels deep) for multi-level bullet/numbered lists.
- `outline: 'auto' | OutlineNode[]` adds PDF bookmarks. `'auto'` derives the outline from headings; an explicit tree is `[{ title, pageIndex, children?, open? }]` (max depth 6).
- `pageLabels: [{ startPage, style?, prefix?, start? }]` sets viewer page numbering (e.g. roman front-matter then decimal body).
- `viewerPreferences: { pageMode?, pageLayout?, hideToolbar?, hideMenubar?, fitWindow?, displayDocTitle?, … }` maps to the catalog `/ViewerPreferences` + `/PageMode`/`/PageLayout` (e.g. `pageMode: 'useOutlines'` opens the bookmark pane).

For Factur-X / ZUGFeRD invoices use [`add_attachment`](#add_attachment) instead — `generate_basic_pdf` cannot embed files.

> **Newline sanitizer (Safe PDF/A):** a `paragraph` whose `text` contains `\n` / `\r\n` / `\r` is automatically split into separate paragraph blocks (`src/text.ts`). Write multi-line text naturally — never emit a literal newline expecting a soft line break; doing so previously produced `.notdef` tofu in PDF/A. Whitespace-only paragraphs are rejected with `VALIDATION_ERROR`.

---

### `add_barcode`

**Purpose:** Single-page PDF with a barcode / QR.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `format` | enum | Yes | `'qr'`, `'code128'`, `'ean13'`, `'datamatrix'`, `'pdf417'` |
| `data` | string 1–4296 | Yes | RAW payload — do NOT URL-encode. EAN-13 must be 12 or 13 digits |
| `caption` / `title` | string | No | — |
| `width` / `height` | number 30–500 | No | Points; height ignored for square symbologies |
| `ecLevel` | `'L'`\|`'M'`\|`'Q'`\|`'H'` | No | **QR only** (default `'M'`). Use `'H'` for printed media. |
| `pdfA` | enum | No | `pdfa1b` / `pdfa2b` / `pdfa2u` / `pdfa3b` |

### `add_international_text`

24 scripts via embedded Noto fonts (Arabic, Hebrew, Thai, Japanese/Chinese/Korean, Devanagari, Bengali, Tamil, Telugu, Sinhala, Tibetan, Khmer, Myanmar, Ethiopic, Cyrillic, Greek, Georgian, Armenian, Turkish, Polish, Vietnamese, Latin, …). BiDi isolates + Arabic harakat + complex-script shaping + COLRv1 colour emoji handled automatically. Input is NFC-normalised by default (`normalize` defaults to `'NFC'`; override with `'NFD'`/`'NFKC'`/`'NFKD'`) for maximal glyph coverage, and embedded newlines auto-split into paragraphs. Lang codes added in v1.1.0: `te` (Telugu), `si` (Sinhala), `bo` (Tibetan), `km` (Khmer), `my` (Myanmar), `am` (Ethiopic); the `emoji` code now maps to `noto-color-emoji-data.js` (COLRv1, monochrome fallback).

### `add_table`

Tabular reports with v1.2 smart-table fields: `wrap` (`auto`/`always`/`never`), `repeatHeader`, `zebra`, `caption`, `minRowHeight`, `cellPadding`. Every row must have the same length as `headers`. Optional `infoItems` for a metadata block under the title. Optional `pdfA` for archival output and optional `watermark` (text only; forces the document backend). Since pdfnative v1.3, wrapped cells receive a unique MCID per line, so tagged/PDF-A tables are PDF/UA-safe.

**v1.3.0 additions (pdfnative v1.4.0):** `cellBorders: { top?, right?, bottom?, left?, color?, width? }` for per-edge cell rules, `cellVAlign: 'top' | 'middle' | 'bottom'` for vertical alignment, and `viewerPreferences` (same shape as `generate_basic_pdf`). Any of these forces the document backend.

### `add_form`

Interactive AcroForm with `text`, `textarea`, `checkbox`, `radio`, `dropdown` fields. Optional `blocks[]` rendered before the field group.

### `add_international_text` viewer preferences

Like the other authoring tools, `add_international_text` accepts an optional `viewerPreferences` object (same shape as `generate_basic_pdf`).

### `embed_image`

Single-image PDF (JPEG or PNG). Optional caption / title / explicit width-height (aspect ratio preserved when only one dimension is provided).

### `prepare_signature_placeholder`

Creates a PDF with an unsigned `/Sig` placeholder. **Optional since v1.0.0** — `sign_pdf` auto-injects a placeholder when missing. Use only when you need to customize the placeholder (e.g. larger `placeholderBytes` for >4096-bit RSA keys, or anchor the widget to a specific `pageIndex`).

### `sign_pdf`

PAdES-compatible CMS signature. Algorithm: `'rsa-sha256'` or `'ecdsa-sha256'` (P-256).

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `pdfBase64` | string | Yes | Any PDF — placeholder auto-injected when missing |
| `algorithm` | enum | Yes | — |
| `certDerBase64` | string | Yes | X.509 cert in DER, base64. PEM → DER: `openssl x509 -in cert.pem -outform DER \| base64 -w0` |
| `rsaKeyPkcs1DerBase64` | string | Cond. | Required for RSA. PKCS#1 DER (NOT PKCS#8). `openssl rsa -in key.pem -outform DER -traditional \| base64 -w0` |
| `ecPrivateScalarHex` | string | Cond. | OR. 64 hex chars (raw P-256 scalar `d`). |
| `ecPrivateKeyDerBase64` | string | Cond. | OR. SEC1 or PKCS#8 DER. `openssl pkey -in key.pem -outform DER \| base64 -w0`. |
| `autoInjectPlaceholder` | bool | No | Default `true` |
| `signerName` / `reason` / `location` / `contactInfo` | string | No | Embedded in `/Sig` |
| `signingTime` | ISO-8601 | No | Defaults to now |

Never logs key material. Since v1.3.0 the RSA and EC-DER paths sign through a per-call `node:crypto` provider (`src/crypto-provider.ts`) for constant-time, hardened primitives, transparently falling back to the bundled pure-JS signer when key import fails. The raw-scalar `ecPrivateScalarHex` path always uses the pure-JS signer.

### `verify_pdf`

Read-only verification of every PAdES Baseline / `adbe.pkcs7.detached` signature. For each `/Sig`: recomputes ByteRange SHA-256, validates CMS `messageDigest` (integrity) and `signatureValue`. Optional `trustedRootsDerBase64[]` enables chain trust (otherwise per-signature `chainTrust` is `'self-signed'` or `'unverified'`).

Response shape:
```jsonc
{
  "allValid": true,
  "signatureCount": 1,
  "summary": "1 signature, all valid",
  "signatures": [{
    "valid": true, "integrity": true, "signatureValue": true,
    "signerSubject": "CN=Alice…", "signingTime": "2025-01-…",
    "reason": "…", "location": "…",
    "chainTrust": "self-signed",
    "errors": []
  }]
}
```

### `inspect_pdf`

Structural / security inspection.
- `version`, `pageCount`, `encryption` (`none|aes-128|aes-256|rc4|unknown`), `pdfA` (`1B|2B|2U|3B|null`)
- `signatureCount`, `hasSignaturePlaceholder`, `attachments[]`
- `/Info` dictionary + optional `perPage` sizes
- Optional `check[]` for CI-style assertions: `'pdfa' | 'signed' | 'encrypted' | 'placeholder' | 'attachments'`. `checksPassed` is the AND of all requested checks.

### `add_attachment`

PDF/A-3 (ISO 19005-3) with one or more embedded files. **Primary use case: Factur-X / ZUGFeRD invoices** (single XML payload, `relationship: 'Source'`). Each attachment is capped at 8 MiB. Optional `blocks[]` for the visible body.

### `extract_attachments`

Read-only counterpart to `add_attachment` — walks the catalog name tree (`/Names → /EmbeddedFiles → Names[]`) via the shared `collectEmbeddedFiles()` collector (same metadata as `inspect_pdf`) and returns `{ attachmentCount, attachments: [{ name, sizeBytes?, mimeType?, relationship?, description?, dataBase64? }] }`. `includeData` (default `true`) toggles payload bytes; `filename` filters to one file (`ATTACHMENT_NOT_FOUND` when nothing matches). Payloads are capped at 16 MiB/file and 32 MiB aggregate (`OUTPUT_TOO_LARGE`); encrypted PDFs are rejected with `EXTRACTION_UNSUPPORTED`. Completes the Factur-X round-trip.

### `validate_pdf`

Read-only **PDF/UA (ISO 14289-1)** structural conformance check wrapping pdfnative's `validatePdfUA()`. Verifies catalog `/MarkInfo /Marked true`, `/StructTreeRoot` (+ `/ParentTree`), `/Metadata` (XMP), `/Lang`, and per-page MCID uniqueness. Returns `{ standard: 'pdf-ua-1', valid, errors[], warnings[], summary }`. A fast developer-time gate — **not** a substitute for a full reference validator (veraPDF), which additionally checks fonts, colour and rendering. Typical flow: generate a document with `pdfA` (e.g. `pdfa2u`), then `validate_pdf` the result.

### `extract_text`

Best-effort plain-text extraction (Tj / ' / " / TJ). Returns `{ pageCount, extractedPageCount, extractable, extractableReason?, pages: [{ index, text }], fullText }`. `extractable: false` is **not an error** — it means the PDF uses subset fonts without `/ToUnicode` CMaps; `extractableReason` explains the situation. Encrypted PDFs are rejected with `EXTRACTION_UNSUPPORTED`.

### `merge_pdfs`

Concatenates 2–50 source PDFs into one via pdfnative's page-tree API (`src/tools/merge-pdfs.ts`). Inputs: `pdfsBase64[]` (2–50), optional `dropAnnotations`, optional `maxOutputSizeBytes`, plus the shared `outputMode`/`outputPath`. Returns a single `OutputResult`. Encrypted sources are rejected with `ENCRYPTED_SOURCE`; oversize output with `OUTPUT_TOO_LARGE` (shared `src/pagetree.ts` error mapping).

### `split_pdf`

Splits one PDF into one document per page range (`src/tools/split-pdf.ts`). Inputs: `pdfBase64`, `ranges: [{ start, end? }]` (0-based inclusive; `end` defaults to `start`; validated `end >= start`), optional `dropAnnotations`, optional `maxOutputSizeBytes`. Returns a **`MultiOutputResult`** — one part per range. In `file` mode the `outputPath` is indexed (`report.pdf` → `report-1.pdf`, `report-2.pdf`, …).

### `extract_pages`

Pulls an arbitrary page subset into a single PDF (`src/tools/extract-pages.ts`). Inputs: `pdfBase64`, `pages: number[]` (0-based, max 5000, order preserved), optional `dropAnnotations`, optional `maxOutputSizeBytes`. Returns a single `OutputResult`. Out-of-range indices and encrypted sources are rejected (`PDF_PARSE_FAILED` / `ENCRYPTED_SOURCE`).

---

## 5. Output System ([src/output.ts](../src/output.ts))

| Mode | Description | Env var required |
|------|-------------|-----------------|
| `'base64'` | PDF inline as base64 `resource` in MCP response | No |
| `'file'`   | Writes to sandboxed dir; returns `filePath + sizeBytes` | Yes — `PDFNATIVE_MCP_OUTPUT_DIR` |

### Sandboxed File Output

When `outputMode='file'`, the caller must supply `outputPath` (relative) and the host must have set `PDFNATIVE_MCP_OUTPUT_DIR` to an absolute directory.

Security enforcement in `resolveSandboxedPath()`:
1. Absolute paths rejected (relative only).
2. NUL byte rejected.
3. Path traversal rejected (`path.relative` check stays within the sandbox).
4. Extension enforced (`.pdf`).
5. Size cap — generated PDF over 50 MB throws `ToolError('OUTPUT_TOO_LARGE')`.

### `OutputResult` type

```typescript
interface OutputResult {
    mode: 'base64' | 'file';
    sizeBytes: number;
    filePath?: string;    // when mode='file'
    base64?: string;      // when mode='base64'
}
```

### `MultiOutputResult` type (split_pdf)

```typescript
interface MultiOutputResult {
    mode: 'base64' | 'file';
    count: number;
    totalSizeBytes: number;
    parts: Array<{ index: number; sizeBytes: number; filePath?: string; base64?: string }>;
}
```

Each part is capped at 50 MiB and the aggregate at 200 MiB (`MAX_MULTI_OUTPUT_BYTES`); `emitPdfMulti()` writes indexed sandbox files or returns one base64 part per range.

---

## 6. Caching ([src/cache.ts](../src/cache.ts))

A small in-process LRU caches the result of idempotent / read-only tool invocations (key = SHA-256 of `toolName + JSON.stringify(input)`). Disabled by default; set `PDFNATIVE_MCP_CACHE_DIR` to enable a persistent on-disk cache. Cached responses preserve the exact same shape as fresh ones.

---

## 7. Error Types ([src/errors.ts](../src/errors.ts))

```typescript
class ToolError extends Error {
    code: string;  // e.g. 'VALIDATION_ERROR', 'PDF_PARSE_FAILED', 'MISSING_PLACEHOLDER',
                   //      'EXTRACTION_UNSUPPORTED', 'OUTPUT_TOO_LARGE'
}
class SecurityError extends ToolError {
    code = 'SECURITY_VIOLATION';
}
```

`ToolError` → MCP `CallToolResult` with `isError: true`, message in `content[0].text`.
Unhandled errors → logged to stderr, generic message returned.

---

## 8. Transport & Environment

Two transports are supported. Default = stdio. Set `PDFNATIVE_MCP_PORT` to expose a Streamable HTTP endpoint on `http://127.0.0.1:<port>/mcp` instead.

> **MCP protocol version.** The server is built on `@modelcontextprotocol/sdk` ^1.29, which
> negotiates the latest MCP protocol revision (**2025-11-25**) and falls back to `2025-06-18` /
> `2025-03-26` for older clients. `serverInfo` carries a human-readable `title` + `description`
> (mirroring `server.json`), tool inputs/outputs are JSON Schema **2020-12** (the current default
> dialect), and Zod validation errors surface as tool-execution errors (`isError: true`) so a
> model can self-correct.

| Variable | Required | Description |
|----------|----------|-------------|
| `PDFNATIVE_MCP_OUTPUT_DIR` | No | Absolute path of the allowed output sandbox. File output disabled if unset. |
| `PDFNATIVE_MCP_CACHE_DIR`  | No | Absolute path for the persistent cache. Cache disabled if unset. |
| `PDFNATIVE_MCP_PORT`       | No | When set to a valid port (1–65535), switches the transport to Streamable HTTP. Unset = stdio. |

> Historical note: pre-v1.0.0 used a misspelled env var (`PDFNATIVE_MPC_OUTPUT_DIR`). v1.0.0 standardized on `PDFNATIVE_MCP_OUTPUT_DIR`. Update any old config.

### Privacy & data handling

- **No telemetry, no network egress.** The server makes no outbound calls, opens no
  sockets of its own, and emits no analytics/usage data. Document bytes never leave
  the process except in the JSON-RPC response to the caller.
- **Transit.** stdio (default) is a local pipe to the parent process. The opt-in
  HTTP transport (`PDFNATIVE_MCP_PORT`) binds **`127.0.0.1`** only **and** enables the SDK's
  **DNS-rebinding protection**: the `Host` and `Origin` headers are pinned to the loopback
  authority (`127.0.0.1:<port>` / `localhost:<port>`), so a malicious web page that reaches the
  port via a rebound DNS name is rejected with **403** (MCP Security Best Practices). Terminate
  TLS in a reverse proxy if you expose it beyond localhost.
- **Attachments are passed through verbatim.** `add_attachment` embeds, and
  `extract_attachments` returns, payload bytes **as-is** — the server does **not**
  execute, render, or virus-scan embedded files. Treat extracted content as untrusted
  and scan it in the caller if it originates from an untrusted PDF.
- **No secret retention.** Key/cert material supplied to `sign_pdf` is used in-memory
  for the single call and never logged, cached, or echoed in errors.

---

## 9. Adding a New Tool

1. Create `src/tools/my-tool.ts` exporting:
   - `MY_TOOL_NAME`, `MY_TOOL_INPUT_SCHEMA`, optional `MY_TOOL_OUTPUT_SCHEMA`
   - Zod `InputSchema` mirroring the JSON Schema
   - `myTool(args: unknown): Promise<OutputResult | …>` handler
2. Register in [src/server.ts](../src/server.ts) (`TOOLS` array, `SERVER_INSTRUCTIONS` decision tree, `_meta.examples`).
3. Add tests in `tests/`: happy path (base64), file output, validation errors, security errors when applicable.
4. Update this document and [`AI_GUIDE.md`](AI_GUIDE.md).
5. Decide whether the change bumps `_meta.apiVersion` — see [`API_STABILITY.md`](API_STABILITY.md).

---

## 10. Development Quick Reference

```bash
npm install
npm run typecheck:all
npm run lint
npm run test
npm run test:coverage
npm run build
```

Vitest coverage thresholds: `statements 88` / `branches 75` / `functions 85` / `lines 90`.

---

## 11. Security Design Notes

- **No file read** — tools never read files from disk; only write (when sandbox configured).
- **Input validation** — every tool validates with Zod before calling `pdfnative`. Invalid inputs → `ToolError`, not unhandled exceptions.
- **Key material** — `sign_pdf` never echoes key or cert bytes in logs or error messages.
- **Path traversal** — `resolveSandboxedPath` uses `path.relative` to verify the resolved path stays within the sandbox.
- **NUL bytes** — explicitly rejected in output paths.
- **Absolute paths** — rejected (relative only).
- **Size cap** — 50 MB limit on output PDF prevents memory exhaustion.
- **Strict TypeScript** — `noImplicitAny`, `strict: true`; `unknown` + narrowing throughout; `Zod` at all external boundaries.

See [`guides/PDFA.md`](guides/PDFA.md) and [`AI_GUIDE.md`](AI_GUIDE.md) for usage-oriented notes.
