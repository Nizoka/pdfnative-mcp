# API Stability — pdfnative-mcp

> Stability charter for the **tool API** (tool names, input/output schemas, error codes, runtime semantics).
> The server binary itself follows standard SemVer for npm releases.

---

## 1. Versioning

Every tool emits `_meta.apiVersion` in the `ListTools` response.

Current value: **`1.6.0`** (stable, since pdfnative-mcp 1.6.0).

The tool API version is **independent of the npm release version**.
Server releases that ship only documentation, refactoring, or non-breaking ergonomic improvements (richer descriptions, additional `_meta.examples`, new optional output fields) **do not** bump `_meta.apiVersion`.

A bump of `_meta.apiVersion` happens **only** in the cases listed in §3.

> **MCP protocol alignment.** The tool API version above is orthogonal to the MCP
> wire-protocol revision. Since pdfnative-mcp 1.6.0 the server runs on the MCP TypeScript
> SDK v2 (`@modelcontextprotocol/server` ^2.0.0) and speaks **MCP 2026-07-28** — stateless
> serving, `server/discover`, `resultType`, `ttlMs` / `cacheScope` cache hints, the `_meta`
> `serverInfo` envelope, `Mcp-Method` / `Mcp-Name` headers over HTTP — with automatic
> fallback to the legacy `initialize` handshake for `2025-11-25`, `2025-06-18` and
> `2025-03-26` clients on both stdio and HTTP. The `tools/call` payload (`content`,
> `structuredContent`, `isError`) is identical on both paths. Tool schemas are JSON Schema
> **2020-12**, `serverInfo` advertises `title` + `description` + `websiteUrl`, and
> input-validation failures are returned as tool-execution errors (`isError: true`) — none of
> which affect `_meta.apiVersion`.
>
> **Two transport-level corrections in 1.6.0:** `resources/read` on an unknown URI now
> answers the JSON-RPC error code **`-32602`** (Invalid params), which the 2026-07-28
> specification mandates for resource-not-found on every protocol revision (previously the
> SDK 1.x path surfaced it as a generic error); and `tools/call` naming a tool that does not
> exist is now a JSON-RPC **`-32602`** protocol error with the message
> `[UNKNOWN_TOOL] Unknown tool: <name>` instead of an `isError: true` result, because the
> specification classifies unknown tools as protocol errors and reserves `isError` for
> execution failures (the in-process `callToolDirect` helper keeps returning `isError`). Both
> are protocol-level error codes, not `ToolError` `code`s (`UNKNOWN_RESOURCE` is unchanged and
> still carried in the message; `UNKNOWN_TOOL` is a message marker only), so they are outside
> the §2 matrix.
>
> **Output-schema conformance (1.6.0):** `structuredContent` always validates against the
> tool's `outputSchema` — a 2026-07-28 MUST — including `verbosity: 'summary'` and `fields`
> projections, file mode and `includeDiagnostics`. To make that true the seven read tools
> (`inspect_pdf`, `verify_pdf`, `validate_pdf`, `extract_text`, `extract_attachments`,
> `read_form_fields`, `inspect_layout`) declare **projectable** output schemas: every property optional, no
> `required`, `additionalProperties: false` kept, and the summary-only scalars
> (`attachmentCount`, `invalid`, `errorCount`, `warningCount`, `charCount`,
> `extractableReason`, `blockCount`) declared. Default (`'full'`) output is unchanged; only the schema
> metadata relaxed (`tests/schema-conformance.test.ts`, SDK Ajv 2020-12 validator).
>
> **Transport facts that are SDK behaviour, unchanged since 1.5.0:** on **stdio**, a request
> sent before `initialize` is dropped without a reply (the specification requires the client
> to initialise first), and JSON-RPC **batch arrays** (2025-03-26) are not accepted on stdio —
> they are accepted over HTTP (tested). No major host batches. Input schemas declare **no
> `$schema` keyword** by policy: MCP ≥ 2025-11-25 defaults to JSON Schema 2020-12, and some
> hosts forward `inputSchema` verbatim to LLM function-calling APIs that reject unknown
> keywords. Likewise there is no `$ref` / `$defs`, which is why the 13-kind block union is
> repeated inline in `inspect_layout` and `tools/list` weighs ≈ 245 kB.

---

## 2. What is covered

