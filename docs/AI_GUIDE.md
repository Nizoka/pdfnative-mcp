# AI Agent Guide — pdfnative-mcp

> **Read this first if you are an AI agent (Copilot, Claude, Cursor, Continue, Zed, Windsurf, Cline, Roo Code, …) about to call pdfnative-mcp.**
> It tells you which of the 12 tools to pick and how to avoid the common retry loops.

The server also returns the same decision tree in `serverInfo.instructions`. The full reference lives in [`KNOWLEDGE_BASE.md`](KNOWLEDGE_BASE.md); the stability charter in [`API_STABILITY.md`](API_STABILITY.md). Worked invocations are in [`../examples/`](../examples).

---

## 1. Decision tree — pick the right tool in one step

| You want to… | Tool |
|---|---|
| A plain document (headings, paragraphs, lists) | `generate_basic_pdf` |
| A QR code or barcode | `add_barcode` |
| Non-Latin text (Arabic, Hindi, CJK, …) | `add_international_text` |
| A tabular report | `add_table` |
| An interactive AcroForm | `add_form` |
| Embed a JPEG/PNG into a PDF | `embed_image` |
| Digitally sign any PDF | `sign_pdf` *(auto-injects placeholder)* |
| Customize the signature placeholder before signing | `prepare_signature_placeholder` → `sign_pdf` |
| **Factur-X / ZUGFeRD invoice** or any PDF with attachments | `add_attachment` *(NOT `generate_basic_pdf`)* |
| Inspect / assert metadata | `inspect_pdf` |
| Verify all PAdES signatures | `verify_pdf` |
| Extract plain text | `extract_text` |

---

## 2. Common pitfalls (these cause the most retries)

### Barcodes / QR codes
- `data` is the **raw** payload. To produce a QR pointing at `https://google.com`, send `{ "format": "qr", "data": "https://google.com" }` — **do not** URL-encode the URL.
- `ecLevel` (`L`/`M`/`Q`/`H`) applies **only** when `format='qr'`. It is silently ignored for `code128`, `ean13`, `datamatrix`, `pdf417`.
- Use `ecLevel: 'H'` for printed media that may be smudged or partially covered (e.g. logo overlay).
- `ean13` requires **12 or 13 digits**. Pass 12, the 13th check digit is auto-computed.

### Digital signing
- `sign_pdf` **auto-injects** a `/Sig` placeholder when missing (since v1.0.0). You can sign **any** PDF in a single call — no need to run `prepare_signature_placeholder` first.
- All key/cert material is **DER, base64-encoded** (no PEM). Convert with:
  - cert: `openssl x509 -in cert.pem -outform DER | base64 -w0` → `certDerBase64`
  - RSA key (PKCS#1!): `openssl rsa -in key.pem -outform DER -traditional | base64 -w0` → `rsaKeyPkcs1DerBase64`
  - ECDSA key (PKCS#8 or SEC1): `openssl pkey -in key.pem -outform DER | base64 -w0` → `ecPrivateKeyDerBase64`
  - ECDSA scalar form: `ecPrivateScalarHex` = 64 hex chars (raw P-256 `d`)
- After signing, call `verify_pdf` to confirm. Without `trustedRootsDerBase64`, `chainTrust` is `'self-signed'` or `'unverified'` — that is expected.

### Attachments (Factur-X / ZUGFeRD)
- Use `add_attachment`, **not** `generate_basic_pdf`. The latter cannot embed files.
- The output is PDF/A-3b. PDF/A-3 is the only PDF/A part that permits embedded files.
- Per-attachment cap: 8 MiB. Use `relationship: 'Source'` for the structured invoice XML.

### PDF/A
- Pass `pdfA: 'pdfa2b'` for the widest reader compatibility.
- Use `pdfa3b` when (and only when) you have attachments.
- See [`guides/PDFA.md`](guides/PDFA.md) for the per-tool capability matrix.

### Text extraction
- `extract_text` returning `extractable: false` is **not an error**. The PDF uses subset fonts without `/ToUnicode` CMaps; the `extractableReason` field explains. The file is not corrupt.
- Encrypted PDFs are rejected with `EXTRACTION_UNSUPPORTED`.

### File output mode
- `outputMode: 'file'` only works if the host process set `PDFNATIVE_MCP_OUTPUT_DIR`. Otherwise the call returns `SecurityError`.
- `outputPath` must be **relative**, end in `.pdf`, and contain no path traversal segments.

---

## 3. Self-documenting metadata

Every tool ships:
- `_meta.apiVersion` = `'1.0.0'` — see [`API_STABILITY.md`](API_STABILITY.md).
- `_meta.examples`   — at least one worked example per tool. Inspect the `ListTools` response to discover them.

You can rely on these fields when negotiating capabilities before calling a tool.

---

## 4. When things still fail

The MCP error response always includes a `code` and a message:

| `code` | Meaning | Fix |
|---|---|---|
| `VALIDATION_ERROR` | Zod rejected the input | Re-read the field’s schema (the message lists the offending path). |
| `PDF_PARSE_FAILED` | Input PDF is malformed or truncated | Re-encode the base64; verify the source PDF opens in a normal reader. |
| `MISSING_PLACEHOLDER` | `sign_pdf` called with `autoInjectPlaceholder: false` on a PDF without `/Sig` | Set `autoInjectPlaceholder: true` (the default) or call `prepare_signature_placeholder` first. |
| `EXTRACTION_UNSUPPORTED` | Encrypted PDF passed to `extract_text` | Decrypt the PDF outside the server first. |
| `OUTPUT_TOO_LARGE` | Generated PDF over 50 MiB | Reduce embedded images or split into multiple documents. |
| `SECURITY_VIOLATION` | Sandbox or path-traversal rejection | Check `PDFNATIVE_MCP_OUTPUT_DIR` is set and `outputPath` is relative + ends in `.pdf`. |

If a tool seems to return correct PDFs that downstream readers reject, run `inspect_pdf` and / or `verify_pdf` to confirm the byte-level structure.
