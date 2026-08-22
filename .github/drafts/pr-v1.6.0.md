# PR: v1.6.0 — PAdES LTV, print production, charts v2, MCP 2026-07-28, pdfnative 1.7

## Summary

A minor, fully backward-compatible release that aligns the server with
[pdfnative v1.7.0](https://github.com/Nizoka/pdfnative) and the
[MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
specification, and grows the catalogue to **27 tools**. It completes the **PAdES
baseline ladder** (B-B → B-T → B-LT → B-LTA: `sign_pdf` timestamps, `add_ltv`,
`timestamp_pdf`, `verify_pdf ltv`), adds **print production** (page boxes, bleed,
printer's marks, `/Trapped`, `/UserUnit`, OutputIntent), **charts v2**
(stacked / area / scatter, secondary axis, log and time scales), honest **PDF/A
diagnostics** with `embedFonts`, and `update_metadata`. The transport moves to the
**MCP SDK v2** line: 2026-07-28 clients get the stateless protocol
(`server/discover`, `resultType`, cache hints, `_meta.serverInfo`), 2025-era hosts
keep working through the automatic legacy fallback. The server stays **offline by
default** — the only egress it can ever perform goes to operator-configured
TSA / OCSP / CRL endpoints behind an SSRF guard.

Full notes: [`release-notes/v1.6.0.md`](../../release-notes/v1.6.0.md).

## Scope

| Phase | Subject |
| --- | --- |
| 0 | Branch `release/v1.6.0`; deps `pdfnative ^1.7.0`, `@modelcontextprotocol/sdk` → `@modelcontextprotocol/server ^2.0.0`, `zod ^4.2.0`; `npm audit fix`; lock-step bump to 1.6.0; `TOOL_API_VERSION` → 1.6.0 |
| 1 | MCP 2026-07-28 on SDK v2: low-level `Server` + method-string handlers, `SERVER_CACHE_HINTS`, `-32602` resource-not-found, `src/http.ts` node:http bridge + loopback guard, `serveStdio` / `createMcpHandler` with legacy fallback; in-memory test harness replaces SDK-private `_requestHandlers`; legacy + modern HTTP conformance tests; stdio smoke (JSON-only stdout) |
| 2 | Crypto agility (SHA-256/384/512) in provider, CMS parser, `verify_pdf`; PAdES markers (ESS signing-certificate-v2, timestamp token) |
| 3 | Shared modules `src/diagnostics.ts`, `src/print.ts`, print viewer preferences; `print` / `outputIntent` / `metadata` / `strict` / `includeDiagnostics` / `embedFonts` on all 9 document tools; page boxes preserved through page-tree tools |
| 4 | Charts v2 schema (`src/chart.ts`) + engine-validated cross-field rules → `CHART_ERROR` |
| 5 | `inspect_pdf` signatures / DSS / boxes / trapped; `verify_pdf` DocTimeStamp verification + `ltv` view |
| 6 | `src/network.ts` (operator-configured providers, SSRF guard); `sign_pdf` PAdES profile / timestamp / multi-signature / chain; `prepare_signature_placeholder` metadata baking, `subFilter`, `reserveTimestamp` |
| 7 | New tools `add_ltv`, `timestamp_pdf`, `update_metadata`; cache predicate for time-dependent calls |
| 8 | Test fixtures: offline mock PKI, loopback RFC 3161 server; end-to-end ladder tests through the tools |
| 9 | Governance charter (network), veraPDF advisory corpus + workflow, docs matrix, examples, release notes, this draft |

## Closes

- Roadmap: ships the **PAdES LTV ladder** (previously blocked upstream), **print production**, **charts v2**, **PDF/A diagnostics**, **MCP 2026-07-28**, **colour-emoji sequences** and `update_metadata`.
- `redact_pdf` stays **deferred by design** (pdfnative 1.7.0 exports no content-removal API). `verify_pdf` keeps its local P-256 verifier (`ecdsaVerifyHash` still not exported). HTTP page streaming remains blocked (no partial `structuredContent` in 2026-07-28). The telemetry hook is intentionally not part of this release.

## Quality gate

<!-- QUALITY_GATE -->

## Byte-identity evidence

Method: fixed inputs per tool, PDF bytes normalised for `/CreationDate`, XMP dates and the trailer `/ID` (wall-clock values the MCP does not expose), SHA-256 compared between `main` (v1.5.0, pdfnative 1.6.0, SDK 1.29) and this branch.

| Tool (input) | Result | Reason (pdfnative 1.7.0 release notes, *Upgrade*) |
| --- | --- | --- |
| generate_basic_pdf (plain / chart block) | identical | — |
| generate_basic_pdf (`pdfA: pdfa2b`) | changed | tagged base-14 docs emit the shared WinAnsi `/ToUnicode` CMap |
| add_barcode, add_table, embed_image, add_chart | identical | — |
| add_international_text (ar / he / latin) | changed | UAX #9 fixes: RTL digit order, mirroring, ALEF joining |
| add_form, fill_form | changed | AcroForm `/Helv` gains `/ToUnicode` in every mode |
| prepare_signature_placeholder, annotate_pdf | changed | incremental writer: `/ID[1]` regenerated + EOL framing |
| add_attachment (pdfa3b) | changed | tagged base-14 `/ToUnicode` (as above) |
| inspect_pdf, verify_pdf, extract_text, validate_pdf, extract_attachments, read_form_fields, draft_governance_issue | identical | — |
| merge_pdfs, split_pdf, extract_pages, decrypt_pdf | identical | — |
| encrypt_pdf | changed | non-deterministic by design (random IV / salt) |
| sign_pdf | n/a | needs key material; covered by real sign → verify round-trips for every algorithm |

No unexpected byte change. The SDK v2 migration itself is byte-transparent: `tools/call` results are deep-equal between the in-memory legacy transport and the 2026-07-28 HTTP path (`tests/http-modern.test.ts`).

## Changes summary

### Added
- **Tools** `add_ltv` (PAdES B-LT, online via the operator revocation provider or offline from parse-validated caller material), `timestamp_pdf` (PAdES B-LTA `/DocTimeStamp` through the operator TSA), `update_metadata` (incremental `/Info` + XMP rewrite).
- **`sign_pdf`** — `profile: 'pades'`, `timestamp: true` (B-T), rsa-sha384 / rsa-sha512, `certChainDerBase64`, `fieldName`, `allowMultiple`; errors `PLACEHOLDER_AMBIGUOUS`, `SIGNATURE_FIELD_NOT_FOUND`, `TSA_REJECTED`.
- **`prepare_signature_placeholder`** — `subFilter`, `reserveTimestamp`; signer metadata now baked into `/Sig`.
- **`verify_pdf`** — DocTimeStamp verification, `subFilter`, opt-in `ltv` view with explicit caveats. **`inspect_pdf`** — `signatures`, `dss`, `docTimestampCount`, `trapped`, page boxes, new `check` values.
- **Print production / PDF/A** on every document tool: `print`, `outputIntent`, `metadata`, `strict`, `includeDiagnostics`, `embedFonts`; print-dialog `viewerPreferences`; errors `PRINT_ERROR`, `GENERATION_FAILED`.
- **Charts v2** fields on `add_chart` and the `chart` block.
- **MCP 2026-07-28** transport (SDK v2) with legacy fallback; `SERVER_CACHE_HINTS`; `src/http.ts`.
- **Network policy** `src/network.ts` + five env vars; errors `TSA_NOT_CONFIGURED`, `REVOCATION_NOT_CONFIGURED`, `NETWORK_HOST_NOT_ALLOWED`, `NETWORK_ERROR`, `LTV_*`, `METADATA_ERROR`.
- **veraPDF advisory** — `npm run validate:pdfa`, `scripts/generate-pdfa-corpus.mjs`, `.github/workflows/verapdf.yml` (non-blocking in 1.6.0, to become blocking in 1.7.0).
- **Tests / fixtures** — mock PKI, loopback TSA, MCP harness, HTTP fixture; coverage thresholds raised to 89 / 80 / 90 / 91.
- **Docs** — guides `LTV.md`, `PRINT.md`; nine new examples; cross-repo follow-up draft `.github/drafts/issue-v1.6.0-ecosystem.md`.

### Changed
- `pdfnative` `^1.6.0` → `^1.7.0`; MCP SDK 1.x → `@modelcontextprotocol/server` ^2.0.0 (+ core); `zod ^4.2.0`. Three runtime deps, no hono / express / jose in the tree.
- `_meta.apiVersion` 1.5.0 → 1.6.0; versions lock-stepped to 1.6.0.
- Governance charter: no egress by default; operator-configured TSA / OCSP / CRL only; never a URL from tool arguments (`ai-governance.json`, `AGENT_RULES.md`, governance prompts).
- HTTP GET / DELETE on `/mcp` answer 405 (stateless serving).

### Fixed
- Signer metadata never reached the `/Sig` dictionary (pdfnative < 1.7 dropped it).
- `verify_pdf` reported `allValid: false` on every B-LTA document (DocTimeStamp parsed as a CMS signature).
- PDF/A guide claimed base-14 fonts were embedded.

## Reviewer notes

- **Thin-wrapper fidelity:** LTV assembly, box validation and chart rules live in pdfnative; the server only maps inputs, injects the operator-configured transport and maps errors. `verify_pdf ltv` reads embedded material only and says so in `caveats`.
- **No new runtime dependency** — `pdfnative`, `@modelcontextprotocol/server`, `zod`.
- **Default outputs** — opt-in everywhere; the two default-output additions (`verify_pdf.subFilter`, extra `false` keys in `inspect_pdf.checks` when `check` is used) are documented in `docs/API_STABILITY.md` §5.
- **Secrets** — `PDFNATIVE_MCP_TSA_AUTH` is never logged or echoed (asserted); signing keys and passwords never enter `structuredContent` or the cache (LTV / timestamp / metadata tools and `sign_pdf timestamp:true` bypass the cache).

## Review protocol

<!-- REVIEW_PROTOCOL -->

## Post-merge checklist (human)

1. `git tag v1.6.0 <merge-sha> && git push origin v1.6.0`.
2. GitHub Release: title from `release-notes/v1.6.0.md`, body = the notes.
3. Watch `publish.yml` (OIDC Trusted Publishing) → `npm view pdfnative-mcp@1.6.0`.
4. Publish the MCP registry entry from `server.json` (manual step, see `.github/instructions/release.instructions.md`).
5. Open the cross-repo ecosystem issue from `.github/drafts/issue-v1.6.0-ecosystem.md` in `Nizoka/pdfnative` (human-submitted per the governance charter).
