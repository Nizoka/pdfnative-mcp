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

## 1. Tool catalogue (14 tools)

| # | Tool | Use it for | Read-only |
|---|------|-----------|:---:|
| 1 | `generate_basic_pdf` | Plain documents (headings, paragraphs, lists). Optional `pdfA`, `watermark`, `normalize`. | |
| 2 | `add_barcode` | QR / Code 128 / EAN-13 / Data Matrix / PDF417. | |
| 3 | `add_international_text` | 24 scripts + colour emoji, BiDi + OpenType shaping. Optional `normalize` (default `NFC`). | |
| 4 | `add_table` | Tabular reports (wrap, repeatHeader, zebra, caption…). Optional `watermark`. | |
| 5 | `add_form` | Interactive AcroForms (text, checkbox, radio, dropdown). | |
| 6 | `embed_image` | Embed a JPEG/PNG into a titled PDF. | |
| 7 | `prepare_signature_placeholder` | Customize the `/Sig` placeholder before signing. | |
| 8 | `sign_pdf` | PAdES CMS signature (RSA-SHA256 / ECDSA-P256). Auto-injects a placeholder. | |
| 9 | `verify_pdf` | Verify every PAdES signature (integrity + value + chain). | ✓ |
| 10 | `validate_pdf` | PDF/UA (ISO 14289-1) structural conformance. | ✓ |
| 11 | `inspect_pdf` | Metadata: version, pages, encryption, PDF/A, signatures, attachments. | ✓ |
| 12 | `add_attachment` | PDF/A-3 with embedded files (Factur-X / ZUGFeRD). | |
| 13 | `extract_attachments` | Read embedded files back out (byte-for-byte). | ✓ |
| 14 | `extract_text` | Best-effort plain-text extraction (non-encrypted). | ✓ |

## 2. Decision tree

```
Need a NEW PDF?
 ├─ has embedded files (Factur-X/ZUGFeRD)? → add_attachment
 ├─ a table/report?                        → add_table
 ├─ non-Latin text / emoji?                → add_international_text
 ├─ a barcode/QR?                          → add_barcode
 ├─ an image?                              → embed_image
 ├─ an interactive form?                   → add_form
 └─ otherwise                              → generate_basic_pdf
Need to SIGN?            → sign_pdf  (then verify_pdf)
Need to READ a PDF?
 ├─ metadata/structure?  → inspect_pdf
 ├─ signatures valid?    → verify_pdf
 ├─ PDF/UA conformant?   → validate_pdf
 ├─ embedded files?      → extract_attachments
 └─ plain text?          → extract_text
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

## 5. Recipes

- **Factur-X round-trip:** `add_attachment` → `inspect_pdf` → `extract_attachments` → *(optional)* `validate_pdf`.
- **Sign & verify:** `sign_pdf` → `verify_pdf` (add `trustedRootsDerBase64` for chain trust).
- **Author PDF/A:** `generate_basic_pdf` / `add_table` with `pdfA: 'pdfa2b'` → `validate_pdf`.
- **Watermarked report:** `add_table` with `watermark: { text: 'CONFIDENTIAL', opacity: 0.2 }`.

## 6. Error reference

| `code` | Meaning | Fix |
|--------|---------|-----|
| `VALIDATION_ERROR` | Zod rejected the input | Re-read the field schema (message lists the path). |
| `PDF_PARSE_FAILED` | Input PDF malformed/truncated | Re-encode the base64; confirm it opens in a reader. |
| `MISSING_PLACEHOLDER` | `sign_pdf` w/ `autoInjectPlaceholder:false` on unplaceheld PDF | Keep the default `true`, or run `prepare_signature_placeholder`. |
| `EXTRACTION_UNSUPPORTED` | Encrypted PDF to `extract_text` / `extract_attachments` | Decrypt outside the server first. |
| `ATTACHMENT_NOT_FOUND` | `extract_attachments` `filename` matched nothing | Drop `filename` or list names via `inspect_pdf`. |
| `ATTACHMENT_TOO_LARGE` | `add_attachment` payload > 8 MiB | Shrink/split the payload. |
| `OUTPUT_TOO_LARGE` | PDF > 50 MiB, or extraction > 16 MiB/file · 32 MiB total | Reduce content; for extraction use `includeData:false` or `filename`. |
| `UNSUPPORTED_LANG` | `add_international_text` `lang` unknown | Use a supported code. |
| `FONT_LOAD_FAILED` | Bundled font module failed to load | Retry; reinstall `pdfnative` if persistent. |
| `SIGNING_FAILED` · `CMS_PARSE_FAILED` · `EC_KEY_PARSE_FAILED` · `EC_CURVE_UNSUPPORTED` | Signing / key-cert problem | Check DER encodings; ECDSA must be P-256. |
| `SECURITY_VIOLATION` | Sandbox / path-traversal rejection | Set `PDFNATIVE_MCP_OUTPUT_DIR`; use a relative `.pdf` path. |

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
