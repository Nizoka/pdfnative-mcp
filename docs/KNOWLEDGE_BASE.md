# pdfnative-mcp — Knowledge Base

> Reference for AI assistants (GitHub Copilot, Claude, Cursor, Continue, Zed, Windsurf, Cline, Roo Code)
> and human contributors. Captures the full context needed to understand, extend, and debug
> pdfnative-mcp **v1.6.0** without reading every source file.

> If you are an AI agent calling pdfnative-mcp from a chat session, also read
> [`AI_GUIDE.md`](AI_GUIDE.md) — the short, action-oriented decision tree.

---

## 1. Context

**What is pdfnative-mcp?**
An MCP (Model Context Protocol) server that bridges the zero-dependency
[`pdfnative`](https://github.com/Nizoka/pdfnative) library (v1.7.x) to AI clients
(Claude Desktop, ChatGPT, Cursor, Continue, Zed, Windsurf, Cline, Roo Code, …).
It exposes **27** PDF tools over a stdio (or Streamable HTTP) transport so AI agents
can generate, sign (the full PAdES **B-B → B-LTA ladder**: timestamps, `/DSS`,
document timestamps), verify, validate, attach, inspect, extract (Unicode text with
positioned runs), merge, split, carve, annotate, **chart**, **fill/flatten forms**,
**encrypt/decrypt**, prepare **print-production** output and **update metadata** of
PDF files, and draft governance-compliant GitHub issues for human review. Generated
PDFs (file mode) are also exposed as native MCP resources.

**Philosophy:**
- Three runtime dependencies (`pdfnative`, the MCP SDK `@modelcontextprotocol/server`, `zod`) — all PDF logic lives in `pdfnative`.
- The MCP server is a thin, secure dispatch layer: validate inputs with Zod → call pdfnative → emit PDF as base64 or to a sandboxed file.
- Every tool is fully self-contained (its own file in [src/tools/](../src/tools)).
- Security at every boundary: Zod validation on all inputs, path traversal prevention on file output, no key-material echo in logs or errors.
- Every tool ships `_meta.apiVersion = '1.6.0'` and ≤ 2 executable `_meta.examples` (the rest live in `examples/*.json`) so AI clients can introspect supported behavior — see [`API_STABILITY.md`](API_STABILITY.md).
- Input validation is strict (`.strict()` Zod objects mirroring `additionalProperties: false`): unknown top-level or nested keys → `VALIDATION_ERROR`.
- No outbound network by default: the only egress (`src/network.ts`) goes to operator-configured RFC 3161 / OCSP / CRL endpoints; URLs never come from tool arguments.

**Runtime:** Node.js ≥ 22 (ESM, strict TypeScript). Transport: stdio (default) or Streamable HTTP. Protocol: MCP 2026-07-28 with automatic 2025-era fallback.

**Repositories**
- MCP server: <https://github.com/Nizoka/pdfnative-mcp>
- Core library: <https://github.com/Nizoka/pdfnative>
- CLI companion: <https://github.com/Nizoka/pdfnative-cli>
- npm: <https://www.npmjs.com/package/pdfnative-mcp>

---

## 2. Architecture

```
src/
├── cli.ts            # Entry point: stdio (serveStdio) or HTTP (createMcpHandler), signal handling, lazy init
├── http.ts           # Node http.IncomingMessage <-> Web Request/Response bridge + Host/Origin loopback guard
├── auth.ts           # opt-in HTTP bearer token (PDFNATIVE_MCP_HTTP_TOKEN), constant-time compare, 401 challenge
├── server.ts         # createServer(): MCP tool registry, cache hints, request handlers, SERVER_INSTRUCTIONS (~5.4 kB), PROMPTS
├── network.ts        # operator-configured TSA / OCSP / CRL providers + SSRF guard (v1.6.0)
├── base64.ts         # base64 / DER boundary diagnostics (data: prefix tolerated, PEM / double-encoding hints)
├── print.ts          # shared print-production schema: boxes, bleed, marks, userUnit, outputIntent, metadata, creationDate (v1.6.0)
├── diagnostics.ts    # PDF/A diagnostics sink, strict / includeDiagnostics / embedFonts, mapBuildError (v1.6.0)
├── chart.ts          # shared charts v2 schema + toChartBlock mapper
├── output.ts         # outputMode logic: base64 inline vs sandboxed file write (single + multi)
├── cache.ts          # In-process LRU cache for idempotent tool results
├── cms.ts            # CMS / SignedData parser (SHA-256/384/512, ESS signing-certificate-v2, timestamp attributes)
├── pdf-introspection.ts # shared reader helpers: signature widgets, /DSS, page boxes, /Trapped
├── text.ts           # newline sanitizer (Safe PDF/A)
├── watermark.ts      # shared text-watermark schema + WatermarkOptions mapping
├── normalize.ts      # shared Unicode-normalization schema
├── doc-features.ts   # shared schemas/mappers: nested lists, outline, page labels, viewer prefs (+ print-dialog defaults)
├── pagetree.ts       # shared page-tree error mapping (merge/split/extract)
├── encryption.ts     # shared password / encrypt schema + mapDecryptError
├── projection.ts     # token-frugal verbosity / fields projection
├── resources.ts      # MCP resources for sandboxed PDFs
├── fonts.ts          # shared font-module directory + loader helpers
├── governance.ts     # AI-governance contract: issue validation + prompt copy
├── version.ts        # single source of truth for PDFNATIVE_MCP_VERSION
├── crypto-provider.ts# node:crypto constant-time signing provider for DER keys (SHA-256/384/512); verification stays pure JS
├── errors.ts         # ToolError + SecurityError + GovernanceError
└── tools/
    ├── generate-basic-pdf.ts          # generate_basic_pdf
    ├── add-barcode.ts                 # add_barcode
    ├── add-international-text.ts      # add_international_text
    ├── add-table.ts                   # add_table
    ├── add-form.ts                    # add_form
    ├── read-form-fields.ts            # read_form_fields
    ├── fill-form.ts                   # fill_form
    ├── add-chart.ts                   # add_chart
    ├── embed-image.ts                 # embed_image
    ├── prepare-signature-placeholder.ts  # prepare_signature_placeholder
    ├── sign-pdf.ts                    # sign_pdf (PAdES B-B / B-T)
    ├── add-ltv.ts                     # add_ltv (PAdES B-LT, /DSS) — v1.6.0
    ├── timestamp-pdf.ts               # timestamp_pdf (PAdES B-LTA, /DocTimeStamp) — v1.6.0
    ├── update-metadata.ts             # update_metadata (incremental /Info + XMP) — v1.6.0
    ├── verify-pdf.ts                  # verify_pdf (+ ltv view, DocTimeStamp verification)
    ├── validate-pdf.ts                # validate_pdf (PDF/UA)
    ├── inspect-pdf.ts                 # inspect_pdf
    ├── add-attachment.ts              # add_attachment (PDF/A-3 / Factur-X)
    ├── extract-attachments.ts         # extract_attachments (read-only)
    ├── extract-text.ts                # extract_text
    ├── merge-pdfs.ts                  # merge_pdfs (page-tree)
    ├── split-pdf.ts                   # split_pdf (page-tree, multi-output)
    ├── extract-pages.ts               # extract_pages (page-tree)
    ├── encrypt-pdf.ts                 # encrypt_pdf
    ├── decrypt-pdf.ts                 # decrypt_pdf
    ├── annotate-pdf.ts                # annotate_pdf (markup overlay)
    └── draft-governance-issue.ts      # draft_governance_issue (local HITL draft)
```

Catalogue parity gate: `scripts/tool-shape.mjs` computes a structural fingerprint of `tools/list` (description strings stripped; `--write` refreshes `tests/_fixtures/tool-shape.json`) and `tests/catalogue-parity.test.ts` fails on any structural drift (types, enums, defaults, constraints, `required`, `additionalProperties`, example count). Wording — descriptions, examples, `SERVER_INSTRUCTIONS` — may change freely; a structural change needs a deliberate fixture refresh reviewed under `API_STABILITY.md` §5. `tests/schema-conformance.test.ts` additionally validates every `structuredContent` (full, summary, `fields`, file mode, diagnostics) against the tool's `outputSchema` — and every `_meta.examples[].input` against its `inputSchema` — with the SDK's Ajv 2020-12 validator.

### Request Dispatch Flow

```
AI client (Claude / Cursor / Copilot / etc.)
    │  MCP JSON-RPC over stdio, or POST /mcp (Streamable HTTP)
    ▼
src/cli.ts
  initCrypto() + initNodeCompression() ← awaited once before serving
  stdio: serveStdio(createServer, { legacy: 'serve' })        ← one Server per process
  HTTP : createMcpHandler(createServer, { legacy: 'stateless' }) ← fresh Server per request (2026-07-28 is stateless)
    │
    ▼
src/server.ts  (createServer)
  tools/list        → TOOLS registry → JSON schemas + _meta (apiVersion + examples); cache hint public / 24 h
  tools/call        → callToolDirect(name, args) → projectCallToolResult (wire projection per negotiated revision)
                      unknown tool name → JSON-RPC −32602 `[UNKNOWN_TOOL] Unknown tool: <name>` (protocol error, not an isError result)
  prompts/list|get  → PROMPTS registry (governance_contract, draft_issue_workflow, pades_ladder, print_ready, reproducible_output, pdfa_valid)
  resources/*       → src/resources.ts (private, ttlMs 0); template pdfnative://output/{+path}; unknown URI → UNKNOWN_RESOURCE (−32602)
  server/discover   → SDK-generated (versions, capabilities, instructions, cache hint public / 1 h)
    │
    ▼
src/tools/<tool>.ts
  Zod.parse(args)                   ← strict; throws ToolError('VALIDATION_ERROR') on bad / unknown input
  (cache lookup via src/cache.ts — skipped for file mode, encrypt_pdf, decrypt_pdf, sign_pdf (every call), add_ltv, timestamp_pdf, update_metadata; a hit carries _meta.cached: true)
  call pdfnative API (+ src/network.ts providers for TSA / OCSP / CRL when the operator configured them)
  emitPdf(bytes, { mode, outputPath })  ← src/output.ts
    │
    ├── mode='base64' → PDF returned once as an embedded `resource` content block (data: URI); structuredContent = { mode, sizeBytes, diagnostics?, summary? }
    └── mode='file'   → write to sandboxed path → return filePath + sizeBytes (+ resource_link)
```

The six read-only tools (`inspect_pdf`, `verify_pdf`, `validate_pdf`, `extract_text`, `extract_attachments`, `read_form_fields`) additionally
apply an opt-in projection layer (`src/projection.ts`) before emitting `structuredContent`:
`verbosity: 'summary'` swaps the full result for a compact scalar subset (keeping `docTimestampCount` / `trapped` / `checksPassed` on `inspect_pdf` and `ltvLevel` on `verify_pdf ltv: true` when present), then
`fields: ['a','b.c']` projects to named dot-paths; unmatched paths are reported additively in `_meta.unmatchedFields` + `_meta.availableFields`. Defaults (`'full'`, no `fields`) are
unchanged. Their `outputSchema`s are "projectable": every property optional (no `required`), `additionalProperties: false` kept, summary-only scalars declared (`attachmentCount`, `invalid`, `errorCount`, `warningCount`, `charCount`, `extractableReason`) — so `structuredContent` always validates against `outputSchema` (MCP 2026-07-28 MUST).

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
    handler: (args: unknown) => Promise<OutputResult | MultiOutputResult | InspectPdfResult | VerifyPdfResult | ExtractTextResult | ValidatePdfResult | ExtractAttachmentsResult | DraftGovernanceIssueResult>;
}
```

A `TOOL_INDEX: ReadonlyMap<string, ToolDefinition>` is derived from the array for O(1) lookup on `CallToolRequest`.

**`_meta` per tool** — emitted in the `ListTools` response so AI clients can introspect:
- `_meta.apiVersion` = `'1.6.0'` (see [`API_STABILITY.md`](API_STABILITY.md) for the bump policy)
- `_meta.examples`   = one or two executable worked examples per tool (tested against `inputSchema`; further examples in `examples/*.json`)

**Server metadata:**
- `SERVER_NAME = 'pdfnative-mcp'`
- `SERVER_VERSION = '1.6.0'`
- `serverInfo` also carries `title`, `description` and `websiteUrl` (= `server.json` `websiteUrl` = `package.json` `homepage`)
- `SERVER_CACHE_HINTS` — MCP 2026-07-28 `ttlMs` / `cacheScope` per method: `tools/list` + `prompts/list` public 24 h, `server/discover` public 1 h, `resources/*` private 0 (2025-era clients never see these fields)
- `serverInfo._meta.mcpName = 'io.github.Nizoka/pdfnative-mcp'` (registry ID in `package.json` `mcpName` / `server.json` `name`; uses the canonical GitHub login casing `Nizoka` so the MCP registry's case-sensitive validation accepts the lowercase npm package `pdfnative-mcp`)
- `SERVER_INSTRUCTIONS` — compact (~5.4 kB) decision tree + common-pitfall guide returned to the client in `serverInfo.instructions`

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
{ "type": "chart",      "chartType": "bar", "series": [{ "label": "...", "values": [1, 2] }], ... }  // same body as add_chart
```

These six are the only block types (`blocks[].type` enum); unknown keys inside a block are rejected by the strict schema. Images, tables and forms are produced by the dedicated tools (`embed_image`, `add_table`, `add_form`), and files by `add_attachment`.

Optional `pdfA: 'pdfa1b' | 'pdfa2b' | 'pdfa2u' | 'pdfa3b'` produces an archival document.
Optional `watermark: { text, fontSize?, opacity?, angle?, color?, position? }` renders a text watermark on every page (`color` is an `[r,g,b]` 0–1 triple; `opacity < 1.0` is rejected under `pdfa1b`). Optional `normalize: 'NFC'|'NFD'|'NFKC'|'NFKD'` applies Unicode normalization (omit for byte-stable output).

**Document features (v1.3.0, threaded from pdfnative v1.4.0):**
- `list` blocks accept nested `items` (a string, or `{ text, items?, style? }` up to 6 levels deep) for multi-level bullet/numbered lists.
- `outline: 'auto' | OutlineNode[]` adds PDF bookmarks. `'auto'` derives the outline from headings; an explicit tree is `[{ title, pageIndex, children?, open? }]` (max depth 6).
- `pageLabels: [{ startPage, style?, prefix?, start? }]` sets viewer page numbering (e.g. roman front-matter then decimal body).
- `viewerPreferences: { pageMode?, pageLayout?, hideToolbar?, hideMenubar?, fitWindow?, displayDocTitle?, … }` maps to the catalog `/ViewerPreferences` + `/PageMode`/`/PageLayout` (e.g. `pageMode: 'useOutlines'` opens the bookmark pane).

**Print production, metadata and PDF/A diagnostics (v1.6.0, pdfnative 1.7)** — shared by every document-producing tool (`generate_basic_pdf`, `add_barcode`, `add_international_text`, `add_table`, `add_form`, `embed_image`, `prepare_signature_placeholder`, `add_attachment`, `add_chart`), via `src/print.ts` and `src/diagnostics.ts`:
- `print: { bleed?, trimBox?, bleedBox?, artBox?, cropBox?, marks?, userUnit? }` — page boxes in points inside the MediaBox; `bleed` derives TrimBox = MediaBox inset (mutually exclusive with `trimBox`); `marks: true | { crop, registration, length, offset, weight }` draws crop / registration marks outside the TrimBox; `userUnit` (1–75000) raises the header to PDF 1.7 and is rejected under `pdfa1b` (`PDF_A_COMPLIANCE_VIOLATION`). Engine rejections → `PRINT_ERROR`.
- `metadata: { author?, subject?, keywords?, trapped? }` — `/Info` (+ XMP under PDF/A), `trapped` ∈ `True | False | Unknown`.
- `creationDate` (ISO-8601, JSON Schema `format: date-time`, Zod `datetime({ offset: true })`) — pins `/Info /CreationDate` (+ XMP dates under PDF/A) and therefore the trailer `/ID`. Output is byte-identical on the **same host time zone** (the engine serialises local time, e.g. `D:20260115100000+01'00'`); set `TZ=UTC` for portability. Mapped by `toPrintLayout()` in `src/print.ts`.
- `outputIntent: { iccProfileBase64, outputConditionIdentifier, registryName?, outputCondition?, info? }` — custom RGB ICC OutputIntent for PDF/A (≤ 8 MiB; non-RGB → `PRINT_ERROR`).
- `embedFonts` (not on `add_international_text`, which always embeds) — Noto Sans Latin instead of the unembedded base-14 Helvetica; required for a valid PDF/A claim (ISO 19005 §6.2.11.4.1).
- `strict` — escalate any engine PDF/A diagnostic (e.g. `PDFA_NO_FONT_ENTRIES`) to `PDF_A_COMPLIANCE_VIOLATION` before bytes are produced.
- `includeDiagnostics` — echo the collected diagnostics as `structuredContent.diagnostics: [{ code, message, severity }]`.
- `viewerPreferences` additionally accepts `duplex`, `pickTrayByPDFSize`, `printPageRange`, `numCopies` (print-dialog defaults).
- All optional and off by default; default outputs stay byte-identical. A diagnostics sink is always installed so the engine never writes to the console (keeps stdio clean).

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

24 scripts via embedded Noto fonts (Arabic, Hebrew, Thai, Japanese/Chinese/Korean, Devanagari, Bengali, Tamil, Telugu, Sinhala, Tibetan, Khmer, Myanmar, Ethiopic, Cyrillic, Greek, Georgian, Armenian, Turkish, Polish, Vietnamese, Latin, …). BiDi isolates + Arabic harakat + complex-script shaping + COLRv1 colour emoji handled automatically. Input is NFC-normalised by default (`normalize` defaults to `'NFC'`; override with `'NFD'`/`'NFKC'`/`'NFKD'`) for maximal glyph coverage, and embedded newlines auto-split into paragraphs. Lang codes added in v1.1.0: `te` (Telugu), `si` (Sinhala), `bo` (Tibetan), `km` (Khmer), `my` (Myanmar), `am` (Ethiopic); the `emoji` code now maps to `noto-color-emoji-data.js` (COLRv1, monochrome fallback). **v1.4.0:** the explicit `math` code maps to `noto-sans-math-data.js` (Noto Sans Math), embedded on demand only when requested (e.g. `lang: ['latin', 'math']`) — there is no global auto-routing.

### `add_table`

Tabular reports with v1.2 smart-table fields: `wrap` (`auto`/`always`/`never`), `repeatHeader`, `zebra`, `caption`, `minRowHeight`, `cellPadding`. Every row must have the same length as `headers`. Optional `infoItems` for a metadata block under the title. Optional `pdfA` for archival output and optional `watermark` (text only; forces the document backend). Since pdfnative v1.3, wrapped cells receive a unique MCID per line, so tagged/PDF-A tables are PDF/UA-safe.

**v1.3.0 additions (pdfnative v1.4.0):** `cellBorders: { top?, right?, bottom?, left?, color?, width? }` for per-edge cell rules, `cellVAlign: 'top' | 'middle' | 'bottom'` for vertical alignment, and `viewerPreferences` (same shape as `generate_basic_pdf`). Any of these forces the document backend.

### `add_form`

Creates a **new** interactive AcroForm with `text`, `textarea`, `checkbox`, `radio`, `dropdown` fields. Optional `blocks[]` rendered before the field group. To read or fill an **existing** form, use `read_form_fields` / `fill_form` (v1.5.0).

> **Known limitation (engine-side):** `add_form` + `pdfA` + `embedFonts: true` still fails PDF/A-2b under veraPDF — the AcroForm `/DR /Helv` is an unembedded Type1 font (ISO 19005-2 rule 6.2.11.4.1). It is a negative canary (`expectCompliant: false`) in the `validate:pdfa` corpus and a candidate upstream issue via `draft_governance_issue`.

### `add_international_text` viewer preferences

Like the other authoring tools, `add_international_text` accepts an optional `viewerPreferences` object (same shape as `generate_basic_pdf`).

### `embed_image`

Single-image PDF (JPEG or PNG). Optional caption / title / explicit width-height (aspect ratio preserved when only one dimension is provided).

### `prepare_signature_placeholder`

Creates a PDF with an unsigned `/Sig` placeholder. **Optional since v1.0.0** — `sign_pdf` auto-injects a placeholder when missing. Use only when you need to customize the placeholder (e.g. larger `placeholderBytes` for >4096-bit RSA keys, or anchor the widget to a specific `pageIndex`). **v1.6.0:** signer metadata (`signerName` / `reason` / `location` / `contactInfo`) is baked into the `/Sig` dictionary at placeholder time (pdfnative < 1.7 silently dropped it, so it never reached the file before); `subFilter: 'adbe.pkcs7.detached' | 'ETSI.CAdES.detached'` is frozen here; `reserveTimestamp: true` adds 8 KiB for an RFC 3161 token; `signingTime` (ISO-8601 with offset) freezes `/Sig /M` at placeholder time. Under `pdfA` the unsigned placeholder (empty `/Contents`) is **not** conformant until signed (ISO 19005-2 6.4.3) — it passes once signed with `sign_pdf profile: 'pades'`; `inspect_pdf` reports the claim, not its validity.

### `sign_pdf`

PAdES-compatible CMS signature. Algorithm: `'rsa-sha256'`, `'rsa-sha384'`, `'rsa-sha512'` (v1.6.0) or `'ecdsa-sha256'` (P-256).

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `pdfBase64` | string | Yes | Any PDF — placeholder auto-injected when missing |
| `algorithm` | enum | Yes | — |
| `certDerBase64` | string | Yes | X.509 cert in DER, base64. PEM → DER: `openssl x509 -in cert.pem -outform DER \| base64 -w0` |
| `rsaKeyPkcs1DerBase64` | string | Cond. | Required for RSA. PKCS#1 DER (`openssl rsa -in key.pem -outform DER -traditional \| base64 -w0`) or PKCS#8 DER (`openssl pkey -in key.pem -outform DER \| base64 -w0`). NOT PEM. |
| `ecPrivateScalarHex` | string | Cond. | OR. 64 hex chars (raw P-256 scalar `d`). |
| `ecPrivateKeyDerBase64` | string | Cond. | OR. SEC1 or PKCS#8 DER. `openssl pkey -in key.pem -outform DER \| base64 -w0`. |
| `autoInjectPlaceholder` | bool | No | Default `true` |
| `signerName` / `reason` / `location` / `contactInfo` | string | No | Embedded in `/Sig` |
| `signingTime` | ISO-8601 | No | Defaults to now. Timezone offsets accepted (`2026-01-15T10:00:00+01:00`); pinned value is byte-identical on the same host time zone only. |
| `profile` | `'pkcs7'` \| `'pades'` | No | v1.6.0. `'pades'` = ETSI EN 319 142-1 baseline (ESS signing-certificate-v2, `/SubFilter /ETSI.CAdES.detached`). Default `'pkcs7'`. |
| `certChainDerBase64` | string[] ≤ 8 | No | v1.6.0. Intermediate certificates embedded in the CMS. |
| `timestamp` | bool | No | v1.6.0. PAdES B-T: RFC 3161 signature timestamp from the operator TSA (`PDFNATIVE_MCP_TSA_URL`); `TSA_NOT_CONFIGURED` otherwise, no network call. |
| `fieldName` | string | No | v1.6.0. Placeholder to sign (required when several are unsigned → `PLACEHOLDER_AMBIGUOUS`; unknown → `SIGNATURE_FIELD_NOT_FOUND`) and name of the injected placeholder. |
| `allowMultiple` | bool | No | v1.6.0. Add a further signature next to already-signed fields (incremental revision; earlier signatures stay valid). Requires `fieldName`. |

Never logs key material. Since v1.3.0 the RSA and EC-DER paths sign through a per-call `node:crypto` provider (`src/crypto-provider.ts`) for constant-time, hardened primitives, transparently falling back to the bundled pure-JS signer when key import fails. The raw-scalar `ecPrivateScalarHex` path always uses the pure-JS signer. "Constant-time" applies to signing with DER keys only — verification (`verify_pdf`: RSA via pdfnative's `rsaVerifyHash`, P-256 via the local verifier) is pure JS. Every base64 / DER input passes `src/base64.ts`: a `data:…;base64,` prefix is tolerated, PEM where DER is expected → `VALIDATION_ERROR` with the exact `openssl` remedy (cert / chain / key parse failures carry the same code + remedy). Signer metadata is baked into the placeholder this call injects (see `prepare_signature_placeholder`). `sign_pdf` is never served from the response cache (every call, not only `timestamp: true`).

### `add_ltv` (v1.6.0)

PAdES B-LT (`src/tools/add-ltv.ts`): embeds a Document Security Store (`/DSS` + per-signature `/VRI`) with certificates and OCSP / CRL material. `mode: 'online'` (default) calls pdfnative `addValidationInfo()` with the **operator-configured** revocation provider from `src/network.ts` (`PDFNATIVE_MCP_REVOCATION` + `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS`; `REVOCATION_NOT_CONFIGURED` otherwise, checked before the document is touched); optional `extraCertificatesDerBase64` (≤ 32) and `preferOcsp`. `mode: 'offline'` calls `embedValidationInfo()` with caller-supplied `certificatesDerBase64` (≤ 64), `ocspResponsesDerBase64` (≤ 64), `crlsDerBase64` (≤ 16) — every blob is parsed first (`LTV_MATERIAL_INVALID`), zero network. An existing `/DSS` is merged; earlier revisions stay byte-identical. Errors: `LTV_NO_SIGNATURE`, `LTV_EMPTY`, `ENCRYPTED_SOURCE` (`decrypt_pdf` would drop the signatures — sign / timestamp the unencrypted document and encrypt last), `LTV_ERROR`. Returns the PDF plus `structuredContent.summary` (`{ mode, signatures, certificates?, ocspResponses?, crls? }`). Never cached.

### `timestamp_pdf` (v1.6.0)

PAdES B-LTA (`src/tools/timestamp-pdf.ts`): appends an RFC 3161 document timestamp (`/Type /DocTimeStamp`, `/SubFilter /ETSI.RFC3161`) over the whole document via pdfnative `addDocumentTimestamp()` and the operator TSA (`TSA_NOT_CONFIGURED` otherwise). Inputs: `pdfBase64`, optional `fieldName` (default `DocTimeStamp1`, auto-suffixed), `placeholderBytes` (4096–65536, default 12288). The token's status, imprint and random 64-bit nonce are checked before embedding (the token's own CMS signature is verified by `verify_pdf`, not here); a rejected response → `TSA_REJECTED`. Encrypted sources → `ENCRYPTED_SOURCE` (timestamp the unencrypted document and encrypt last). Re-run before the TSA certificate expires. Never cached.

### `update_metadata` (v1.6.0)

Rewrites `/Info` (`title`, `author`, `subject`, `keywords` — at least one) of an existing PDF as an incremental update via pdfnative 1.7 `PdfModifier.updateMetadata()` (`src/tools/update-metadata.ts`); XMP stays in sync on PDF/A documents; `/ModDate` **and the XMP dates** are rewritten (pin `modDate` for reproducible bytes — byte-identical on the same host time zone only). Earlier revisions and their signatures are preserved verbatim, but the new revision is unsigned. Encrypted sources → `ENCRYPTED_SOURCE` (run `decrypt_pdf` first — drops signatures/AcroForm — then `encrypt_pdf` again); engine failure → `METADATA_ERROR`. Never cached.

### `verify_pdf`

Read-only verification of every PAdES Baseline / `adbe.pkcs7.detached` / `ETSI.CAdES.detached` signature. For each `/Sig`: recomputes the ByteRange digest (SHA-256/384/512 per the CMS digest algorithm), validates CMS `messageDigest` (integrity) and `signatureValue`. Optional `trustedRootsDerBase64[]` enables chain trust (otherwise per-signature `chainTrust` is `'self-signed'` or `'unverified'`). Optional `password` (v1.5.0) opens an encrypted source. Note pdfnative does not export `ecdsaVerifyHash`, so P-256 ECDSA verification is a local reimplementation in `src/tools/verify-pdf.ts`; verification is pure JS throughout (RSA via pdfnative's `rsaVerifyHash`). A structural failure before the signature checks (ByteRange beyond the file, unsupported EC public-key encoding) → `VERIFY_FAILED`.

**v1.6.0:** `/DocTimeStamp` entries are verified as RFC 3161 tokens (imprint vs ByteRange digest, token SignerInfo vs embedded TSA certificate) and reported with `isDocTimestamp: true`; they count in `allValid` like any signature — sound ⇒ pass, tampered or TSA-untrusted ⇒ fail (before 1.6.0 every document timestamp was parsed as a CMS signature and produced `allValid: false` on B-LTA files). Every signature now carries `subFilter`. `ltv: true` adds the long-term-validation view: per signature `profile` (`pkcs7` | `pades`), `timestamp` (signature timestamp from the unsigned attributes, or `null`), `revocation` (`source`, `status` — read from embedded `/DSS` material only) and `ltvLevel`; document-level `dss`, `ltvLevel` (minimum across non-timestamp signatures) and fixed `caveats` (responder signatures and chain validity at signing time are not evaluated; TSA trust only when its root is in `trustedRootsDerBase64`).

Response shape:
```jsonc
{
  "allValid": true,
  "signatureCount": 1,
  "summary": "1 signature, all valid",
  "signatures": [{
    "valid": true, "integrity": true, "signatureValue": true,
    "fieldName": "Signature1", "subFilter": "ETSI.CAdES.detached",
    "algorithm": "rsa-sha256",
    "signerSubject": "CN=Alice…", "signingTime": "2025-01-…",
    "reason": "…", "location": "…",
    "chainTrust": "self-signed",
    "errors": []
    // ltv:true → "profile", "timestamp", "revocation", "ltvLevel"
  }]
  // ltv:true → "dss", "ltvLevel", "caveats"
}
```

### `inspect_pdf`

Structural / security inspection.
- `version`, `pageCount`, `encryption` (`none|aes-128|aes-256|rc4|unknown`), `pdfA` (`1B|2B|2U|3B|null`)
- `encryptionInfo` — precise `{ algorithm, revision, authenticatedAs }` from `reader.encryption` when encrypted, else omitted (v1.5.0)
- `signatureCount`, `hasSignaturePlaceholder`, `attachments[]`
- `pageLabels[]` — `/PageLabels` ranges (`{ startPage, style?, prefix?, start? }`) when present, else omitted (v1.4.0)
- `/Info` dictionary + optional `perPage` sizes; with `pages: true` each entry also carries `trimBox` / `bleedBox` / `artBox` / `cropBox` / `userUnit` when set on the page (v1.6.0)
- `signatures: true` (v1.6.0) — per-field inventory `{ fieldName, subFilter, isDocTimestamp, isPlaceholder, byteRange, contentsLength, vriKey, … }`
- `dss` (Document Security Store summary), `docTimestampCount`, `trapped` (`True|False|Unknown`) — present only when the document carries them (v1.6.0)
- Optional `password` (v1.5.0) opens an encrypted source transparently; a missing/wrong password → `PASSWORD_REQUIRED`/`PASSWORD_INVALID`.
- Optional `check[]` for CI-style assertions: `'pdfa' | 'signed' | 'encrypted' | 'placeholder' | 'attachments' | 'dss' | 'docTimestamp' | 'trapped'` (last three v1.6.0). `checksPassed` is the AND of all requested checks; `checks` contains **only the requested keys**. `'signed'` is structural — at least one signature field with signed content (an extra unsigned placeholder does not negate it; cryptographic validity is `verify_pdf`'s job); `'pdfa'` reports the claim, not its validity.

### `add_attachment`

PDF/A-3 (ISO 19005-3) with one or more embedded files. **Primary use case: Factur-X / ZUGFeRD invoices** (single XML payload, `relationship: 'Source'`). Each attachment is capped at 8 MiB. Optional `blocks[]` for the visible body.

### `extract_attachments`

Read-only counterpart to `add_attachment` — walks the catalog name tree (`/Names → /EmbeddedFiles → Names[]`) via the shared `collectEmbeddedFiles()` collector (same metadata as `inspect_pdf`) and returns `{ attachmentCount, attachments: [{ name, sizeBytes?, mimeType?, relationship?, description?, dataBase64? }] }`. `includeData` (default `true`) toggles payload bytes; `filename` filters to one file (`ATTACHMENT_NOT_FOUND` when nothing matches). Payloads are capped at 16 MiB/file and 32 MiB aggregate (`OUTPUT_TOO_LARGE`). Since v1.5.0 encrypted PDFs are read with an optional `password` (missing/wrong → `PASSWORD_REQUIRED`/`PASSWORD_INVALID`). Completes the Factur-X round-trip.

### `validate_pdf`

Read-only **PDF/UA (ISO 14289-1)** structural conformance check wrapping pdfnative's `validatePdfUA()`. Verifies catalog `/MarkInfo /Marked true`, `/StructTreeRoot` (+ `/ParentTree`), `/Metadata` (XMP), `/Lang`, and per-page MCID uniqueness. Returns `{ standard: 'pdf-ua-1', valid, errors[], warnings[], summary }`; an unparsable input → `PDF_PARSE_FAILED` (no longer `{ valid: false }`). A fast developer-time gate — **not** a substitute for a full reference validator (veraPDF), which additionally checks fonts, colour and rendering. Typical flow: generate a document with `pdfA` (e.g. `pdfa2u`), then `validate_pdf` the result.

### `extract_text`

Unicode text extraction backed by pdfnative v1.6.0's `extractText()` (`src/tools/extract-text.ts`). Decodes each font's `/ToUnicode` CMap, `/Encoding /Differences`, and WinAnsi/MacRoman base tables, recursing Form XObjects — so subset fonts decode to real characters, not glyph indices. Returns `{ pageCount, extractedPageCount, extractable, extractableReason?, pages: [{ index, text, runs? }], fullText }`. Optional inputs: `includeRuns` (adds per-page positioned `runs[]` of `{ text, x, y, fontSize, fontName }`), `password` (encrypted PDFs), `maxTextLength` (memory cap, default 16 000 000). `extractable: false` now means a page decoded entirely to U+FFFD (a font with no usable mapping) — still not an error.

### `merge_pdfs`

Concatenates 2–50 source PDFs into one via pdfnative's page-tree API (`src/tools/merge-pdfs.ts`). Page boxes (TrimBox / BleedBox / ArtBox / CropBox) and `/UserUnit` are preserved per page (v1.6.0, also by `split_pdf` / `extract_pages`). Inputs: `pdfsBase64[]` (2–50), optional `dropAnnotations`, `maxOutputSizeBytes`, `password` (decrypt every encrypted source), `encrypt` (re-secure the output; AES-128/256), plus the shared `outputMode`/`outputPath`. Returns a single `OutputResult`. Signatures/AcroForm are always dropped by a page-tree edit. Since v1.5.0 encrypted sources are accepted with a `password`; a missing/wrong password yields `PASSWORD_REQUIRED`/`PASSWORD_INVALID`; oversize output → `OUTPUT_TOO_LARGE` (shared `src/pagetree.ts` mapping, which delegates encryption failures to `src/encryption.ts`).

### `split_pdf`

Splits one PDF into one document per page range (`src/tools/split-pdf.ts`). Inputs: `pdfBase64`, `ranges: [{ start, end? }]` (0-based inclusive; `end` defaults to `start`; validated `end >= start`), optional `dropAnnotations`, `maxOutputSizeBytes`, `password`, `encrypt`. Returns a **`MultiOutputResult`** — one part per range. In `file` mode the `outputPath` is indexed (`report.pdf` → `report-1.pdf`, `report-2.pdf`, …).

### `extract_pages`

Pulls an arbitrary page subset into a single PDF (`src/tools/extract-pages.ts`). Inputs: `pdfBase64`, `pages: number[]` (0-based, max 5000, order preserved), optional `dropAnnotations`, `maxOutputSizeBytes`, `password`, `encrypt`. Returns a single `OutputResult`. Out-of-range indices / ranges (also on `merge_pdfs` / `split_pdf`) → `VALIDATION_ERROR` with a "0-based" hint; a password-protected source without a password → `PASSWORD_REQUIRED`. The page-tree tools never raise `ENCRYPTED_SOURCE`.

### `annotate_pdf`

Overlays markup annotations on an existing PDF via pdfnative's incremental-update annotation writer (`src/tools/annotate-pdf.ts`). Inputs: `pdfBase64`, `annotations: [{ type, page, rect, color?, contents?, … }]`, plus the shared `outputMode`/`outputPath`. Types: `text` (sticky note), `highlight`, `underline`, `strikeout`, `squiggly`, `square`, `circle`, `line`, `freetext` — each mapped to a typed `MarkupAnnotation` union by `toMarkupAnnotation()`. `page` is 0-based and bounds-checked; `rect` is `[x1, y1, x2, y2]` in PDF points. This is a **visual overlay, not a redaction** — the underlying content bytes are untouched. Encrypted sources are rejected with `ENCRYPTED_SOURCE` (run `decrypt_pdf` first — drops signatures/AcroForm — then `encrypt_pdf` again).

### `draft_governance_issue`

Drafts a governance-compliant GitHub issue **locally** for human review (`src/tools/draft-governance-issue.ts`). It performs **no** network I/O (the server's only possible egress is the operator-configured TSA / OCSP / CRL endpoints, §8) and never submits — the agent is a draftsman, a human is the only gate. Inputs: `title`, `issueType` (`bug|feature|security|docs|performance`), `summary`, `reproduction: { command, result }`, `expectedBehavior`, optional `actualBehavior`, `targetRepo` (default `pdfnative-mcp`), `affectedPackages` (default `['pdfnative-mcp']`), `duplicateSearchPerformed` (**must be `true`**), plus `outputMode` (`'inline'|'file'`) / `outputPath`. Returns `{ draftMarkdown, complianceReport, … }`. Contract enforcement lives in `src/governance.ts` (`validateIssueMarkdown`): proposing a runtime dependency, omitting the reproduction, or `duplicateSearchPerformed: false` throws `GovernanceError('GOVERNANCE_VIOLATION')`. In `file` mode the draft `.md` is written through `writeSandboxedText()` (same sandbox guards as PDF output, `.md` extension). The contract source of truth is under `.github/` (`ai-governance.json`, `AGENT_RULES.md`); the narrative guide is [`guides/AI_GOVERNANCE.md`](guides/AI_GOVERNANCE.md).

### `read_form_fields`

Read-only enumeration of an existing AcroForm's field tree via pdfnative v1.6.0's `readFormFields()` (`src/tools/read-form-fields.ts`). Inputs: `pdfBase64`, optional `password`, `verbosity`/`fields`. Returns `{ fieldCount, fields: [{ name, type, value, readOnly, required, multiline, options?, maxLen?, onState?, widgets: [{ pageIndex, rect }] }] }`. `type` is one of `text|checkbox|radio|dropdown|listbox|button|signature|unknown`. Routed by a dedicated `dispatchOutput` discriminator (`'fieldCount' in output`). Call it before `fill_form` to discover field names.

### `fill_form`

Fill and/or flatten an existing AcroForm via pdfnative's `fillForm()`/`flattenForm()` (`src/tools/fill-form.ts`). Inputs: `pdfBase64`, `values` (map of field name → string | boolean | string[]), optional `flatten`, `onUnknownField` (`throw|ignore`), `nonWinAnsi` (`throw|needAppearances`), `password`, plus the shared `outputMode`/`outputPath`. Non-destructive incremental update (a prior signature stays valid for its revision). A pure flatten is `flatten:true` with no `values`. Signature fields are not fillable → `FORM_UNSUPPORTED`; unknown names → `FORM_FIELD_NOT_FOUND` (the message points to `read_form_fields` / `onUnknownField: 'ignore'`); type/option mismatch → `FORM_VALUE_TYPE_ERROR` (mapped in-file).

### `add_chart`

Native vector chart via pdfnative's `ChartBlock` (`src/tools/add-chart.ts`, shared schema in `src/chart.ts`). Inputs: `chartType` (`bar|barH|stackedBar|stackedBarH|line|area|scatter|pie|donut`), `series: [{ label, values[], color?, xValues?, yAxis? }]`, optional `categories`, `title`, `intro`, `legend`, `axis` (`yMin`, `yMax`, `ticks`, `grid`, `scale: 'linear'|'log'`), `axis2` (secondary right axis, drawn when a series sets `yAxis: 'right'`), `xAxis` (`type: 'category'|'linear'|'time'`, `min`, `max`, `ticks`, `grid`), `dataLabels` (`true` or `{ decimals, prefix, suffix }`), `labelStride` (default automatic non-overlap thinning; `1` draws every label), `labelRotation`, `markers`, `colors` (hex), `align`, `altText`, `width`, `height`, `pdfA`, print / PDF/A options, plus `outputMode`/`outputPath`. **Charts v2 (pdfnative 1.7):** stacked kinds, area, scatter (needs `xValues` + positional `xAxis`), log scale (strictly positive, non-stacked), UTC-deterministic time axis (ISO-8601 / epoch ms). The schemas validate shapes and bounds only; cross-field rules are enforced by the engine and surface as `CHART_ERROR` with the remedy (also for the `generate_basic_pdf` `chart` block). Rendered as pure PDF path operators with a tagged `/Figure` + `/Alt` (auto when omitted). Pie/donut use one series. `generate_basic_pdf` accepts a `chart` block (same `toChartBlock` mapper).

### `encrypt_pdf`

Re-secure a PDF with the Standard Security Handler via the page-tree `encrypt` path (`src/tools/encrypt-pdf.ts`, on `mergePdfs` single-source). Inputs: `pdfBase64`, `ownerPassword` (required), optional `userPassword`, `algorithm` (`aes128` default / `aes256`), `permissions`, `password` (rotate an already-encrypted source), plus `outputMode`/`outputPath`. RC4 is never emitted. **Caveat:** rebuilding the page tree drops signatures + AcroForm — encrypt before signing.

### `decrypt_pdf`

Emit an unencrypted copy of an encrypted PDF (`src/tools/decrypt-pdf.ts`, on `mergePdfs` single-source with no `encrypt`). Inputs: `pdfBase64`, optional `password` (omit only for empty-user-password documents), plus `outputMode`/`outputPath`. Supports RC4 (V1–V4), AES-128 (V4/R4), AES-256 (V5/R6). Same page-tree-rebuild caveat as `encrypt_pdf`. To merely *read* an encrypted PDF, pass `password` to `inspect_pdf`/`extract_text`/… instead.

### MCP resources

Generated PDFs written in `outputMode:'file'` are exposed as native MCP resources (`src/resources.ts`). `resources/list` walks the `PDFNATIVE_MCP_OUTPUT_DIR` sandbox and returns `pdfnative://output/<relative>.pdf` URIs (resource template `pdfnative://output/{+path}`, RFC 6570 reserved expansion); `resources/read` returns the base64 blob after re-validating the path through `resolveSandboxedPath` (traversal/extension guards); an unknown URI → JSON-RPC `-32602` carrying `UNKNOWN_RESOURCE`. PDF-producing tools also emit a `resource_link` content block in file mode. When file output is disabled, there are no resources. Capability advertised as `resources: {}`.

### MCP prompts

The server advertises the `prompts` capability (`ListPrompts` / `GetPrompt`). Six prompts (`PROMPTS` in `src/server.ts`):
- `governance_contract` — the full governance contract the agent must honour (from `src/governance.ts`).
- `draft_issue_workflow` — the step-by-step recipe for using `draft_governance_issue`.
- `pades_ladder` — sign a PDF and raise it to B-T / B-LT / B-LTA, including operator configuration and how to verify each level.
- `print_ready` — page boxes / bleed, printer marks, `/UserUnit`, metadata and a custom OutputIntent, with the PDF/A interactions.
- `reproducible_output` — which inputs to pin (`creationDate`, `signingTime`, `modDate`), what stays non-deterministic (timestamps, encryption), and how to prove it.
- `pdfa_valid` — a PDF/A claim that passes a reference validator: `embedFonts`, strict diagnostics, level choice, attachments under PDF/A-3, and what `inspect_pdf` can and cannot tell you.

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
    diagnostics?: ToolDiagnostic[];   // v1.6.0 — only when includeDiagnostics=true
    summary?: Record<string, unknown>; // v1.6.0 — tool-specific (add_ltv material counts)
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

### Text output (`writeSandboxedText`)

`draft_governance_issue` in `file` mode writes its `.md` draft through `writeSandboxedText(text, outputPath, '.md')`, which reuses `resolveSandboxedPath()` (now parameterised on the allowed extension) so the draft is subject to the exact same sandbox guards as PDF output (relative path, no traversal, no NUL, enforced extension).

---

## 6. Caching ([src/cache.ts](../src/cache.ts))

An opt-in, content-addressed on-disk cache for tool results. Disabled by default; set `PDFNATIVE_MCP_CACHE_DIR` to enable it. Key = SHA-256 of the canonical JSON `{ tool, apiVersion, input }`, where `apiVersion` is `TOOL_API_VERSION/PDFNATIVE_MCP_VERSION` (engine lock-step, so an upgrade never serves bytes rendered by the previous engine). Entries live 1 h (TTL) under a 256 MiB cap with LRU eviction by mtime; every I/O error degrades to a miss. A hit returns the **earlier** call's bytes (e.g. the old `/CreationDate`) with `_meta.cached: true` added to the result. Never cached: file-mode calls, `encrypt_pdf` / `decrypt_pdf` (plaintext at rest), `sign_pdf` (every call — the wall-clock `signingTime`, TSA tokens and key material must never feed a persisted entry), and the time- or network-dependent `add_ltv`, `timestamp_pdf`, `update_metadata`.

---

## 7. Error Types ([src/errors.ts](../src/errors.ts))

```typescript
class ToolError extends Error {
    code: string;  // e.g. 'VALIDATION_ERROR', 'PDF_PARSE_FAILED', 'MISSING_PLACEHOLDER', 'OUTPUT_TOO_LARGE',
                   //      'PASSWORD_REQUIRED', 'PASSWORD_INVALID', 'ENCRYPTED_SOURCE', 'VERIFY_FAILED'
                   // v1.6.0: 'TSA_NOT_CONFIGURED', 'TSA_REJECTED', 'REVOCATION_NOT_CONFIGURED',
                   //      'NETWORK_HOST_NOT_ALLOWED', 'NETWORK_ERROR', 'LTV_NO_SIGNATURE', 'LTV_EMPTY',
                   //      'LTV_MATERIAL_INVALID', 'LTV_ERROR', 'PLACEHOLDER_AMBIGUOUS',
                   //      'SIGNATURE_FIELD_NOT_FOUND', 'PRINT_ERROR', 'METADATA_ERROR', 'GENERATION_FAILED'
                   // legacy, never raised: 'EXTRACTION_UNSUPPORTED' (encrypted reads take `password`)
                   // full table (44 codes): AGENTS.md §6 / AI_GUIDE.md §5
}
class SecurityError extends ToolError {
    code = 'SECURITY_VIOLATION';
}
class GovernanceError extends ToolError {
    code = 'GOVERNANCE_VIOLATION';   // draft_governance_issue contract breach
}
```

`ToolError` → MCP `CallToolResult` with `isError: true`, message in `content[0].text`.
Unhandled errors → logged to stderr, generic message returned.
Protocol-level (JSON-RPC errors, not tool results): `tools/call` with an unknown tool name → `-32602` with message `[UNKNOWN_TOOL] Unknown tool: <name>` (`callToolDirect`, in-process, keeps `isError`); `resources/read` with an unknown URI → `-32602` carrying `UNKNOWN_RESOURCE`.

---

## 8. Transport & Environment

Two transports are supported. Default = stdio. Set `PDFNATIVE_MCP_PORT` to expose a Streamable HTTP endpoint on `http://127.0.0.1:<port>/mcp` instead.

> **MCP protocol version.** Since v1.6.0 the server is built on the MCP TypeScript SDK v2
> (`@modelcontextprotocol/server` ^2.0.0, replacing `@modelcontextprotocol/sdk` 1.x) and speaks
> **MCP 2026-07-28**: stateless serving (`server/discover` instead of a session handshake;
> over HTTP a fresh `Server` per request), `resultType` on every result, `ttlMs` / `cacheScope`
> cache hints (`SERVER_CACHE_HINTS`), the `_meta` `serverInfo` envelope, `Mcp-Method` /
> `Mcp-Name` headers on HTTP, and resource-not-found reported as `-32602`. Clients that open
> with `initialize` (`2025-11-25`, `2025-06-18`, `2025-03-26`) are served by the SDK's
> automatic legacy fallback (`legacy: 'serve'` on stdio, `legacy: 'stateless'` on HTTP), so
> Claude Desktop, Cursor, Continue, Zed, ChatGPT and other existing hosts keep working
> unchanged. HTTP `GET` / `DELETE` answer 405 (no SSE resumability). The low-level `Server` +
> `setRequestHandler` surface is used deliberately: `McpServer.registerTool` would validate
> `structuredContent` against `outputSchema` and break the hand-written JSON Schemas, the
> `verbosity` / `fields` projections and the `isError` contract. `serverInfo` carries a
> human-readable `title` + `description` (mirroring `server.json`), tool inputs/outputs are
> JSON Schema **2020-12**, and Zod validation errors surface as tool-execution errors
> (`isError: true`) so a model can self-correct. `tests/http-modern.test.ts` asserts the
> 2026-07-28 conformance and that the `tools/call` payload equals the legacy path.

| Variable | Required | Description |
|----------|----------|-------------|
| `PDFNATIVE_MCP_OUTPUT_DIR` | No | Absolute path of the allowed output sandbox. File output disabled if unset. |
| `PDFNATIVE_MCP_CACHE_DIR`  | No | Absolute path for the persistent cache. Cache disabled if unset. |
| `PDFNATIVE_MCP_PORT`       | No | When set to a valid port (1–65535), switches the transport to Streamable HTTP. Unset = stdio. |
| `PDFNATIVE_MCP_HTTP_TOKEN` | No | HTTP only, secret. Bearer token (≥ 16 chars, no whitespace; a weaker value aborts startup). When set, every `/mcp` request must carry `Authorization: Bearer <token>` or gets 401 + `WWW-Authenticate: Bearer realm="pdfnative-mcp", error="invalid_token"` with a JSON-RPC `-32600` body; compared constant-time (SHA-256 + `timingSafeEqual`), never logged. Unset = no authentication (loopback bind + Host/Origin guard only) — recommended whenever other local processes are untrusted. |
| `PDFNATIVE_MCP_TSA_URL`    | No | v1.6.0. Absolute `http(s)` URL of the RFC 3161 TSA (`sign_pdf timestamp: true`, `timestamp_pdf`). Unset = `TSA_NOT_CONFIGURED`, no request. |
| `PDFNATIVE_MCP_TSA_AUTH`   | No | v1.6.0, secret. Optional `Authorization` header value for the TSA; never logged or echoed. |
| `PDFNATIVE_MCP_REVOCATION` | No | v1.6.0. `ocsp` \| `crl` \| `ocsp,crl` — enables `add_ltv mode: 'online'`. Unset = `REVOCATION_NOT_CONFIGURED`. |
| `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS` | No | v1.6.0. Comma-separated allow-list (`host`, `host:port`, `*.suffix`) for OCSP / CRL responders; mandatory with `PDFNATIVE_MCP_REVOCATION`. |
| `PDFNATIVE_MCP_NETWORK_TIMEOUT_MS` | No | v1.6.0. Per-request timeout, 1000–120000 (default 10000). |

> Historical note: pre-v1.0.0 used a misspelled env var (`PDFNATIVE_MPC_OUTPUT_DIR`). v1.0.0 standardized on `PDFNATIVE_MCP_OUTPUT_DIR`; the typo is still honoured as a deprecated alias (one startup warning). Update any old config.

### Privacy & data handling

- **No telemetry; no network egress by default.** The only outbound requests the server can
  ever make go to the RFC 3161 / OCSP / CRL endpoints the operator configured in the environment
  (PAdES long-term validation, `src/network.ts`) — never to a URL supplied by a tool argument,
  never to GitHub, never for telemetry. Certificate-advertised OCSP / CRL URLs pass an SSRF guard
  (allow-list, `http(s)` only, no embedded credentials, no redirects, loopback / link-local /
  private / CGNAT / multicast literals rejected unless allow-listed verbatim, response caps of
  256 KiB / 1 MiB / 16 MiB, per-request timeout). Providers are built per call; the process-wide
  pdfnative provider setters are never used. Document bytes never leave the process except in the
  JSON-RPC response to the caller (a timestamp request carries only a digest).
- **Transit.** stdio (default) is a local pipe to the parent process. The opt-in
  HTTP transport (`PDFNATIVE_MCP_PORT`) binds **`127.0.0.1`** only **and** enables the SDK's
  **DNS-rebinding protection**: the `Host` and `Origin` headers are pinned to the loopback
  authority (`127.0.0.1:<port>` / `localhost:<port>`), so a malicious web page that reaches the
  port via a rebound DNS name is rejected with **403** (MCP Security Best Practices). Without
  `PDFNATIVE_MCP_HTTP_TOKEN` the HTTP endpoint has **no authentication** — any local process can
  reach it — so set the token whenever that matters. Client-disconnect detection hangs off the
  per-request response (`res.once('close')`), so keep-alive connections do not accumulate socket
  listeners. Terminate TLS in a reverse proxy if you expose it beyond localhost.
- **Attachments are passed through verbatim.** `add_attachment` embeds, and
  `extract_attachments` returns, payload bytes **as-is** — the server does **not**
  execute, render, or virus-scan embedded files. Treat extracted content as untrusted
  and scan it in the caller if it originates from an untrusted PDF.
- **No secret retention.** Key/cert material supplied to `sign_pdf` is used in-memory
  for the single call and never logged, cached, or echoed in errors. The
  `PDFNATIVE_MCP_TSA_AUTH` header value is likewise never echoed (network errors report only
  the error class / status).

---

## 9. Adding a New Tool

1. Create `src/tools/my-tool.ts` exporting:
   - `MY_TOOL_NAME`, `MY_TOOL_INPUT_SCHEMA`, optional `MY_TOOL_OUTPUT_SCHEMA`
   - Zod `InputSchema` mirroring the JSON Schema
   - `myTool(args: unknown): Promise<OutputResult | …>` handler
2. Register in [src/server.ts](../src/server.ts) (`TOOLS` array, `SERVER_INSTRUCTIONS` decision tree, `_meta.examples`).
3. Add tests in `tests/`: happy path (base64), file output, validation errors, security errors when applicable. Refresh the catalogue fingerprint (`node scripts/tool-shape.mjs --write`) so `tests/catalogue-parity.test.ts` passes, and review the structural diff under `API_STABILITY.md` §5.
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
npm run validate:pdfa    # advisory: veraPDF over a generated PDF/A corpus (skips without veraPDF; mirrored by the non-blocking verapdf.yml CI job)
```

Vitest coverage thresholds: see `vitest.config.ts` (raised in v1.6.0 to `statements 89` / `branches 80` / `functions 90` / `lines 91`).

---

## 11. Security Design Notes

- **No file read** — tools never read files from disk; only write (when sandbox configured).
- **Input validation** — every tool validates with strict Zod before calling `pdfnative` (unknown keys rejected). Invalid inputs → `ToolError`, not unhandled exceptions.
- **HTTP authentication** — opt-in bearer token (`src/auth.ts`, `PDFNATIVE_MCP_HTTP_TOKEN`), constant-time comparison, never logged; without it the loopback endpoint is unauthenticated.
- **Key material** — `sign_pdf` never echoes key or cert bytes in logs or error messages.
- **Egress** — confined to `src/network.ts`; URLs come only from the operator environment (TSA) or from certificates filtered through the allow-list (OCSP / CRL). Tool arguments can never name a host.
- **Path traversal** — `resolveSandboxedPath` uses `path.relative` to verify the resolved path stays within the sandbox.
- **NUL bytes** — explicitly rejected in output paths.
- **Absolute paths** — rejected (relative only).
- **Size cap** — 50 MB limit on output PDF prevents memory exhaustion.
- **Strict TypeScript** — `noImplicitAny`, `strict: true`; `unknown` + narrowing throughout; `Zod` at all external boundaries.

See [`guides/PDFA.md`](guides/PDFA.md) and [`AI_GUIDE.md`](AI_GUIDE.md) for usage-oriented notes.
