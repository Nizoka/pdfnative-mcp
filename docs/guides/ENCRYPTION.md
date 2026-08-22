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
| `ENCRYPTED_SOURCE` | Encrypted input on a tool without a `password` input: `annotate_pdf`, `update_metadata`, `add_ltv`, `timestamp_pdf` (v1.6.0). Run `decrypt_pdf` first. |

## Safety notes

- Passwords are never logged or echoed back in responses or errors.
- RC4 is read-only: any output this server writes is AES-128 or AES-256.
- `pdfA` and encryption are mutually exclusive (PDF/A forbids encryption).