| Surface | Scope |
|---------|-------|
| Tool **name** | Stable. Renaming a tool is a major bump. |
| Required **input fields** | Stable. Removing or renaming is a major bump. |
| Required **output fields** | Stable. Removing or renaming is a major bump. |
| Field **types** (string/number/bool/enum) | Stable. Narrowing accepted values is a major bump. |
| **Error codes** (`code` on `ToolError`) | Stable. Removing or renaming is a major bump. |
| `_meta.examples` | **Not** covered. May change at any time (at most two per tool since 1.6.0; every one is executable against its `inputSchema`). |
| `description` strings, `serverInfo.instructions`, prompt texts | **Not** covered. May be reworded at any time — the `tools/list` *wording* is outside the byte-identical charter; tool-result `structuredContent` defaults are inside it. |
| `tools/list` **structure** (types, enums, bounds, defaults, `required`, `additionalProperties`, annotations, example count) | Covered, and enforced by two gates. *Drift:* `scripts/tool-shape.mjs` fingerprints the catalogue with every description string stripped and `tests/catalogue-parity.test.ts` compares it with `tests/_fixtures/tool-shape.json` — any structural change is a deliberate `--write` refresh reviewed under §3 / §5. *Compatibility:* `tests/catalogue-superset.test.ts` compares the live catalogue with the frozen **published 1.5.0** catalogue (`tests/_fixtures/tool-shape.v1.5.0.json`, never regenerated) and fails on any removal or narrowing — tool, input property, enum value, default, `required` added, `additionalProperties` tightened, or a numeric / length bound made stricter; the accepted 1.5.0 → 1.6.0 deltas (e.g. `watermark.required` dropped, read-tool `required` dropped, `lang` `oneOf` → `anyOf`) are enumerated in the test and must each still occur. |
| Schema **`default`** values | Documented; changes are minor unless they alter generated output silently. |
| Unknown input keys | Rejected with `VALIDATION_ERROR` at every nesting level (Zod `.strict()`), exactly as the published `additionalProperties: false` always declared. |

---

## 3. Bump rules

### Patch (`1.0.x`)
- New optional output fields added to existing tools (additive only).
- Looser input validation (e.g. accept a previously rejected payload).
- Internal hardening or cache changes that do not alter response shape.
- Documentation, examples, and description refreshes.

### Minor (`1.x.0`)
- New tool added.
- New optional input field with a backward-compatible default.
- New value added to an existing enum (when older clients can safely ignore it).

### Major (`x.0.0`)
- Tool removed or renamed.
- Required field added or removed.
- Field type narrowed or semantics changed.
- Error code removed, renamed, or repurposed.
- Default value change that alters generated byte output for the same input.

---

## 4. Deprecation policy

When a tool, field or error code is scheduled for removal:

1. Mark it deprecated in `description` and in this document.
2. Keep it functional for **at least one minor release** before removal.
3. Provide a migration note in the next `release-notes/vX.Y.Z.md`.
4. Drop only on the next major bump.

---

## 5. Per-tool stability matrix

All 28 tools shipped through pdfnative-mcp 1.6.0 are at `_meta.apiVersion = '1.6.0'` and are considered **stable**:

`generate_basic_pdf`, `add_barcode`, `add_international_text`, `add_table`, `add_form`,
`embed_image`, `prepare_signature_placeholder`, `sign_pdf`, `verify_pdf`, `validate_pdf`,
`inspect_pdf`, `add_attachment`, `extract_attachments`, `extract_text`,
`merge_pdfs`, `split_pdf`, `extract_pages`, `annotate_pdf`, `draft_governance_issue`,
`read_form_fields`, `fill_form`, `add_chart`, `encrypt_pdf`, `decrypt_pdf`,
`update_metadata`, `add_ltv`, `timestamp_pdf`, `inspect_layout`.

