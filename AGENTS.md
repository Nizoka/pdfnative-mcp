# AGENTS.md — pdfnative-mcp

Operations manual for AI agents. Two audiences:

1. **Agents *using* the server** (Copilot, Claude, Cursor, Cline, …) — read §1–§6.
2. **Agents *contributing* to this repo** — read §7.

The server also returns the §1 decision tree in `serverInfo.instructions`. Deeper
references: [docs/AI_GUIDE.md](docs/AI_GUIDE.md) (pitfalls + recipes),
[docs/KNOWLEDGE_BASE.md](docs/KNOWLEDGE_BASE.md) (architecture),
[docs/API_STABILITY.md](docs/API_STABILITY.md) (versioning charter). Worked
invocations live under [examples/](examples/).

---

## 1. Tool catalogue (24 tools)

| # | Tool | Use it for | Read-only |
|---|------|-----------|:---:|
| 1 | `generate_basic_pdf` | Plain documents (headings, paragraphs, nested lists, **`chart` blocks**). Optional `pdfA`, `watermark`, `normalize`, `outline` (bookmarks), `pageLabels`, `viewerPreferences`. | |
| 2 | `add_barcode` | QR / Code 128 / EAN-13 / Data Matrix / PDF417. | |
| 3 | `add_international_text` | 24 scripts + colour emoji, BiDi + OpenType shaping. Optional `normalize` (default `NFC`), `viewerPreferences`. | |
| 4 | `add_table` | Tabular reports (wrap, repeatHeader, zebra, caption, `cellBorders`, `cellVAlign`…). Optional `watermark`, `viewerPreferences`. | |
| 5 | `add_form` | Create a **new** interactive AcroForm (text, checkbox, radio, dropdown). | |
| 6 | `read_form_fields` | Enumerate an **existing** AcroForm's fields (name, type, value, widgets). Supports `password`. | ✓ |
| 7 | `fill_form` | Fill / flatten an **existing** AcroForm (incremental update). Supports `password`. | |
| 8 | `add_chart` | Native vector charts (bar / barH / line / pie / donut), PDF/A-safe. | |
| 9 | `embed_image` | Embed a JPEG/PNG into a titled PDF. | |
| 10 | `prepare_signature_placeholder` | Customize the `/Sig` placeholder before signing. | |
| 11 | `sign_pdf` | PAdES CMS signature (RSA-SHA256 / ECDSA-P256), constant-time via `node:crypto`. Auto-injects a placeholder. | |
| 12 | `verify_pdf` | Verify every PAdES signature (integrity + value + chain). Supports `password`. | ✓ |
| 13 | `validate_pdf` | PDF/UA (ISO 14289-1) structural conformance. | ✓ |
| 14 | `inspect_pdf` | Metadata: version, pages, encryption (+ `encryptionInfo`), PDF/A, signatures, attachments. Supports `password`. | ✓ |
| 15 | `add_attachment` | PDF/A-3 with embedded files (Factur-X / ZUGFeRD). | |
| 16 | `extract_attachments` | Read embedded files back out (byte-for-byte). Supports `password`. | ✓ |
| 17 | `extract_text` | Unicode text extraction (resolves `/ToUnicode`), optional positioned `runs`. Supports `password`. | ✓ |
| 18 | `merge_pdfs` | Concatenate 2–50 PDFs into one (page-tree API). Optional `password` / `encrypt`. | |
| 19 | `split_pdf` | Split a PDF into one document per page range (multi-output). Optional `password` / `encrypt`. | |
| 20 | `extract_pages` | Pull an arbitrary page subset into a single PDF. Optional `password` / `encrypt`. | ✓¹ |
| 21 | `encrypt_pdf` | Re-secure a PDF with AES-128 / AES-256 (owner/user passwords, permissions, rotation). | |
| 22 | `decrypt_pdf` | Emit an unencrypted copy of an RC4 / AES-128 / AES-256 document. | |
| 23 | `annotate_pdf` | Add markup annotations (highlight, sticky note, square/circle, line, freetext). Visual overlay only — does **not** redact underlying content. | |
| 24 | `draft_governance_issue` | Draft a governance-compliant GitHub issue for **human** review. Produces a local draft + compliance report; **never submits**, no network. | ✓² |

¹ `extract_pages` only reads the source, but it produces a new PDF, so it is not annotated `readOnlyHint`.
² `draft_governance_issue` is read-only in the default inline mode; `outputMode:'file'` writes a `.md` into the sandbox, so its `readOnlyHint` is `false`.

## 2. Decision tree

