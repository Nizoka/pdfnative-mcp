# PR: v1.0.0 — first stable release

## Summary

Consolidates the deferred v0.4 → v1.0 roadmap into a single major release. Adds three new tools (`verify_pdf`, `add_attachment`, `extract_text`), six smart-table fields on `add_table`, ECDSA PKCS#8 DER signing support, `inspect_pdf` parity (placeholder + attachments), an opt-in content-addressed cache, and MCP `_meta.apiVersion` + per-tool examples. Built on [pdfnative v1.2.0](https://github.com/Nizoka/pdfnative/releases/tag/v1.2.0).

Full notes: [`release-notes/v1.0.0.md`](../../release-notes/v1.0.0.md).

## Scope (10 atomic commits)

| Commit | Phase | Subject |
| --- | --- | --- |
| c16aec7 | 1 | Foundation upgrade — pdfnative 1.2.0, shared PDF/A helper, placeholder collapse |
| d4a3ec8 | 2 | Env-var typo fix `PDFNATIVE_MCP_OUTPUT_DIR` + deprecation alias |
| b7ca341 | 3 | Signing ergonomics — autoInjectPlaceholder + ECDSA PKCS#8 DER |
| 6b4748d | 4 | `verify_pdf` tool — CMS + RSA + ECDSA (self-contained, no external openssl) |
| (commit 5) | 5 | Smart tables + `add_attachment` + `extract_text` |
| 769fb8e | 6 | `inspect_pdf` parity — `hasSignaturePlaceholder` + `attachments[]` |
| (commit 7) | 7 | Opt-in content-addressed cache |
| dffbb92 | 8 | MCP `_meta.apiVersion` + per-tool examples + PDF/A guide |
| (commit 9) | 9 | Security & supply-chain hardening (CITATION, FUNDING, badges) |
| (commit 10) | 10 | Indexing, samples, docs, release artefacts |

## Closes

- pdfnative#45 — X.509 SubjectPublicKeyInfo unwrapping (consumed via dependency bump)
- pdfnative#46 — `addSignaturePlaceholder` helper (consumed via dependency bump)
- All v0.4 / v0.5 / v1.0 roadmap items except `merge_pdfs` / `split_pdf` / `redact_pdf` (deferred to v1.1)

## Quality gate

- ✅ `npm run typecheck:all` — 0 errors
- ✅ `npm run lint` — 0 errors
- ✅ `npm run test` — 148/148 passing across 17 files
- ✅ `npm run test:coverage` — 89.09 / 76.13 / 98.29 / 92.06 (stmts / branches / funcs / lines), all ≥ vitest thresholds
- ✅ `npm run build` — clean dist

## Deferred (with rationale)

- **`merge_pdfs` / `split_pdf` / `redact_pdf`** — pdfnative v1.2 does not yet export page-tree manipulation primitives. Shipping `501` stubs would weaken the v1.0 API surface.
- **Per-tool HTTP page-by-page streaming** — MCP `structuredContent` requires full bytes; `StreamableHTTPServerTransport` already chunks the response.
- **Encrypted-PDF round-trip fixtures** — would require implementing the PDF Standard Security Handler in pdfnative. `classifyEncryption` is refactored as a pure helper so unit tests cover every branch.

## Reviewer checklist

- [ ] CHANGELOG.md v1.0.0 entry mirrors `release-notes/v1.0.0.md`
- [ ] `package.json` version === SERVER_VERSION === `1.0.0`
- [ ] Tool count assertion in `tests/server.test.ts` equals 12
- [ ] Every tool exposes `_meta.apiVersion === '1.0.0'` and a non-empty `_meta.examples` array
- [ ] `server.json` validates against the MCP registry schema
- [ ] `llms.txt` is present at repo root and listed in `package.json.files`
- [ ] Examples in `examples/*.json` parse as JSON and reference valid tool names
- [ ] Upgrade guide in `release-notes/v1.0.0.md` covers the env-var rename
- [ ] No new `any` types in `src/`
- [ ] No CodeQL alerts