> **v1.6.0 minor bump rationale:** four **new tools** were added on pdfnative 1.7 —
> `add_ltv` (PAdES B-LT: `/DSS` + `/VRI` via `addValidationInfo` / `embedValidationInfo`),
> `timestamp_pdf` (PAdES B-LTA: `/DocTimeStamp` via `addDocumentTimestamp`),
> `update_metadata` (incremental `/Info` + XMP rewrite via `PdfModifier.updateMetadata`) and
> `inspect_layout` (read-only pagination dry run via `inspectDocumentLayout`; same `blocks`
> schema as `generate_basic_pdf` plus `title`, `footerText`, `pdfA`, `normalize`, `embedFonts`,
> `pageSize`, `margins`, `headerTemplate`, `footerTemplate`, `verbosity`, `fields`).
>
> **Full engine coverage (1.6.0, additive):**
> - `generate_basic_pdf.blocks[].type` gains seven **enum values** — `table`, `image`, `link`,
>   `toc`, `barcode`, `svg`, `formField` — on top of `heading`, `paragraph`, `list`, `pageBreak`,
>   `spacer`, `chart` (13 kinds, every `DocumentBlock` of pdfnative 1.7). Each new member is a
>   `const`-discriminated `oneOf` branch with `additionalProperties: false`; `table`, `barcode`,
>   `formField` reuse the bodies of `add_table` / `add_barcode` / `add_form`. Bounds: `image`
>   ≤ 12 000 000 base64 characters and a 24 MiB decoded budget per call (`VALIDATION_ERROR`);
>   `svg.data` ≤ 100 000 characters; `link.url` ≤ 2048 characters, `http:` / `https:` /
>   `mailto:` only; at most 50 000 engine blocks after newline splitting (`VALIDATION_ERROR`
>   instead of the engine's `GENERATION_FAILED`).
> - **Layout options** on the nine document tools (and the four pagination-relevant ones on
>   `inspect_layout`): `pageSize` (enum `A4` | `Letter` | `Legal` | `A3` | `Tabloid`),
>   `margins` (`top` / `right` / `bottom` / `left`, 0–200), `headerTemplate` /
>   `footerTemplate` (`left` / `center` / `right` / `fontSize` / `color`), `compress`,
>   `debug`. All optional, nothing emitted when absent — default output byte-identical.
> - **`encrypt`** (build-time Standard Security Handler, the same fragment the page-tree
>   tools already had) on `generate_basic_pdf`, `add_table`, `add_form`,
>   `add_international_text`, `embed_image`, `add_barcode`, `add_chart`. Keeps the AcroForm;
>   `encrypt` + `pdfA` → `VALIDATION_ERROR`; output is randomised and never cached. Not
>   offered on `prepare_signature_placeholder` (the placeholder must stay signable) nor
>   `add_attachment` (PDF/A-3 forbids encryption).
> - `inspect_pdf`: `annotations` (boolean input), `check` value `annotations`, output
>   `annotations[]` (opt-in) and `annotationCount` (presence-gated).
> - `watermark` on `generate_basic_pdf` / `add_table`: `image` (`imageBase64` ≤ 12 000 000
>   characters, 8 MiB decoded, `mimeType`, `opacity`, `width`, `height`) and `position`
>   (`background` | `foreground`); `text` is no longer `required` (an image-only watermark is
>   valid) — a loosening recorded in the superset gate.
> - `add_form.fields[].fieldType` and the `formField` block gain the enum value `listbox`;
>   both gain `placeholder`. `embed_image` gains `align` and `alt`.
> - Operator environment: `PDFNATIVE_MCP_MAX_INFLATE_BYTES` (engine decompression cap;
>   invalid value refuses to start). A capped stream surfaces as `PDF_PARSE_FAILED` on
>   `extract_attachments includeData: true`; `extract_text` returns empty page text for a
>   capped content stream (engine behaviour, no new code).
> - **Bound kept:** `embed_image.imageBase64` keeps its 1.5.0 contract with no `maxLength`;
>   the 12 M-character cap applies only to the new inline `image` block and watermark images
>   (a bound on `embed_image` would have been a narrowing — §3 major).
> - New PDF/A **diagnostics** (not error codes): `PDFA_UNEMBEDDED_FORM_FONT` (any form field
>   under a PDF/A claim) and `PDFA_DEVICE_CMYK_IMAGE` (CMYK JPEG under PDF/A) — reported via
>   `includeDiagnostics`, escalated to `PDF_A_COMPLIANCE_VIOLATION` by `strict: true`.
>
> Existing tools gained further **optional inputs** with backward-compatible defaults:
> - every document-producing tool (`generate_basic_pdf`, `add_barcode`, `add_international_text`,
>   `add_table`, `add_form`, `embed_image`, `prepare_signature_placeholder`, `add_attachment`,
>   `add_chart`): `print` (boxes / `bleed` / `marks` / `userUnit`), `outputIntent`, `metadata`,
>   `strict`, `includeDiagnostics`, and `embedFonts` (not on `add_international_text`, which
>   always embeds); `viewerPreferences` accepts `duplex`, `pickTrayByPDFSize`, `printPageRange`,
>   `numCopies`;
> - `add_chart` and the `generate_basic_pdf` `chart` block: kinds `stackedBar` / `stackedBarH` /
>   `area` / `scatter` (new enum values), per-series `xValues` / `yAxis`, `axis.scale`, `axis2`,
>   `xAxis`, `dataLabels`, `labelStride`, `labelRotation`, `width`, `height`;
> - `sign_pdf`: `profile`, `timestamp`, `fieldName`, `allowMultiple`, `certChainDerBase64`,
>   and `algorithm` values `rsa-sha384` / `rsa-sha512`;
> - `prepare_signature_placeholder`: `subFilter`, `reserveTimestamp`;
> - `inspect_pdf`: `signatures`, and `check` values `dss` / `docTimestamp` / `trapped`;
> - `verify_pdf`: `ltv`.
>
> **Output fields** were added: `structuredContent.diagnostics[]` on every PDF-producing
> tool (only when `includeDiagnostics: true`) and `structuredContent.summary` on `add_ltv`;
> `verify_pdf` per-signature `isDocTimestamp` (document timestamps only) and the `ltv` extras
> (`profile`, `timestamp`, `revocation`, `ltvLevel`, document-level `dss` / `ltvLevel` /
> `caveats`, opt-in); `inspect_pdf` `dss`, `trapped`, `docTimestampCount` (presence-gated),
> `signatures[]` (opt-in) and `perPage[].trimBox` / `bleedBox` / `artBox` / `cropBox` /
> `userUnit` (only when set on the page, and only with `pages: true`). Three changes land in
> **default** output: `verify_pdf` signatures now always carry `subFilter` (a new key, `null`
> when absent); `inspect_pdf` `checks` now contains **only the keys named in `check`** —
> earlier releases echoed every check name with `false` for the ones not requested, which
> misled agents into reading `signed: false` as "not signed" (the unrequested keys were
> never promised; `checksPassed` is unchanged and `check: 'signed'` is now true when at
> least one signature field carries signed content, so an extra unsigned placeholder no
> longer negates it); and the `draft_governance_issue` draft
> markdown and `complianceReport.humanGate` string changed because the `HUMAN_GATE` charter
> sentence was reworded to state the single permitted egress class (a deliberate charter
> update — the field keeps its type and meaning, only the quoted text differs). The first is
> a "new optional output field" change per §3, the second removes keys that were only ever
> present when the opt-in `check` input was used, and the third is free-text carried verbatim
> from the governance charter and has never been promised stable.
>
> **Hardening and behaviour changes (still 1.6.0, `_meta.apiVersion` unchanged).** Additive inputs:
> `creationDate` (ISO-8601) on the nine document tools — pins `/CreationDate`, the XMP dates
> and therefore the trailer `/ID`; `signingTime` on `prepare_signature_placeholder`
> (`/Sig /M` is frozen at placeholder time); `sign_pdf.signingTime` accepts time-zone
> offsets; `rsaKeyPkcs1DerBase64` also accepts PKCS#8 DER. Pinned dates are byte-identical
> on the **same host time zone** (the engine serialises local time). Additive outputs:
> `_meta.unmatchedFields` + `_meta.availableFields` when a `fields` path matches nothing;
> `_meta.cached: true` on a response served from the opt-in cache; `verbosity: 'summary'`
> keeps `ltvLevel` (`verify_pdf ltv: true`) and `docTimestampCount` / `trapped` /
> `checksPassed` (`inspect_pdf`) when present. Error-path changes: unknown or misspelt keys
> → `VALIDATION_ERROR` (contract enforcement, see §2 — a 1.5.0 call that carried a stray key
> and was silently accepted now fails; `additionalProperties: false` always declared it
> invalid); `validate_pdf` on unparsable bytes → `PDF_PARSE_FAILED`. **That one was a
> previously-succeeding call** (1.5.0 returned `{ valid: false, errors: ['Unparseable PDF: …'] }`
> with no `isError`); the contract is now stated explicitly: *a parse failure is not a
> validation verdict* — `valid` describes PDF/UA structure of a PDF that opened, and a client
> branching on `structuredContent.valid` must treat `isError` as "no verdict". Page-index /
> range errors on `merge_pdfs` / `split_pdf` / `extract_pages` → `VALIDATION_ERROR` with a
> 0-based hint (was `PDF_PARSE_FAILED` — a code correction, the meaning of `PDF_PARSE_FAILED`
> itself is unchanged); PEM where DER base64 is expected, empty payloads and non-base64 input
> → `VALIDATION_ERROR` with the `openssl` remedy (`sign_pdf` certificate / chain / key parse
> failures were previously uncoded); PEM text, a nested `data:` URI or double-encoded base64
> passed as a PDF → `PDF_PARSE_FAILED` with a hint (a `data:…;base64,` prefix is now
> tolerated). `sign_pdf` is never served from the response cache (previously only with
> `timestamp: true`), and the cache key is namespaced by `TOOL_API_VERSION/package version`.
> `add_international_text.lang` uses `anyOf` instead of `oneOf` (same accepted values).
> None of these touches a stable surface in §2; the release notes carry a *Migrating from
> 1.5.0* checklist for clients that relied on the old error paths.
>
> **New error codes** (additive): `TSA_NOT_CONFIGURED`, `TSA_REJECTED`,
> `REVOCATION_NOT_CONFIGURED`, `NETWORK_HOST_NOT_ALLOWED`, `NETWORK_ERROR`, `LTV_NO_SIGNATURE`,
> `LTV_EMPTY`, `LTV_MATERIAL_INVALID`, `LTV_ERROR`, `PLACEHOLDER_AMBIGUOUS`,
> `SIGNATURE_FIELD_NOT_FOUND`, `PRINT_ERROR`, `METADATA_ERROR`, `GENERATION_FAILED` (generic
> engine throw during a build), `FONT_LOAD_FAILED` now also raised by the document tools when
> the `embedFonts` Noto Sans Latin data cannot be loaded (previously `add_international_text`
> only). Existing codes gained **new triggers** without changing their
> meaning: `PDF_A_COMPLIANCE_VIOLATION` (escalated engine diagnostics under `strict: true`;
> `print.userUnit` under `pdfa1b`; in `add_chart` a PDF/A-class engine throw now maps to
> `PDF_A_COMPLIANCE_VIOLATION` instead of the old catch-all `CHART_ERROR`), `CHART_ERROR`
> (engine cross-field rules, now also for the `generate_basic_pdf` `chart` block),
> `ENCRYPTED_SOURCE` (`update_metadata`, `add_ltv`, `timestamp_pdf`), `VALIDATION_ERROR`
> (unsupported PNG variants, image budget, link scheme, `encrypt` + `pdfA`, block-count cap),
> `PDF_PARSE_FAILED` (a stream over the operator decompression cap).
>
> **Annotation change:** `sign_pdf` now advertises `annotations.openWorldHint: true`, because
> `timestamp: true` performs egress to the operator-configured TSA (no request is made without
> `PDFNATIVE_MCP_TSA_URL`). Annotations are hints, not part of the §2 contract.
>
> **Bug fixes that change bytes for inputs that were previously wrong:**
> 1. Signer metadata (`signerName` / `reason` / `location` / `contactInfo`) passed to
>    `sign_pdf` or `prepare_signature_placeholder` never reached the `/Sig` dictionary on
>    pdfnative < 1.7 (the engine dropped it). It is now baked at placeholder time, so a PDF
>    signed with those inputs differs from v1.5.0 output — the previous output silently lost
>    caller data.
> 2. `sign_pdf.signingTime` now reaches `/Sig /M` when `sign_pdf` injects the placeholder.
>    pdfnative < 1.7 wrote `/M` = *now* at placeholder time and ignored the option, so callers
>    who pinned `signingTime` for reproducible output get different (correct) `/M` bytes. A
>    pre-built placeholder (`prepare_signature_placeholder`) keeps its own `/M`.
> 3. `verify_pdf` reported `allValid: false` on PAdES B-LTA documents because a
>    `/DocTimeStamp` was parsed as a CMS signature. Document timestamps are now verified as
>    RFC 3161 tokens (imprint vs. ByteRange digest, token signature vs. the embedded TSA
>    certificate) and count in `allValid` like any signature: a sound timestamp no longer fails
>    the verdict, a tampered one still does. Inputs that were correctly verified before are
>    unaffected.
> 4. `add_form fieldType: 'textarea'` (and the `formField` block) now maps to the engine's
>    `multilineText`. 1.5.0 passed the string `'textarea'` through unmapped — the engine's
>    field-type union has no such member, so the widget fell through to a plain single-line
>    text field without the multiline flag. The output now carries `/Ff 4096`, so the bytes
>    differ for that input; every other `fieldType` is unchanged.
>
> **Placeholder sizing note:** the default `sign_pdf` placeholder size is now
> `estimateContentsSize([certLen], algorithm)` = `max(16384, …)` instead of a flat 16384, plus
> 8192 bytes when `timestamp: true` (room for the RFC 3161 token). The result is identical for
> signer certificates up to roughly 10 KB; beyond that the reserved `/Contents` grows, so the
> produced bytes differ from v1.5.0 only for very large certificates (which previously risked
> `SIGNING_FAILED` on overflow). To pin the size, build the placeholder with
> `prepare_signature_placeholder` and its `placeholderBytes` input (`sign_pdf` has no such
> input) and sign that document.
>
> **Engine-inherited byte changes (pdfnative 1.6 → 1.7), default inputs:** measured against
> v1.5.0 with a fixed-input baseline (dates and trailer `/ID` normalised). Plain documents,
> barcodes, tables, images, charts without overlapping labels, merge / split / extract,
> decrypt and every read-only tool are byte-identical. The following differ, and in each case
> the previous bytes were deficient: AcroForm `/Helv` now carries a `/ToUnicode` CMap
> (`add_form`, `fill_form` — text was not reliably extractable); incremental outputs regenerate
> `/ID[1]` and use consistent EOL framing (`prepare_signature_placeholder`, `annotate_pdf`,
> `fill_form` — ISO 32000-1 §14.4 expects a fresh second `/ID` element on update); CMS
> attributes are emitted in canonical DER order (`sign_pdf` — strict verifiers reject
> non-canonical SET OF ordering); Arabic / Persian / Hebrew runs follow UAX #9 for digit order,
> mirroring and ALEF joining (`add_international_text` — the old shaping was incorrect);
> charts whose category labels overlap are thinned automatically (`labelStride: 1` restores the
> old drawing — the old output was unreadable); tagged base-14 documents under PDF/A emit the
> shared WinAnsi `/ToUnicode` CMap (`generate_basic_pdf` / `add_attachment` with `pdfA` —
> required for text extraction under ISO 19005). Per §3 these are correctness fixes, not
> "default value changes". The byte-identity evidence (fixed inputs per tool, PDF bytes
> normalised for `/CreationDate`, XMP dates and the trailer `/ID`, SHA-256 compared between
> v1.5.0 on pdfnative 1.6.0 / SDK 1.29 and v1.6.0):
>
> | Tool (input) | Result | Reason |
> | --- | --- | --- |
> | generate_basic_pdf (plain / chart block) | identical | — |
> | generate_basic_pdf (`pdfA: pdfa2b`) | changed | tagged base-14 docs emit the shared WinAnsi `/ToUnicode` CMap |
> | add_barcode, add_table, embed_image, add_chart | identical | — |
> | add_international_text (ar / he / latin) | changed | UAX #9 fixes: RTL digit order, mirroring, ALEF joining |
> | add_form, fill_form | changed | AcroForm `/Helv` gains `/ToUnicode` in every mode |
> | prepare_signature_placeholder, annotate_pdf | changed | incremental writer: `/ID[1]` regenerated + EOL framing |
> | add_attachment (pdfa3b) | changed | tagged base-14 `/ToUnicode` (as above) |
> | inspect_pdf, verify_pdf, extract_text, validate_pdf, extract_attachments, read_form_fields | identical | — |
> | draft_governance_issue | changed | `HUMAN_GATE` charter text inside the draft and `complianceReport.humanGate` (deliberate charter update) |
> | merge_pdfs, split_pdf, extract_pages, decrypt_pdf | identical | — |
> | encrypt_pdf | changed | non-deterministic by design (random IV / salt) |
> | sign_pdf | n/a | needs key material; covered by real sign → verify round-trips for every algorithm. Default placeholder size is bounded below by 16384 and only grows for signer certificates above ~10 KB; `signingTime` now lands in `/M` (see above) |
>
> The MCP SDK v2 migration itself is byte-transparent on every tool result. The table was
> produced with a scratchpad baseline script (v1.5.0 checkout + fixed inputs); there is no
> in-repo reproduction script for it yet — `creationDate` / `signingTime` now make the date
> normalisation unnecessary, so a future run can compare raw bytes. The
> `add_international_text` row covers Arabic / Hebrew / Latin inputs together; the UAX #9
> reason applies to the RTL inputs, and the Latin input has not been re-measured in
> isolation.

> **v1.5.0 minor bump rationale:** five **new tools** were added — `add_chart`
> (native vector charts on pdfnative 1.6's `ChartBlock`), `read_form_fields` and
> `fill_form` (AcroForm fill/flatten), and `encrypt_pdf` / `decrypt_pdf`
> (Standard Security Handler round-trip). Existing tools gained **optional**
> inputs with backward-compatible defaults: `password` on `inspect_pdf`,
> `verify_pdf`, `extract_text`, `extract_attachments`, `merge_pdfs`, `split_pdf`,
> `extract_pages`; `encrypt` on the three page-tree tools; `includeRuns` /
> `maxTextLength` on `extract_text`; a `chart` block on `generate_basic_pdf`.
> Optional **output** fields were added: `encryptionInfo` on `inspect_pdf` and
> per-page `runs[]` on `extract_text`. New error codes `PASSWORD_REQUIRED`,
> `PASSWORD_INVALID`, `ENCRYPTION_UNSUPPORTED`, `ENCRYPTION_ERROR`,
> `FORM_FIELD_NOT_FOUND`, `FORM_VALUE_TYPE_ERROR`, `FORM_UNSUPPORTED`, `CHART_ERROR`,
> and `UNKNOWN_RESOURCE` are introduced (additive — no existing code was removed or
> repurposed). The server also newly advertises the MCP `resources` capability and
> per-tool `annotations`. All changes are additive per §3; default responses for
> existing tools are byte-identical to v1.4.0.
>
> **One behaviour change to note:** the page-tree tools (`merge_pdfs`,
> `split_pdf`, `extract_pages`) previously rejected *every* encrypted source with
> `ENCRYPTED_SOURCE`. They now accept encrypted sources via `password`; an
> empty-user-password document processes transparently, and a password-protected
> source supplied without a password returns the more specific `PASSWORD_REQUIRED`
> (or `PASSWORD_INVALID`). No previously-succeeding call changes behaviour — only
> inputs that previously failed now either succeed or return a more precise code.
> `ENCRYPTED_SOURCE` is retained by `annotate_pdf` (which does not accept a
> password).

> **v1.4.0 minor bump rationale:** two **new tools** were added — `annotate_pdf`
> (markup-overlay annotations on pdfnative v1.5.0's incremental-update annotation writer)
> and `draft_governance_issue` (local, network-free GitHub-issue drafter with a compliance
> report). `inspect_pdf` gained an **optional** `pageLabels[]` output field (additive, only
> present when the PDF declares `/PageLabels`); `add_international_text` gained the explicit
> `math` lang code (a new accepted enum value that older callers can ignore). A new
> `GOVERNANCE_VIOLATION` error code is introduced for `draft_governance_issue` only. The
> server also newly advertises the MCP `prompts` capability (`governance_contract`,
> `draft_issue_workflow`). All changes are additive per §3; default responses for existing
> tools are byte-identical to v1.3.0.

> **v1.3.0 minor bump rationale:** three **new tools** (`merge_pdfs`, `split_pdf`,
> `extract_pages`) were added on pdfnative v1.4.0's page-tree API, and several authoring
> tools gained **optional** inputs with backward-compatible defaults — `generate_basic_pdf`
> gained nested-list items, `outline`, `pageLabels`, `viewerPreferences`; `add_table` gained
> `cellBorders`, `cellVAlign`, `viewerPreferences`; `add_international_text` gained
> `viewerPreferences`. All are additive per §3 ("new tool" / "new optional input field with a
> backward-compatible default"). `sign_pdf` now signs through a `node:crypto` provider for
> RSA and EC-DER keys with a transparent pure-JS fallback — an internal hardening change that
> leaves input/output shapes and produced signatures interoperable. Default responses for the
> existing tools are byte-identical to v1.2.0. `split_pdf` introduces a new multi-output
> response shape (`{ mode, count, totalSizeBytes, parts[] }`), documented in its `outputSchema`.

> **v1.2.0 minor bump rationale:** the read-only tools (`inspect_pdf`, `verify_pdf`,
> `validate_pdf`, `extract_text`, `extract_attachments`) gained two **optional** inputs —
> `verbosity` (`'summary'` | `'full'`, default `'full'`) and `fields` (dot-path projection) —
> both backward-compatible additions per §3 ("new optional input field with a
> backward-compatible default"). `generate_basic_pdf` and `add_table` gained an optional
> `watermark`; `generate_basic_pdf` and `add_international_text` gained an optional
> `normalize`. A new tool (`extract_attachments`) and a dependency bump (zod 3 → 4) are
> likewise additive. Default responses are byte-identical to v1.1.0.
>
> **One ergonomic change to PDF-producing tools:** in base64 mode the generated PDF bytes
> are now delivered **once** as an embedded `resource` content block (a `data:` URI) and are
> no longer duplicated into `structuredContent.base64`. `base64` was an *optional* output
> field (never in `required`), so this is not a major break; consumers should read the PDF
> from the resource block. `structuredContent` for base64 mode is now `{ mode, sizeBytes }`.
> File mode (`{ mode, sizeBytes, filePath }`) is unchanged.
>
> **Summary / projected responses are intentional subsets.** When `verbosity: 'summary'` or
> `fields` is supplied, `structuredContent` is a pruned projection of the default `'full'`
> shape. This is an opt-in token-saving feature. (Since 1.6.0 the read tools' `outputSchema`
> declares every property optional, so a projection still validates against it — see §1.)

Page-tree tools `merge_pdfs`, `split_pdf` and `extract_pages` shipped in v1.3.0 on pdfnative v1.4.0's page-tree API; `annotate_pdf` shipped in v1.4.0 on pdfnative v1.5.0's annotation writer; charts (`add_chart`), form fill/flatten (`read_form_fields`, `fill_form`) and the encrypted round-trip (`encrypt_pdf`, `decrypt_pdf`, `password`/`encrypt` on the page-tree and read-only tools) shipped in v1.5.0 on pdfnative v1.6.0; the PAdES LTV ladder (`add_ltv`, `timestamp_pdf`, `sign_pdf` `profile` / `timestamp`), `update_metadata`, `inspect_layout`, the 13 document block kinds, layout options, build-time `encrypt`, print production and charts v2 shipped in v1.6.0 on pdfnative v1.7.0. `redact_pdf` stays **deferred by design** (pdfnative can overlay/flatten but not remove content — an overlay-only redaction would create false security) and will be added with the same stability guarantees once pdfnative exports a content-removal API. Native ECDSA verification also stays deferred: pdfnative still does not export `ecdsaVerifyHash`, so `verify_pdf` keeps its local P-256 implementation (no contract impact).

> **Design note / follow-up (v1.6.0).** Two places where the wrapper is thicker than it
> should be, recorded here so they are not mistaken for contract:
> - `add_ltv mode: 'offline'` composes the per-signature `/VRI` entries itself — every
>   supplied certificate / OCSP response / CRL is referenced from every signed signature's
>   `/VRI` (the Adobe-tolerant superset) before the material is handed to
>   `embedValidationInfo`. An upstream helper that derives the `/VRI` mapping from the
>   material will be requested from pdfnative; when it lands the wrapper will delegate to it
>   with no change to inputs, outputs or error codes.
> - `verify_pdf ltv: true` classifies `ltvLevel` **structurally**: the presence of a verified
>   signature / document timestamp and of revocation material relevant to the signer in
>   `/DSS`. It is not a full ETSI EN 319 102-1 validation (no chain building to a trust
>   anchor at signing time, no responder-signature check, no grace-period logic) — the fixed
>   `caveats[]` says so. A future engine-level validator may tighten the classification; that
>   would be surfaced as a new opt-in field, not a silent change of `ltvLevel`.

---

## 6. Reporting a breaking change

If you believe a change in a release silently broke a stable contract, please open an issue with:
- the affected tool name,
- the input that worked previously,
- the new response or error,
- the previous release version where it worked.

We treat unintended breaking changes as bugs and fix them in a patch release.