```
Need a NEW PDF?
 ├─ has embedded files (Factur-X/ZUGFeRD)? → add_attachment
 ├─ a chart (bar/line/pie/donut)?          → add_chart
 ├─ a table/report?                        → add_table
 ├─ non-Latin text / emoji?                → add_international_text
 ├─ a barcode/QR?                          → add_barcode
 ├─ an image?                              → embed_image
 ├─ a NEW interactive form?                → add_form
 └─ otherwise                              → generate_basic_pdf  (supports `chart` blocks)
Work with an EXISTING form?
 ├─ list its fields?                       → read_form_fields
 └─ fill / flatten it?                     → fill_form
Annotate an existing PDF (overlay)?       → annotate_pdf
Combine / carve existing PDFs?
 ├─ join several into one?                 → merge_pdfs   (password / encrypt optional)
 ├─ split into per-range documents?        → split_pdf    (password / encrypt optional)
 └─ keep an arbitrary page subset (1 PDF)? → extract_pages (password / encrypt optional)
Encryption?
 ├─ protect a PDF?                         → encrypt_pdf
 ├─ get an unencrypted copy?               → decrypt_pdf
 └─ just READ an encrypted PDF?            → pass `password` to inspect_pdf / extract_text / …
Need to SIGN?            → sign_pdf  (then verify_pdf)
Need to READ a PDF?      (all accept `password` for encrypted sources)
 ├─ metadata/structure?  → inspect_pdf
 ├─ signatures valid?    → verify_pdf
 ├─ PDF/UA conformant?   → validate_pdf
 ├─ embedded files?      → extract_attachments
 ├─ form fields?         → read_form_fields
 └─ plain text (+runs)?  → extract_text
Propose a bug/feature to GitHub? → draft_governance_issue (local draft; a human reviews & submits)
```

## 3. Token-frugal responses

Read-only tools (`inspect_pdf`, `verify_pdf`, `validate_pdf`, `extract_text`,
`extract_attachments`) accept two optional inputs (defaults unchanged):

- `verbosity: 'summary'` — compact scalar verdict; drops heavy arrays / full text.
- `fields: ['a', 'b.c']` — dot-path projection (array segments map over elements),
  applied **after** `verbosity`; unknown paths omitted leniently.

Smallest "signed & valid?" probe: `{ pdfBase64, verbosity: 'summary', fields: ['allValid'] }`.

Generated PDFs (base64 mode) are delivered **once** as an embedded `resource`
content block (`data:application/pdf;base64,…`), not duplicated into
`structuredContent` (which is `{ mode, sizeBytes }`).

## 4. Output modes & environment

- `outputMode: 'base64'` (default) — bytes in the `resource` block.
- `outputMode: 'file'` — writes inside `PDFNATIVE_MCP_OUTPUT_DIR`. `outputPath`
  must be **relative**, end in `.pdf`, no traversal / absolute paths / NUL bytes.
- `PDFNATIVE_MCP_OUTPUT_DIR` — sandbox root for file output (unset = file mode disabled).
- `PDFNATIVE_MCP_CACHE_DIR` — opt-in SHA-256 cache (1 h TTL, 256 MiB LRU).

**Privacy:** no telemetry, no outbound network calls — document bytes only ever
flow back in the JSON-RPC response. The optional HTTP transport
(`PDFNATIVE_MCP_PORT`) binds `127.0.0.1` only and enables DNS-rebinding
protection (foreign `Host`/`Origin` → 403). Embedded files are passed through
verbatim — the server never executes, renders, or scans them, so scan untrusted
attachments in the caller.

## 5. Recipes

- **Factur-X round-trip:** `add_attachment` → `inspect_pdf` → `extract_attachments` → *(optional)* `validate_pdf`.
- **Sign & verify:** `sign_pdf` → `verify_pdf` (add `trustedRootsDerBase64` for chain trust).
- **Author PDF/A:** `generate_basic_pdf` / `add_table` with `pdfA: 'pdfa2b'` → `validate_pdf`.
- **Watermarked report:** `add_table` with `watermark: { text: 'CONFIDENTIAL', opacity: 0.2 }`.
- **Bookmarked report:** `generate_basic_pdf` with `outline: 'auto'` + `pageLabels` + `viewerPreferences: { pageMode: 'useOutlines' }`.
- **Assemble / carve:** generate parts → `merge_pdfs`; or `split_pdf` (per range) / `extract_pages` (one subset) → `inspect_pdf` to confirm the page count.
- **Annotate for review:** `annotate_pdf` with `{ type: 'highlight' }` / `{ type: 'text' }` overlays — a visual review layer, **not** a redaction (underlying bytes remain).
- **Math / scientific text:** `add_international_text` with `lang: ['latin', 'math']` — `math` is an **explicit** script, embedded only when requested (no global auto-routing).
- **Chart:** `add_chart` for a standalone chart, or a `chart` block inside `generate_basic_pdf` to compose one with text/tables.
- **Fill a form:** `read_form_fields` (discover names) → `fill_form` with `values` (+ `flatten: true` for a final copy).
- **Encryption round-trip:** `encrypt_pdf` to protect, `decrypt_pdf` to recover, or pass `password` to a read-only tool to read an encrypted PDF without rebuilding it. `merge_pdfs`/`split_pdf`/`extract_pages` compose `password` (in) + `encrypt` (out).
- **Propose an upstream change:** `draft_governance_issue` → review the local `.md` draft + compliance report → a **human** submits it to GitHub (the server never does).

