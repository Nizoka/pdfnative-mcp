# Encryption guide (for AI agents)

Since pdfnative-mcp v1.5.0 (pdfnative's Standard Security Handler) the server can **read**
encrypted PDFs, **decrypt** them, and **re-encrypt** with AES. RC4 is decrypted on
read but **never emitted** for new output.

## Decide what you actually need

| You want to… | Do this (no rebuild) | Or (rebuilds page tree) |
| --- | --- | --- |
| Read metadata of an encrypted PDF | `inspect_pdf` + `password` | — |
| Extract text from an encrypted PDF | `extract_text` + `password` | — |
| Extract attachments / verify signatures | `extract_attachments` / `verify_pdf` + `password` | — |
| Get an unencrypted copy | — | `decrypt_pdf` |
| Protect a PDF | — | `encrypt_pdf` |
| Merge/split encrypted sources, re-secure output | — | `merge_pdfs` / `split_pdf` / `extract_pages` with `password` + `encrypt` |

> **Prefer the "no rebuild" column when you only need to *read*.** `decrypt_pdf`,
> `encrypt_pdf` and the page-tree tools rebuild the page tree, which **drops
> signatures and the interactive AcroForm** (a page-tree edit invalidates
> `/ByteRange`). Encrypt **before** signing, never after.

## Passwords

- A document with an **empty user password** (owner-only) opens **without** a `password`.
- A document with a **user password** needs it. Missing → `PASSWORD_REQUIRED`; wrong → `PASSWORD_INVALID`.
- Both the user and owner password are tried, so either opens the document.

## Encrypt

```jsonc
{ "tool": "encrypt_pdf", "arguments": {
  "pdfBase64": "<pdf>",
  "ownerPassword": "owner-secret",   // required
  "userPassword": "open-me",          // optional; empty = opens without a prompt
  "algorithm": "aes256",              // 'aes128' (default) or 'aes256'
  "permissions": { "print": true, "copy": false, "modify": false, "extractText": true }
}}
```

- **Password rotation**: pass the current `password` of an already-encrypted source plus the new `ownerPassword`/`userPassword` to re-secure it in one call.
- `inspect_pdf` reports the precise cipher in `encryptionInfo` (`{ algorithm, revision, authenticatedAs }`).

## Round-trip in one call

`merge_pdfs` / `split_pdf` / `extract_pages` compose decryption and re-encryption:
pass `password` to ingest encrypted sources and `encrypt` to protect the result
(the passwords can differ — this is *open → edit → re-secure*).

```jsonc
{ "tool": "merge_pdfs", "arguments": {
  "pdfsBase64": ["<enc A>", "<enc B>"],
  "password": "shared-open",
  "encrypt": { "ownerPassword": "new-owner", "userPassword": "new-open", "algorithm": "aes128" }
}}
```

## Error codes

| Code | Meaning |
| --- | --- |
| `PASSWORD_REQUIRED` | Encrypted source, no `password` supplied. |
| `PASSWORD_INVALID` | Supplied `password` did not open the document. |
| `ENCRYPTION_UNSUPPORTED` | The document uses a security handler this server cannot open. |
| `ENCRYPTION_ERROR` | Re-encryption failed (e.g. no Web Crypto CSPRNG available). |
| `ENCRYPTED_SOURCE` | Encrypted input on one of the four incremental-update tools that have no `password` input (v1.6.0). The remedy depends on the tool: **`annotate_pdf` / `update_metadata`** → `decrypt_pdf` first (drops signatures and the AcroForm), edit, then `encrypt_pdf` again. **`add_ltv` / `timestamp_pdf`** → do *not* decrypt — `decrypt_pdf` would destroy the signatures you are trying to extend; sign, add LTV and timestamp the unencrypted document, and run `encrypt_pdf` last. The page-tree tools (`merge_pdfs` / `split_pdf` / `extract_pages`) and the read tools take `password` and never raise this code. |

The legacy `EXTRACTION_UNSUPPORTED` code is no longer raised: encrypted reads take `password`.

## Base64 boundary

`pdfBase64` (and the page-tree `pdfsBase64`) tolerate a `data:application/pdf;base64,`
prefix. An empty payload is a `VALIDATION_ERROR`; PEM text, a nested `data:` URI or a
double-encoded base64 string is reported as `PDF_PARSE_FAILED` with a hint naming the
likely cause, rather than as a mysterious parse failure.

## Caching

`encrypt_pdf` and `decrypt_pdf` always bypass the opt-in response cache
(`PDFNATIVE_MCP_CACHE_DIR`): the cache stores tool output in plaintext at rest, and
neither the unencrypted bytes of a deliberately-protected document nor the freshly
protected bytes (minted with a random IV / salt, so never reproducible anyway) should
linger on disk. The same applies to the page-tree tools in file mode (no file-mode call
is ever cached).

## Safety notes

- Passwords are never logged or echoed back in responses or errors.
- RC4 is read-only: any output this server writes is AES-128 or AES-256.
- PDF/A forbids encryption. The server does not need to enforce a conflict because the
  two never meet: the document tools have no `encrypt` input, and `encrypt_pdf` (like
  the page-tree `encrypt` option) rebuilds the document without the XMP packet, so any
  PDF/A claim on the source is dropped rather than carried into an encrypted file.
