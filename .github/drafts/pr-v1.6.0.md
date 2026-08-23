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

Measured on the final branch state (Windows 11, Node 22.17) — CI repeats it on ubuntu with Node 22 and 24.

- `npm run typecheck:all` — 0 errors
- `npm run lint` — 0 errors (33 `no-non-null-assertion` style warnings: 26 pre-existing on `main`, 7 in the new CMS / verify paths)
- `npm run test:coverage` — **800 tests / 63 files** passing (1 skipped — environment-gated); **92.6** stmts / **83.5** branches / **98.5** funcs / **94.7** lines (thresholds raised to 89 / 80 / 90 / 91)
- `npm run build` — clean `dist/`; `tests/cli-stdio.test.ts` drives the built CLI over stdio (legacy handshake, 2026-07-28 `server/discover` probe, 11 MiB frame); `tests/catalogue-parity.test.ts` asserts `tools/list` matches the structural fixture (`tests/_fixtures/tool-shape.json`) — tools/list ≈ 174 kB (was ≈ 206 kB), instructions 5.4 kB (was 12.9 kB)
- `npm run examples:check` — every `examples/*.json` references a live tool and passes a field-by-field schema walk; placeholder-free examples execute end-to-end and multi-step examples are chained step by step (each `<base64 from step N>` placeholder substituted with the previous step's output; steps needing key material stay documentation-only); every `_meta.examples[].input` validates against its `inputSchema` (`tests/schema-conformance.test.ts`)
- `npm audit --audit-level=high` — 0 vulnerabilities; lockfile contains no `hono` / `express` / `jose` / `@modelcontextprotocol/sdk`
- `npm pack --dry-run` — 230 files, 300.2 kB (1.4 MB unpacked): `dist/`, `LICENSE`, `README.md`, `CHANGELOG.md`, `server.json`, `llms.txt`, `package.json` only
- `npm run validate:pdfa` — corpus of **24 files** (22 claiming PDF/A, of which 3 negative canaries `expectCompliant: false`; 2 page-tree outputs with no claim); outcomes `PASS` / `FAIL` / `XFAIL` / `XPASS` / `INFRA` / `SKIP`; `VERAPDF_REQUIRED=1` fails closed (exit 3) when veraPDF is unusable; the `verapdf.yml` job runs the real validator (SHA-256-pinned installer, `VERAPDF_REQUIRED=1`) and stays non-blocking in 1.6.0. Known engine gaps recorded as canaries: `add_form` + `embedFonts` (unembedded `/DR /Helv`, 6.2.11.4.1) and the unsigned placeholder (6.4.3)
- Byte-identity diff vs `main` (table below) — no unexpected change

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
| inspect_pdf, verify_pdf, extract_text, validate_pdf, extract_attachments, read_form_fields | identical | — |
| draft_governance_issue | changed | `HUMAN_GATE` charter text inside the draft markdown and `complianceReport.humanGate` (deliberate charter update; report shape unchanged) |
| merge_pdfs, split_pdf, extract_pages, decrypt_pdf | identical | — |
| encrypt_pdf | changed | non-deterministic by design (random IV / salt) |
| sign_pdf | n/a | needs key material; covered by real sign → verify round-trips for every algorithm. Default placeholder size is now `max(16384, estimateContentsSize(cert, alg))` — identical for signer certificates ≤ ~10 KB, larger beyond; a pinned `signingTime` now lands in `/Sig /M` when the call injects the placeholder |

No unexpected byte change. The table was produced with a scratchpad baseline script (v1.5.0 checkout, fixed inputs) — there is no in-repo reproduction script for it; `creationDate` / `signingTime` now make the date normalisation unnecessary for a future run. The SDK v2 migration itself is byte-transparent: `tools/call` results are deep-equal between the in-memory legacy transport and the 2026-07-28 HTTP path (`tests/http-modern.test.ts`).

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
- **Tests / fixtures** — mock PKI, loopback TSA, MCP harness, HTTP fixture; coverage thresholds raised to 89 / 80 / 90 / 91; round 2: `tests/schema-conformance.test.ts` (structuredContent vs outputSchema, `_meta.examples` vs inputSchema), `tests/catalogue-parity.test.ts`, `tests/auth.test.ts`, `tests/base64.test.ts`.
- **Round 2 (review)** — `creationDate` on the nine document tools, `signingTime` on `prepare_signature_placeholder`, strict Zod, base64 / DER boundary diagnostics (`src/base64.ts`), opt-in HTTP bearer token (`src/auth.ts`, `PDFNATIVE_MCP_HTTP_TOKEN`), projectable output schemas, `[UNKNOWN_TOOL]` protocol error, `_meta.cached` / `_meta.unmatchedFields`, four recipe prompts, catalogue compaction with the `scripts/tool-shape.mjs` parity gate, fail-closed veraPDF validator with a 24-file corpus — see `release-notes/v1.6.0.md` → *Review round 2*.
- **Docs** — guides `LTV.md`, `PRINT.md`; nine new examples; cross-repo follow-up draft `.github/drafts/issue-v1.6.0-ecosystem.md`.

### Changed
- `pdfnative` `^1.6.0` → `^1.7.0`; MCP SDK 1.x → `@modelcontextprotocol/server` ^2.0.0 (+ core); `zod ^4.2.0`. Three runtime deps, no hono / express / jose in the tree.
- `_meta.apiVersion` 1.5.0 → 1.6.0; versions lock-stepped to 1.6.0.
- Governance charter: no egress by default; operator-configured TSA / OCSP / CRL only; never a URL from tool arguments (`ai-governance.json`, `AGENT_RULES.md`, governance prompts).
- HTTP GET / DELETE on `/mcp` answer 405 (stateless serving); keep-alive disconnect detection per response; `sign_pdf` never cached; cache key namespaced by engine version.

### Fixed
- Signer metadata never reached the `/Sig` dictionary (pdfnative < 1.7 dropped it).
- `verify_pdf` reported `allValid: false` on every B-LTA document (DocTimeStamp parsed as a CMS signature); a document timestamp now counts in `allValid` like any signature.
- Round 2: `validate_pdf` unparsable input → `PDF_PARSE_FAILED`; `inspect_pdf` `checks` requested keys only and `signed` no longer negated by an extra placeholder; page-tree index errors → `VALIDATION_ERROR` (0-based hint); `sign_pdf` cert / key parse failures coded; three non-executable `_meta.examples`; page-tree descriptions claiming `ENCRYPTED_SOURCE`; `verbosity: 'summary'` dropping `ltvLevel`; stale docs (lang list, four → six read tools, `examples/run.mjs`, `EXTRACTION_UNSUPPORTED`, SDK package name).
- PDF/A guide claimed base-14 fonts were embedded.

## Reviewer notes

- **Thin-wrapper fidelity:** LTV assembly, box validation and chart rules live in pdfnative; the server only maps inputs, injects the operator-configured transport and maps errors. `verify_pdf ltv` reads embedded material only and says so in `caveats`.
- **No new runtime dependency** — `pdfnative`, `@modelcontextprotocol/server`, `zod`.
- **Default outputs** — opt-in everywhere; the default-output changes (`verify_pdf.subFilter`; `inspect_pdf.checks` now carrying only the requested keys; `draft_governance_issue` charter text) and the round-2 error-path changes are documented in `docs/API_STABILITY.md` §1 / §5.
- **Secrets** — `PDFNATIVE_MCP_TSA_AUTH` and `PDFNATIVE_MCP_HTTP_TOKEN` are never logged or echoed (asserted); signing keys and passwords never enter `structuredContent` or the cache (encrypt / decrypt / sign / LTV / timestamp / metadata tools and file-mode calls bypass the cache).
- **Honest wording** — three runtime dependencies (pdfnative, the MCP SDK, zod); constant-time `node:crypto` for signing DER keys only, verification pure JS; timestamp tokens checked for status / imprint / nonce before embedding, their own signature verified by `verify_pdf`; a `/DocTimeStamp` counts in `allValid`.

## Review protocol

Two independent, read-only reviewers ran on the finished branch with the same inputs (full diff, release notes, engine release notes, charter). Triage rule: **CONFIRMED** (reproduced, or evident from the quoted code path) ⇒ fixed before this PR with a regression test for HIGH/MEDIUM; **PLAUSIBLE** ⇒ recorded as follow-up; **REJECTED** ⇒ reason given. Fixes landed in commit `fix(review)`.

### Reviewer A — correctness, security, MCP 2026-07-28

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| A-1 | HIGH | SDK v2 stdio `ReadBuffer` caps a frame at 10 MiB and closes the transport — a ~7.5 MiB PDF killed the server | CONFIRMED → fixed (256 MiB frame cap via `StdioServerTransport({ maxBufferSize })`, same cap on HTTP bodies with 413); regression `tests/cli-stdio.test.ts` (11 MiB frame) |
| A-2 | HIGH | B-T claimed from an unverified signature-timestamp token (only the public imprint was checked) | CONFIRMED → fixed (token's own CMS signature verified → `timestamp.tokenSignatureValid`; B-T requires it); regression `tests/ltv-verify.test.ts` (corrupted token signature → B-B) |
| A-3 | MEDIUM | `allValid` / `summary` ignored an invalid DocTimeStamp | CONFIRMED → fixed (verdict uses every entry's `valid`); regression (corrupted DocTimeStamp → `allValid:false`, `1/2 signature(s) valid.`) |
| A-4 | MEDIUM | `ltvLevel` presence-based; revoked signer still `valid:true` | CONFIRMED → fixed (B-LT needs a `/VRI` entry for the signature **and** relevant revocation material; revoked ⇒ `valid:false` + error under the ltv view; caveat added: structural classification) |
| A-5 | MEDIUM | Response caps enforced after full buffering; body read errors unmapped | CONFIRMED → fixed (streamed cap, `NETWORK_ERROR`); regression `tests/network.test.ts` |
| A-6 | MEDIUM | Online `add_ltv` embedded responder bytes unparsed | CONFIRMED → fixed (OCSP / CRL parse-validated before the engine sees them → `LTV_MATERIAL_INVALID`); regression `tests/ltv-tools.test.ts` |
| A-7 | MEDIUM | Client-disconnect abort wiring dead for POST | CONFIRMED → fixed (socket close aborts the in-flight request); regression `tests/http.test.ts` |
| A-8 | MEDIUM | Signer certificate assumed first in `certificates [0]` | PLAUSIBLE → fixed anyway (selected by `SignerInfo.sid` serial, first-cert fallback) |
| A-9 | LOW | CRL could report `revoked` before the issuer matched | CONFIRMED → fixed (issuer must match); OCSP issuer-hash matching documented as a caveat |
| A-10 | LOW | Over-broad `TSA_REJECTED` regexes | CONFIRMED → fixed (exact engine phrases) |
| A-11 | LOW | Allow-list edge cases fail closed silently (ports, punycode, IPv6, DNS rebinding) | CONFIRMED → entries canonicalised through the URL parser + caveats documented (README / AGENTS / SECURITY / LTV guide); regression in `tests/network.test.ts` |
| A-12 | LOW | Intermediates in the CMS never walked for `chainTrust` | CONFIRMED → fixed (bounded breadth-first walk); regression in `tests/ltv-tools.test.ts` |
| A-13 | LOW | Two byte-identity tests could straddle a `/CreationDate` second | CONFIRMED → fixed (dates normalised) |
| A-14 | LOW | `sign_pdf` `openWorldHint:false` despite `timestamp:true` egress | CONFIRMED → fixed (true; recorded in API_STABILITY §5) |
| A-15 | LOW | Offline `add_ltv` skipped DocTimeStamp fields in `/VRI` | CONFIRMED → fixed; regression |
| A-16 | LOW | No HTTP body cap; chart `maxLength` parity; `FONT_LOAD_FAILED` undocumented | CONFIRMED → fixed (256 MiB cap → 413; schema parity; AGENTS / API_STABILITY) |

### Reviewer B — API stability, byte-identity, docs parity, tests

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| B-1 | HIGH | `package-lock.json` still at 1.5.0 / `zod ^4.4.3` | CONFIRMED → fixed (`npm install --package-lock-only`, `npm ci --dry-run` clean) |
| B-2 | MEDIUM | `draft_governance_issue` default output changed (charter sentence) but evidence / §5 silent | CONFIRMED → documented (API_STABILITY §5 third default-output change, release-notes Upgrade, byte table below) |
| B-3 | MEDIUM | `signingTime` now reaching `/Sig /M` undocumented | CONFIRMED → documented (Fixed bullet, §5, field description) |
| B-4 | MEDIUM | `PLACEHOLDER_AMBIGUOUS` / `SIGNATURE_FIELD_NOT_FOUND` / sign_pdf `TSA_REJECTED` / bad chain untested | CONFIRMED → regression tests added (`tests/ltv-tools.test.ts`) |
| B-5 | MEDIUM | CHANGELOG not a bullet-for-bullet mirror (Upgrade list missing) | CONFIRMED → `### Upgrade notes` added under [1.6.0] |
| B-6 | MEDIUM | `draft_governance_issue` description still said "NO outbound network call" | CONFIRMED → charter wording |
| B-7 | LOW | `timestamp_pdf` claimed explicit `fieldName` auto-suffixes | CONFIRMED → description corrected (auto-suffix only when omitted) |
| B-8 | LOW | `signingTime` description overstated `/M` | CONFIRMED → corrected |
| B-9 | LOW | Placeholder size bound for very large certificates undocumented | CONFIRMED → documented (§5 + byte table) |
| B-10 | LOW | "LTV enabled in Adobe" without the trusted-root qualifier | CONFIRMED → corrected |
| B-11 | LOW | Seven pre-existing error codes missing from AGENTS §6 | CONFIRMED (pre-existing) → table completed |
| B-12 | LOW | `add_chart` PDF/A-class engine throw now maps to `PDF_A_COMPLIANCE_VIOLATION` instead of `CHART_ERROR` | PLAUSIBLE → documented in §5 (no code change) |
| B-13 | LOW | = A-10 | fixed with A-10 |
| B-14 | LOW | = A-5 | fixed with A-5 |
| B-15 | LOW | `describeNetworkPolicy()` baked into `SERVER_INSTRUCTIONS` at module load | CONFIRMED, accepted as-is: the environment is read at process start in every supported deployment; recorded here for transparency |
| B-16 | LOW | Offline `/VRI` superset composed in the wrapper | CONFIRMED (design note) → follow-up: request an upstream `embedValidationInfo` helper that derives `/VRI` from the document; documented in API_STABILITY / LTV guide |
| docs-parity sub-review | LOW/MEDIUM | `extract_text` / `extract_attachments` descriptions stale (pre-existing), `server.json` cache description incomplete, README `modDate`, API_STABILITY:169 pointer | CONFIRMED → all fixed |

Outcome: **A: 15 confirmed + 1 plausible (fixed) / B: 14 confirmed + 1 plausible (documented) / 0 rejected.** The full gate and the byte-identity diff were re-run after the fixes (numbers above are post-review).

## Review round 2

Three further independent, read-only reviewers ran on the post-round-1 branch with the same triage rule. Everything marked CONFIRMED below is fixed or documented in this round unless the status says otherwise; "to confirm" means the fix lives in a test file still being finalised when this draft was written and must be re-checked before merge.

### Reviewer M — MCP 2026-07-28 conformance

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| M-1 | HIGH | `structuredContent` under `verbosity:'summary'` / `fields` did not validate against `outputSchema` (`required` + `additionalProperties:false`) | fixed — six read tools declare projectable schemas (all properties optional, summary-only scalars declared); `tests/schema-conformance.test.ts` validates every result shape with the SDK Ajv 2020-12 validator |
| M-2 | HIGH | `server.json` description 991 chars > registry `maxLength: 100` | fixed — 96 chars |
| M-3 | HIGH | One `socket.once('close')` listener per request on keep-alive connections (`MaxListenersExceededWarning`) | fixed — disconnect detection on the per-request response; regression in `tests/http-hardening.test.ts` |
| M-4 | MEDIUM | Three `_meta.examples` fail their own `inputSchema` | fixed — examples corrected, ≤ 2 per tool, every `_meta.examples[].input` validated in `tests/schema-conformance.test.ts` |
| M-5 | MEDIUM | Unknown tool returned as `isError` result instead of a JSON-RPC protocol error | fixed — `-32602` `[UNKNOWN_TOOL] Unknown tool: …` (`callToolDirect` keeps `isError`); documented in API_STABILITY §1 and AGENTS §6 |
| M-6 | MEDIUM | HTTP mode has no authentication; SECURITY.md silent | fixed + documented — opt-in `PDFNATIVE_MCP_HTTP_TOKEN` (`src/auth.ts`, 401 + `WWW-Authenticate`, constant-time compare; `tests/auth.test.ts`); SECURITY.md lists the no-token posture under "not defended" and recommends the token |
| M-7 | LOW | Resource template `{path}` percent-encodes `/` | fixed — `pdfnative://output/{+path}` |
| M-8 | LOW | `inspect_pdf` `perPage.items` lacked `additionalProperties:false` | fixed |
| M-9 | LOW (SDK) | POST with a 2026 envelope but no `MCP-Protocol-Version` header is served | documented — SDK-owned leniency (`createMcpHandler`); not pre-validated in `cli.ts` |
| M-10 | LOW (SDK) | Transport rejections use the legacy `-32000` code | documented — SDK-owned |
| M-11 | LOW | `Implementation` lacks `websiteUrl` | fixed — `serverInfo.websiteUrl` = `server.json` `websiteUrl` = `package.json` `homepage` (lock-step test) |
| M-12 | LOW | `OUTPUT_TOO_LARGE` on `resources/read` surfaced as `-32602`; tool vocabulary in resource errors | deferred — cosmetic; error code mapping unchanged |
| M-13 | LOW | `idempotentHint:false` on sign / encrypt / metadata / LTV / timestamp tools | documented — annotations kept deliberately conservative (bytes differ per call); hints are outside the §2 contract |

### Reviewer A — agent-consumption quality

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| A-1 | HIGH | "Document timestamps never flip `allValid`" contradicted the code in the tool description, output schema and four docs | fixed — description / schema / AI_GUIDE / API_STABILITY / LTV.md / llms.txt / KNOWLEDGE_BASE / README / AGENTS say a `/DocTimeStamp` counts in `allValid` like any signature |
| A-2 | HIGH | Three non-executable `_meta.examples` | fixed (= M-4) |
| A-3 | HIGH | Page-tree descriptions claimed `ENCRYPTED_SOURCE` while the tools take `password` | fixed — descriptions, `examples/*.json`, llms.txt, AGENTS §6, ENCRYPTION.md |
| A-4 | HIGH | PEM / non-DER certificate in `sign_pdf` → uncoded ASN.1 error | fixed — `src/base64.ts`: `VALIDATION_ERROR` with the exact `openssl … -outform DER` remedy for certificates, chains and keys; `tests/base64.test.ts` |
| A-5 | MEDIUM | Cache served stale `/M`, `/CreationDate`, `/ID`; no `_meta.cached`; engine version not in the key | fixed — `sign_pdf` never cached; `_meta.cached: true` on hits; key namespaced by `TOOL_API_VERSION/package version`; documented (AGENTS §4, README, KNOWLEDGE_BASE) |
| A-6 | MEDIUM | `check:'signed'` false whenever an extra unsigned placeholder exists | fixed — true when at least one signature field carries signed content; "structural, not cryptographic" stated in the description and decision tree |
| A-7 | MEDIUM | `verify_pdf { ltv:true, verbosity:'summary' }` dropped `ltvLevel` | fixed — summary keeps `ltvLevel` (and `inspect_pdf` keeps `docTimestampCount` / `trapped` / `checksPassed`) |
| A-8 | MEDIUM | `ENCRYPTED_SOURCE` remedy "decrypt first" is a dead end for `add_ltv` / `timestamp_pdf`; `annotate_pdf` said "outside the server" | fixed — tool-specific messages (decrypt → edit → `encrypt_pdf` for annotate / metadata; sign before encrypting for LTV / timestamp) and docs |
| A-9 | MEDIUM | 1-based page mistakes on `extract_pages` / `split_pdf` surfaced as `PDF_PARSE_FAILED` | fixed — `VALIDATION_ERROR` with a 0-based hint (`src/pagetree.ts`) |
| A-10 | MEDIUM | Zod stripped unknown keys although schemas say `additionalProperties:false` | fixed — `.strict()` at every level; `VALIDATION_ERROR` "Unrecognized key"; documented in API_STABILITY §2 |
| A-11 | MEDIUM | `signingTime` rejected time-zone offsets (regex dump) | fixed — `datetime({ offset: true })` on `sign_pdf` and `prepare_signature_placeholder` |
| A-12 | MEDIUM | `checks` echoed all eight keys with `false` | fixed — requested keys only; API_STABILITY §5 updated |
| A-13 | MEDIUM | No `creationDate` opt-in; default bytes vary with wall clock and host TZ | fixed — `creationDate` on the nine document tools (`src/print.ts`), `signingTime` on `prepare_signature_placeholder`; "same host time zone" wording everywhere; `reproducible_output` prompt |
| A-14 | MEDIUM | `extract_text` description pre-dated the ToUnicode resolver and contradicted the schema | fixed — description aligned with the schema (`extractable` / `extractableReason`) |
| A-15 | MEDIUM | `validate_pdf` reported unparsable input as a PDF/UA failure | fixed — `PDF_PARSE_FAILED` |
| A-16 | LOW | `rsaKeyPkcs1DerBase64` text refused PKCS#8 although the provider accepts it | documented — description, AGENTS §6, AI_GUIDE, llms.txt, LTV.md |
| A-17 | LOW | `data:application/pdf;base64,` prefix → opaque `startxref` error | fixed — prefix tolerated; PEM / nested `data:` / double-encoded input → `PDF_PARSE_FAILED` with a hint |
| A-18 | LOW | `fields:['allvalid']` typo → empty `structuredContent`, no warning | fixed — `_meta.unmatchedFields` + `_meta.availableFields` |
| A-19 | LOW | `outputMode` / `outputPath` undocumented on 14 tools | fixed — every `outputMode` carries a description (measured on the built catalogue) |
| A-20 | LOW | `FORM_FIELD_NOT_FOUND` raw engine text | fixed — message names `read_form_fields` / `onUnknownField:'ignore'` |
| A-21 | LOW | Chart block description listed v1.5 kinds | rejected as stated — the block description already lists the v2 kinds (bar / horizontal-bar / stacked-bar / line / area / scatter / pie / donut) next to the enum; the enum names (`barH`, `stackedBar`, …) are authoritative |
| A-22 | LOW | "constant-time node:crypto" stated globally | fixed — server description, package / server.json, README, AGENTS, SECURITY, KNOWLEDGE_BASE, llms.txt: constant-time for signing DER keys only, verification pure JS |
| §1 | — | Catalogue compaction plan (Tier 1) | fixed — tools/list ≈ 206 kB → ≈ 174 kB, instructions 12.9 kB → 5.4 kB, no schema change; guarded by `scripts/tool-shape.mjs` + `tests/catalogue-parity.test.ts`. Tier 2 (`$defs`, shared output schema) deferred: structural, needs a fixture refresh under API_STABILITY §5 |
| §3(g) | — | Recipe prompts | fixed — `pades_ladder`, `print_ready`, `reproducible_output`, `pdfa_valid` |

### Reviewer F — factuality, tests, veraPDF

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| F-1 / F-2 | HIGH | `_meta.examples` of `add_international_text` / `add_form` fail the schema | fixed (= M-4) |
| F-3 | HIGH | AI_GUIDE claimed `EXTRACTION_UNSUPPORTED` is raised | fixed — never raised; `password` path documented; kept in the error tables as legacy only |
| F-4 | HIGH | `parseCertificate` threw an uncoded error; test asserted only the prefix | fixed (= A-4); test asserts the code |
| F-5 | HIGH | `publish.yml` ran `test:coverage` before `build`, silently skipping the stdio suite | fixed — build precedes the tests; `tests/cli-stdio.test.ts` fails (not skips) without `dist/` under `CI` |
| F-6 | HIGH | veraPDF validator fail-open, no negative canary | fixed — `VERAPDF_REQUIRED=1` (exit 3 on INFRA), three `expectCompliant:false` canaries, `XFAIL` / `XPASS` outcomes |
| F-7 | HIGH | Unsigned placeholder + `pdfA` claims PDF/A but fails 6.4.3 | documented — tool description, PDFA.md, AGENTS §1, release notes; corpus carries the unsigned (XFAIL) and PAdES-signed (PASS) siblings |
| F-8 | MEDIUM | "pin `modDate` for reproducible bytes" only holds on the same host TZ | fixed — wording in README / AGENTS / AI_GUIDE / KNOWLEDGE_BASE / examples / tool description; same caveat on `creationDate` / `signingTime` |
| F-9 | MEDIUM | "zero runtime dependencies beyond …" / "only runtime dependency" | fixed — three runtime dependencies everywhere |
| F-10 | MEDIUM | "constant-time … verify" | fixed (= A-22) |
| F-11 | MEDIUM | CONTRIBUTING named `@modelcontextprotocol/sdk` | fixed |
| F-12 | MEDIUM | README `lang` list 19 / 25; "16 Unicode scripts" | fixed — 25 codes listed, "24 scripts" consistently |
| F-13 | MEDIUM | "four read-only tools" | fixed — six |
| F-14 | MEDIUM | "corpus covers every PDF/A-relevant feature" | fixed — corpus grown 15 → 24 files (1b watermark, custom `outputIntent`, 2u emoji + math, `add_form`, unsigned + signed placeholder, 3b PDF attachment, `update_metadata`, merge / extract); LOCAL_TESTING / CONTRIBUTING state what is and is not covered |
| F-15 | MEDIUM | veraPDF installer unpinned | fixed — SHA-256 checked with `sha256sum --check --strict` |
| F-16 | MEDIUM | Infra failures reported as conformance FAILs; raw XML discarded | fixed — `INFRA` outcome (`exceptionMessage`, spawn error, empty / unparseable report), stderr tail kept |
| F-17 | MEDIUM | Multi-step examples never executed | fixed — `tests/examples.test.ts` chains them (`<base64 from step N>` substituted; key-material steps stay documentation-only) |
| F-18 | MEDIUM | Strip-mode Zod vs `additionalProperties:false` | fixed (= A-10) |
| F-19 | MEDIUM | `vi.mock('pdfnative')` only; no un-mocked `add_international_text` / sign tests | fixed — `tests/add-international-text-real.test.ts`, `tests/error-codes.test.ts` (`UNSUPPORTED_LANG` / `FONT_LOAD_FAILED` un-mocked; `MISSING_PLACEHOLDER` / `SIGNING_FAILED` remain mocked-path codes, inventoried) |
| F-20 | MEDIUM | 413 path untested | fixed — `toWebRequest(…, { maxBodyBytes })` injectable cap (default unchanged); `tests/http-hardening.test.ts` + `tests/http.test.ts` |
| F-21 | MEDIUM | `PDFNATIVE_MCP_TSA_AUTH` never crossed a real socket | fixed — `tests/_tsa-server.ts` records headers; `tests/network.test.ts` asserts `Authorization` over a real loopback socket and a real CRL GET (non-allow-listed host never connects) |
| F-22 | MEDIUM | Timing-based disconnect test | rewritten — synchronised on the abort event |
| F-23 | MEDIUM | Two-contract assertions cannot catch a code regression | fixed — single exact codes asserted: `NETWORK_HOST_NOT_ALLOWED`, `MISSING_PLACEHOLDER`, `ContentInfo: ASN.1 …` with `integrity:false` |
| F-24 | LOW | PDFA.md rule 1 listed 6 of 8 `embedFonts` tools | fixed |
| F-25 | LOW | "verified before embedding" overstated the timestamp check | fixed — status / imprint / nonce before embedding; token signature verified by `verify_pdf` (release notes, CHANGELOG, SECURITY, this draft) |
| F-26 | LOW | Pack size and `vitest.config.ts` comment stale | fixed — numbers re-measured below |
| F-27 | LOW | Byte-identity table: no in-repo reproduction script; `latin` row reason | documented — API_STABILITY §5 states the table came from a scratchpad baseline script (no in-repo script yet) and that the Latin input was not re-measured in isolation; `scripts/tool-shape.mjs` covers catalogue parity only |
| F-28 | LOW | `examples/run.mjs` does not exist; tree omits `GovernanceError`; "39 keywords" | fixed — README / AI_GOVERNANCE reproduction examples, project tree (`auth.ts`, `base64.ts`, `projection.ts`, `GovernanceError`), ROADMAP keyword count (132) |
| F-29 | LOW | Global `isCompliant` regex; element-form XMP only | fixed — `isCompliant` read from the `<validationReport>` element only; claim detection still accepts element-form XMP only (the corpus generator emits that form) |
| F-30 | LOW | SIGTERM clean exit not asserted | fixed — `exitCode` asserted on non-Windows, win32 emulation documented in the test |
| F-31 | LOW | CMYK `PRINT_ERROR` approximated; temp dirs never removed; env cleanup only on success | partially — `server.test.ts` env restore is `finally`-guarded; still open: the CMYK case uses a non-ICC buffer rather than a real CMYK ICC header, and most `mkdtemp` directories (OS temp, outside the repo) are not removed |
| F-32 | LOW | `paths:` filter would block a required check | documented — note in `verapdf.yml` before the job becomes required (1.7.0) |

### Follow-ups (not in this release)
- Upstream: `embedValidationInfo` helper deriving `/VRI` from the document (B-16); OCSP issuer-hash matching once `parseOcspResponse` exposes CertID (A-9).
- DNS-rebinding detection for allow-listed hostnames would need a resolver hook — out of scope without a dependency (A-11, documented).
- veraPDF job to become blocking in 1.7.0.

## Post-merge checklist (human)

1. `git tag v1.6.0 <merge-sha> && git push origin v1.6.0`.
2. GitHub Release: title from `release-notes/v1.6.0.md`, body = the notes.
3. Watch `publish.yml` (OIDC Trusted Publishing) → `npm view pdfnative-mcp@1.6.0`.
4. Publish the MCP registry entry from `server.json` (manual step, see `.github/instructions/release.instructions.md`).
5. Open the cross-repo ecosystem issue from `.github/drafts/issue-v1.6.0-ecosystem.md` in `Nizoka/pdfnative` (human-submitted per the governance charter).