## 6. Error reference

| `code` | Meaning | Fix |
|--------|---------|-----|
| `VALIDATION_ERROR` | Zod rejected the input | Re-read the field schema (message lists the path). |
| `PDF_PARSE_FAILED` | Input PDF malformed/truncated | Re-encode the base64; confirm it opens in a reader. |
| `PDF_A_COMPLIANCE_VIOLATION` | Watermark `opacity < 1.0` (incl. 0.15 default) under `pdfA:'pdfa1b'` | Use `opacity:1.0`, or target `pdfa2b`/`pdfa3b` (allow transparency). |
| `MISSING_PLACEHOLDER` | `sign_pdf` w/ `autoInjectPlaceholder:false` on unplaceheld PDF | Keep the default `true`, or run `prepare_signature_placeholder`. |
| `PASSWORD_REQUIRED` | Encrypted source, no `password` supplied (read-only or page-tree tools) | Pass the `password` input (user or owner). |
| `PASSWORD_INVALID` | Supplied `password` did not open the document | Check the password; either user or owner works. |
| `ENCRYPTION_UNSUPPORTED` | Security handler this server cannot open | The document uses an unsupported scheme. |
| `ENCRYPTION_ERROR` | Re-encryption failed (e.g. no Web Crypto CSPRNG) | Run under a runtime with Web Crypto available. |
| `FORM_FIELD_NOT_FOUND` | `fill_form` value key matched no field | Use `read_form_fields`, or `onUnknownField:'ignore'`. |
| `FORM_VALUE_TYPE_ERROR` | Wrong value type / choice not in options | Match the field type; use a valid option. |
| `FORM_UNSUPPORTED` | Tried to fill/flatten a signature field | Sign with `sign_pdf` instead. |
| `CHART_ERROR` | `add_chart` failed to render | Check `series`/`chartType`; hex colours only. |
| `EXTRACTION_UNSUPPORTED` | (legacy) retained for compatibility | Encrypted reads now use `password` instead. |
| `ENCRYPTED_SOURCE` | Retained by `annotate_pdf` (no `password` input) | Decrypt with `decrypt_pdf` first, or use a password-aware tool. |
| `ATTACHMENT_NOT_FOUND` | `extract_attachments` `filename` matched nothing | Drop `filename` or list names via `inspect_pdf`. |
| `ATTACHMENT_TOO_LARGE` | `add_attachment` payload > 8 MiB | Shrink/split the payload. |
| `OUTPUT_TOO_LARGE` | PDF > 50 MiB, or extraction > 16 MiB/file · 32 MiB total | Reduce content; for extraction use `includeData:false` or `filename`. |
| `UNSUPPORTED_LANG` | `add_international_text` `lang` unknown | Use a supported code. |
| `FONT_LOAD_FAILED` | Bundled font module failed to load | Retry; reinstall `pdfnative` if persistent. |
| `SIGNING_FAILED` · `CMS_PARSE_FAILED` · `EC_KEY_PARSE_FAILED` · `EC_CURVE_UNSUPPORTED` | Signing / key-cert problem | Check DER encodings; ECDSA must be P-256. |
| `SECURITY_VIOLATION` | Sandbox / path-traversal rejection | Set `PDFNATIVE_MCP_OUTPUT_DIR`; use a relative `.pdf` path. |
| `GOVERNANCE_VIOLATION` | `draft_governance_issue` draft breaks the AI-governance contract (proposes a runtime dependency, missing reproduction, or `duplicateSearchPerformed:false`) | Remove the dependency proposal, include a reproduction, confirm the duplicate search. |

## 7. Contributing to this repo

- Conventions and architecture: [.github/copilot-instructions.md](.github/copilot-instructions.md)
  and the scoped rules under [.github/instructions/](.github/instructions/).
- Strict TypeScript (no `any`); validate every tool input at the boundary with Zod,
  keeping the hand-written JSON Schema and the Zod schema aligned.
- Never write outside `PDFNATIVE_MCP_OUTPUT_DIR`; never echo key/cert material in
  errors or logs.
- Quality gate (all PRs):

  ```
  npm run typecheck:all && npm run lint && npm run test && npm run test:coverage && npm run build
  ```

- Releases: `release-notes/vX.Y.Z.md` is mandatory and mirrored into `CHANGELOG.md`;
  publish is via GitHub Actions Trusted Publishing (OIDC) — no `NPM_TOKEN`.
