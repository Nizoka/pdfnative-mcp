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
- `npm run test:coverage` — **647 tests / 54 files** passing; **90.6** stmts / **81.8** branches / **95.2** funcs / **92.6** lines (thresholds raised to 89 / 80 / 90 / 91)
- `npm run build` — clean `dist/`; `tests/cli-stdio.test.ts` drives the built CLI over stdio (legacy handshake, 2026-07-28 `server/discover` probe, 11 MiB frame)
- `npm run examples:check` — 94 checks; every `examples/*.json` references a live tool; placeholder-free examples execute end-to-end
- `npm audit --audit-level=high` — 0 vulnerabilities; lockfile contains no `hono` / `express` / `jose` / `@modelcontextprotocol/sdk`
- `npm pack --dry-run` — 222 files, 284.5 kB: `dist/`, `LICENSE`, `README.md`, `CHANGELOG.md`, `server.json`, `llms.txt`, `package.json` only
- `npm run validate:pdfa` — corpus of 15 files generated (13 claiming PDF/A, 2 page-tree outputs expected not to); veraPDF absent locally → advisory hint path (exit 0); the `verapdf.yml` job runs the real validator in CI (non-blocking in 1.6.0)
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
