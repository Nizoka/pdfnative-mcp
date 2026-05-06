# pdfnative-mcp — Knowledge Base

> This document is structured for AI assistants (GitHub Copilot, Claude, Cursor, Continue, Zed).  
> It provides the full context needed to understand, extend, and debug pdfnative-mcp without reading all source files.

---

## 1. Context

**What is pdfnative-mcp?**
An MCP (Model Context Protocol) server that bridges the zero-dependency [`pdfnative`](https://github.com/Nizoka/pdfnative) library to AI clients (Claude Desktop, Cursor, ChatGPT, Continue, Zed, etc.).  
It exposes 8 PDF tools over a stdio (or HTTP) transport so AI agents can generate, sign, and analyse PDF files.

**Philosophy:**
- `pdfnative` is the only runtime dependency — all PDF logic lives there.
- The MCP server is a thin, secure dispatch layer: validate inputs with Zod → call pdfnative → emit PDF as base64 or to a sandboxed file.
- Every tool is fully self-contained (its own file in `src/tools/`).
- Security at every boundary: Zod validation on all inputs, path traversal prevention on file output.

**Runtime:** Node.js ≥ 20 (ESM, strict TypeScript)

**Transports:**
- `stdio` (default) — for local AI client integrations (Claude Desktop, Cursor, etc.)
- HTTP (Streamable HTTP) — when `PDFNATIVE_MCP_PORT` is set, exposes a POST `/mcp` endpoint

**Repositories:**  
- MCP server: https://github.com/Nizoka/pdfnative-mcp  
- Core library: https://github.com/Nizoka/pdfnative  
- CLI companion: https://github.com/Nizoka/pdfnative-cli  
- npm: https://www.npmjs.com/package/pdfnative-mcp

---

## 2. Architecture

```
src/
├── cli.ts            # Entry point: transport selection (stdio or HTTP), signal handling
├── server.ts         # createServer(): MCP tool registry + request handlers
├── output.ts         # outputMode logic: base64 inline vs sandboxed file write
├── errors.ts         # ToolError + SecurityError
└── tools/
    ├── generate-basic-pdf.ts          # generate_basic_pdf
    ├── add-barcode.ts                 # add_barcode
    ├── sign-pdf.ts                    # sign_pdf
    ├── add-international-text.ts      # add_international_text
    ├── add-table.ts                   # add_table
    ├── add-form.ts                    # add_form
    ├── embed-image.ts                 # embed_image
    ├── inspect-pdf.ts                 # inspect_pdf  (new in v0.3.0)
    └── prepare-signature-placeholder.ts  # prepare_signature_placeholder
```

### Request Dispatch Flow

```
AI client (Claude / Cursor / etc.)
    │  MCP JSON-RPC over stdio or HTTP POST /mcp
    ▼
src/cli.ts
  ensureCompressionReady()          ← init pdfnative compression codec
  createServer()                    ← builds the MCP Server instance
  connect(StdioServerTransport | StreamableHTTPServerTransport)
    │
    ▼
src/server.ts  (createServer)
  ListToolsRequest  → TOOLS registry → list of JSON schemas
  CallToolRequest   → TOOL_INDEX.get(name) → handler(args)
    │
    ▼
src/tools/<tool>.ts
  Zod.parse(args)                   ← throws ToolError on invalid input
  call pdfnative API
  emitPdf(bytes, { mode, outputPath })  ← src/output.ts
    │
    ├── mode='base64' → base64 string inline in response
    └── mode='file'   → write to sandboxed path → return filePath + sizeBytes
```

---

## 3. Tool Registry (`src/server.ts`)

Each tool is registered in the `TOOLS: readonly ToolDefinition[]` array with:

```typescript
interface ToolDefinition {
    name: string;
    title: string;
    description: string;
    inputSchema: unknown;             // JSON Schema for MCP ListTools response
    outputSchema?: unknown;           // JSON Schema for the tool result (MCP 2025-06-18, added in v0.3.0)
    annotations?: {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
        openWorldHint?: boolean;
    };
    handler: (args: unknown) => Promise<OutputResult | InspectPdfResult>;
}
```

A `TOOL_INDEX: ReadonlyMap<string, ToolDefinition>` is derived from the array for O(1) lookup on `CallToolRequest`.

**Server metadata:**
- `SERVER_NAME = 'pdfnative-mcp'`
- `SERVER_VERSION = '0.3.0'` (hardcoded to avoid `rootDir` expansion beyond `./src`)

**v0.3.0 boot:** `ensureCompressionReady()` now also awaits `initCrypto()` (pdfnative v1.1) so the first signing or `inspect_pdf` call no longer pays an init penalty.

---

## 4. Tools — Full Reference

### `generate_basic_pdf`

**Purpose:** Multi-page document from structured content blocks. The most general-purpose tool.

**When to use:** Reports, letters, articles, invoices, manuals — any standard document layout.

**Key inputs:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `title` | string 1–200 | Yes | Rendered at top and used as PDF metadata |
| `blocks` | array 1–5000 | Yes | Ordered content blocks (see block types below) |
| `footerText` | string | No | Footer on every page |
| `metadata` | object | No | `{ author, subject, creator, keywords }` |
| `layout` | object | No | `{ pageSize, margins: { t, r, b, l } }` |
| `outputMode` | `'base64'`\|`'file'` | No | Default `'base64'` |
| `outputPath` | string | No | Required when `outputMode='file'` |

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

---

### `add_barcode`

**Purpose:** Single-page PDF with an embedded barcode or QR code.

**When to use:** Tickets, labels, vouchers, inventory tags, package tracking.

**Key inputs:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `format` | enum | Yes | `'qr'`, `'code128'`, `'ean13'`, `'datamatrix'`, `'pdf417'` |
| `data` | string 1–4296 | Yes | EAN-13 must be 12 or 13 digits |
| `caption` | string | No | Rendered above barcode |
| `title` | string | No | Page heading + PDF metadata title (default `'Barcode'`) |
| `width` / `height` | number 30–500 | No | Points; height ignored for square symbologies |
| `ecLevel` | `'L'`\|`'M'`\|`'Q'`\|`'H'` | No | QR error correction (default `'M'`) |

---

### `sign_pdf`

**Purpose:** Apply a PAdES-compatible CMS digital signature to a PDF that already has a `/Sig` placeholder.

**When to use:** Step 2 of the two-step signing workflow (after `prepare_signature_placeholder`).

**Key inputs:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `pdfBase64` | string | Yes | Base64-encoded PDF with `/Sig` placeholder |
| `algorithm` | enum | Yes | `'rsa-sha256'` or `'ecdsa-sha256'` (P-256 only) |
| `certDerBase64` | string | Yes | Base64 of signer X.509 certificate (DER) |
| `rsaKeyPkcs1DerBase64` | string | Cond. | RSA PKCS#1 private key in DER, base64; required for RSA |
| `ecPrivateScalarHex` | string | Cond. | 64-char hex P-256 private scalar `d`; required for ECDSA |
| `signerName` / `reason` / `location` / `contactInfo` | string | No | Embedded in the signature dictionary |
| `signingTime` | ISO-8601 string | No | Defaults to now |

> **Security note:** Never log key material. The tool does not echo private keys in responses or errors.

**Two-step signing workflow:**
```
prepare_signature_placeholder → (base64 PDF with /Sig) → sign_pdf → (signed PDF)
```

---

### `add_international_text`

**Purpose:** PDF with non-Latin script text. BiDi reordering, Arabic shaping, CJK, and OpenType shaping are handled automatically.

**Supported languages (`lang` codes):**

| Code | Script |
|------|--------|
| `ar` | Arabic |
| `he` | Hebrew |
| `th` | Thai |
| `ja` | Japanese (CJK) |
| `zh` | Chinese Simplified (CJK) |
| `ko` | Korean (CJK) |
| `hi` | Devanagari |
| `bn` | Bengali |
| `ta` | Tamil |
| `ru` | Cyrillic |
| `el` | Greek |
| `ka` | Georgian |
| `hy` | Armenian |
| `tr` | Turkish |
| `pl` | Polish |
| `vi` | Vietnamese |

**Key inputs:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `lang` | enum (codes above) | Yes | Selects the embedded Noto font |
| `title` | string | Yes | Page heading + PDF metadata |
| `blocks` | array | Yes | Same block types as `generate_basic_pdf` |

**Fonts:** Noto font data is loaded from `pdfnative/fonts/<lang>-data.js` modules at runtime. No external network call is made.

---

### `add_table`

**Purpose:** Tabular PDF report from column headers and data rows.

**When to use:** Data exports, financial summaries, schedules, leaderboards — structured grid content.

**Key inputs:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `title` | string 1–200 | Yes | Report heading + PDF metadata |
| `headers` | string[] 1–50 | Yes | Column header labels |
| `rows` | string[][] 1–5000 | Yes | Each row must match `headers` length |
| `infoItems` | `{ label, value }[]` | No | Key-value metadata block under the title (max 20) |
| `footerText` | string | No | Footer on every page |

---

### `add_form`

**Purpose:** Interactive AcroForm PDF with fillable fields.

**When to use:** Data-capture forms, surveys, fillable templates, HR documents.

**Field types (`fieldType`):** `'text'`, `'textarea'`, `'checkbox'`, `'radio'`, `'dropdown'`

**Key inputs:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `title` | string 1–200 | Yes | Page heading + PDF metadata |
| `fields` | FormField[] 1–200 | Yes | Each field: `fieldType`, `name`, optional `label`/`value`/`options` |
| `blocks` | block[] | No | Content blocks rendered before the form fields |

---

### `embed_image`

**Purpose:** PDF document with an embedded JPEG or PNG image.

**When to use:** Certificates with logos, photo reports, product sheets with visual assets.

**Key inputs:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `imageBase64` | string | Yes | Base64-encoded JPEG or PNG |
| `mimeType` | `'image/jpeg'`\|`'image/png'` | Yes | Must match actual encoding |
| `title` | string | No | Page heading + PDF metadata |
| `caption` | string | No | Rendered below image |
| `width` / `height` | number 10–800/1000 | No | Points; aspect ratio preserved if only one set |

---

### `prepare_signature_placeholder`

**Purpose:** Create a PDF with a `/Sig` AcroForm placeholder, ready to be signed by `sign_pdf`.

**When to use:** Step 1 of the two-step signing workflow.

**Key inputs:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `title` | string | Yes | Page heading + metadata |
| `signerName` / `reason` / `location` / `contactInfo` | string | No | Pre-fills `/Sig` dictionary fields |
| `blocks` | block[] | No | Document body rendered before the signature widget |

**Output:** Base64-encoded PDF (or file) containing the `/Contents` and `/ByteRange` reservation structures that `sign_pdf` will populate.

---

### `inspect_pdf`  *(added in v0.3.0)*

**Purpose:** Read-only structural and security inspection of an existing PDF. Useful for downstream verification, CI assertions, and AI agents that need to reason about a PDF before acting on it.

**Implementation:** All parsing flows through pdfnative v1.1's hardened `openPdf()` reader (CWE-674 / CWE-400 mitigations baked in). No filesystem reads \u2014 the caller supplies the PDF as base64.

**Key inputs:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `pdfBase64` | string | Yes | Base64-encoded PDF bytes to inspect |
| `pages` | boolean | No | When `true`, includes per-page `{ index, width, height }` |
| `check` | array | No | CI-style assertions: any of `'pdfa'`, `'signed'`, `'encrypted'`. AND-evaluated into `checksPassed`. |

**Output (`InspectPdfResult`):**

| Field | Type | Notes |
|-------|------|-------|
| `version` | string | PDF header version (e.g. `"1.7"`) |
| `pageCount` | number | Total pages |
| `encryption` | enum | `'none' \| 'aes-128' \| 'aes-256' \| 'rc4' \| 'unknown'` |
| `pdfA` | string \| null | Detected PDF/A claim from XMP (`'1B'`, `'2B'`, `'2U'`, `'3B'`) or `null` |
| `signatureCount` | number | Number of `/FT /Sig` widget annotations in AcroForm |
| `info` | object | `/Info` dictionary entries decoded as strings |
| `perPage` | array? | When `pages=true` |
| `checks` / `checksPassed` | object / boolean | Present when `check` was supplied |

**Annotations:** `readOnlyHint: true`, `idempotentHint: true`.

---

### PDF/A flag (added in v0.3.0)

Every document-producing tool now accepts an optional `pdfA` field:

| Tool | Field | Values | Notes |
|------|-------|--------|-------|
| `generate_basic_pdf`, `add_form`, `add_table`, `embed_image`, `add_barcode`, `prepare_signature_placeholder`, `add_international_text` | `pdfA` | `'pdfa1b' \| 'pdfa2b' \| 'pdfa2u' \| 'pdfa3b'` | Maps to pdfnative v1.1's `tagged` layout option. Mutually exclusive with PDF encryption. |

When `pdfA` is omitted, the byte output is identical to v0.2.0.

---

## 5. Output System (`src/output.ts`)

### Output Modes

| Mode | Description | Env var required |
|------|-------------|-----------------|
| `'base64'` | Returns the PDF inline as a base64-encoded `resource` in the MCP response | No |
| `'file'` | Writes the PDF to a sandboxed directory; returns `filePath + sizeBytes` | Yes — `PDFNATIVE_MPC_OUTPUT_DIR` |

### Sandboxed File Output

When `outputMode='file'`, the caller must supply `outputPath` (a relative path) and the host must have set `PDFNATIVE_MPC_OUTPUT_DIR` to an absolute directory.

Security enforcement in `resolveSandboxedPath()`:
1. **Absolute paths rejected** — only relative paths accepted.
2. **NUL byte rejected** — `\0` in path causes `SecurityError`.
3. **Path traversal rejected** — resolved path must stay within the sandbox (`path.relative` check).
4. **Extension enforced** — `outputPath` must end with `.pdf`.
5. **Size cap** — generated PDF over 50 MB throws `ToolError('OUTPUT_TOO_LARGE')`.

```typescript
// env var name
const OUTPUT_DIR_ENV = 'PDFNATIVE_MPC_OUTPUT_DIR';  // note: typo preserved from v0.1.0

// helpers
export function getOutputSandbox(): string | null
export function resolveSandboxedPath(userPath: string): string   // throws SecurityError
export async function emitPdf(bytes: Uint8Array, options: { mode, outputPath? }): Promise<OutputResult>
```

### OutputResult type

```typescript
interface OutputResult {
    mode: 'base64' | 'file';
    sizeBytes: number;
    filePath?: string;    // when mode='file'
    base64?: string;      // when mode='base64'
}
```

---

## 6. Error Types (`src/errors.ts`)

```typescript
class ToolError extends Error {
    name = 'ToolError';
    code: string;   // e.g. 'INVALID_PATH', 'OUTPUT_TOO_LARGE', 'INVALID_INPUT'
    constructor(code: string, message: string)
}

class SecurityError extends ToolError {
    name = 'SecurityError';
    code = 'SECURITY_VIOLATION';
    constructor(message: string)
}
```

**How errors surface to clients:**  
`ToolError` → MCP `CallToolResult` with `isError: true`, error message in `content[0].text`.  
Unhandled errors → logged to stderr, `isError: true` with generic message.

---

## 7. Transport Configuration (`src/cli.ts`)

### stdio (default)

No extra configuration needed. Connect via MCP client config pointing to `npx pdfnative-mcp`.

```json
{
  "mcpServers": {
    "pdfnative": {
      "command": "npx",
      "args": ["-y", "pdfnative-mcp"],
      "env": { "PDFNATIVE_MPC_OUTPUT_DIR": "/path/to/output-dir" }
    }
  }
}
```

### HTTP (Streamable HTTP)

Set `PDFNATIVE_MCP_PORT` to any valid port (1–65535). The server listens on that port and accepts `POST /mcp`.

```bash
PDFNATIVE_MCP_PORT=3000 npx pdfnative-mcp
# Connect: http://localhost:3000/mcp
```

Handles `SIGINT` / `SIGTERM` for graceful shutdown.

---

## 8. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PDFNATIVE_MPC_OUTPUT_DIR` | No | Absolute path of the allowed output sandbox. File output disabled if unset. Note: legacy typo (`MPC` not `MCP`) — kept for backward compat. |
| `PDFNATIVE_MCP_PORT` | No | Port for HTTP transport. Unset = stdio mode. |

---

## 9. Adding a New Tool

Checklist for adding a tool (e.g. `my_tool`):

1. **Create `src/tools/my-tool.ts`** with:
   - `MY_TOOL_NAME`: string constant
   - `MY_TOOL_INPUT_SCHEMA`: JSON Schema object (used in `ListTools` response)
   - Zod `InputSchema` that mirrors the JSON Schema
   - `myTool(args: unknown): Promise<OutputResult>` handler

2. **Register in `src/server.ts`**:
   - Import `MY_TOOL_NAME`, `MY_TOOL_INPUT_SCHEMA`, `myTool`
   - Add entry to `TOOLS` array
   - Add description bullet to `SERVER_INSTRUCTIONS`

3. **Add tests in `tests/`** covering:
   - Happy path (base64 output)
   - File output (if supported)
   - Validation errors (invalid inputs → `ToolError`)
   - Security errors (path traversal, etc., if applicable)

4. **Update `docs/KNOWLEDGE_BASE.md`** (this file) with the new tool's section.

---

## 10. Development Quick Reference

```bash
# Install dependencies
npm install

# Full quality gate (required before every PR)
npm run typecheck:all   # tsc --noEmit on src + tests
npm run lint            # ESLint
npm run test            # vitest run
npm run test:coverage   # vitest run --coverage
npm run build           # tsup → dist/

# Single test file
npx vitest run tests/tools/generate-basic-pdf.test.ts
```

**Build output structure:**
```
dist/
├── cli.js       # ESM entry
├── cli.cjs      # CJS entry
└── *.d.ts       # Type declarations
```

---

## 11. Integration Examples

### Claude Desktop (stdio)

```json
{
  "mcpServers": {
    "pdfnative": {
      "command": "npx",
      "args": ["-y", "pdfnative-mcp"],
      "env": { "PDFNATIVE_MPC_OUTPUT_DIR": "/Users/me/Documents/mcp-pdfs" }
    }
  }
}
```

### Cursor (stdio)

```json
{
  "mcp": {
    "servers": {
      "pdfnative": {
        "command": "npx",
        "args": ["-y", "pdfnative-mcp"]
      }
    }
  }
}
```

### Two-step digital signing

```
1. AI calls prepare_signature_placeholder
   Input: { title: "Contract", signerName: "Alice", reason: "Approved" }
   Output: base64 PDF with /Sig placeholder

2. AI calls sign_pdf
   Input: {
     pdfBase64: "<output from step 1>",
     algorithm: "rsa-sha256",
     certDerBase64: "<base64 DER cert>",
     rsaKeyPkcs1DerBase64: "<base64 DER private key>"
   }
   Output: base64 signed PDF
```

### Generating a bilingual Arabic/English document

```jsonc
// Call add_international_text with lang="ar"
{
  "lang": "ar",
  "title": "تقرير",
  "blocks": [
    { "type": "heading", "text": "مرحباً بالعالم", "level": 1 },
    { "type": "paragraph", "text": "هذا مستند تجريبي." }
  ]
}
// Returns base64 PDF with proper BiDi reordering + Noto Arabic font
```

---

## 12. Security Design Notes

- **No file read** — tools never read files from the filesystem; only write (when sandbox configured).
- **Input validation** — every tool validates with Zod before calling `pdfnative`. Invalid inputs → `ToolError`, not unhandled exceptions.
- **Key material** — `sign_pdf` never echoes key or cert bytes in logs or error messages.
- **Path traversal** — `resolveSandboxedPath` uses `path.relative` to verify the resolved path stays within the sandbox.
- **NUL bytes** — explicitly rejected in output paths to prevent OS-level bypasses.
- **Absolute paths** — rejected entirely; relative paths only, anchored to sandbox.
- **Size cap** — 50 MB limit on output PDF prevents memory exhaustion on disk writes.
- **Strict TypeScript** — `noImplicitAny`, `strict: true`; `unknown` + narrowing throughout; `Zod` at all external boundaries.
