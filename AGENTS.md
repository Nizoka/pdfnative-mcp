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

## 1. Tool catalogue (27 tools)

| # | Tool | Use it for | Read-only |
|---|------|-----------|:---:|
| 1 | `generate_basic_pdf` | Plain documents (headings, paragraphs, nested lists, **`chart` blocks**). Optional `pdfA`, `watermark`, `normalize`, `outline` (bookmarks), `pageLabels`, `viewerPreferences`, `print`, `metadata`, `outputIntent`, `embedFonts`, `strict`, `includeDiagnostics`. | |
| 2 | `add_barcode` | QR / Code 128 / EAN-13 / Data Matrix / PDF417. Same print / PDF/A options³. | |
| 3 | `add_international_text` | 24 scripts + colour emoji (flag / ZWJ sequences), BiDi + OpenType shaping. Optional `normalize` (default `NFC`), `viewerPreferences`, `print`, `metadata`, `strict`, `includeDiagnostics` (fonts are always embedded, so no `embedFonts`). | |
| 4 | `add_table` | Tabular reports (wrap, repeatHeader, zebra, caption, `cellBorders`, `cellVAlign`…). Optional `watermark`, `viewerPreferences`, print / PDF/A options³. | |
| 5 | `add_form` | Create a **new** interactive AcroForm (text, checkbox, radio, dropdown). Print / PDF/A options³. | |
| 6 | `read_form_fields` | Enumerate an **existing** AcroForm's fields (name, type, value, widgets). Supports `password`. | ✓ |
| 7 | `fill_form` | Fill / flatten an **existing** AcroForm (incremental update). Supports `password`. | |
| 8 | `add_chart` | Native vector charts v2 (bar / barH / stackedBar / stackedBarH / line / area / scatter / pie / donut; `axis2`, log / time scales, `dataLabels`, `labelStride`), PDF/A-safe. Print / PDF/A options³. | |
| 9 | `embed_image` | Embed a JPEG/PNG into a titled PDF. Print / PDF/A options³. | |
| 10 | `prepare_signature_placeholder` | Customize the `/Sig` placeholder before signing (signer metadata, `subFilter`, `reserveTimestamp`, `placeholderBytes`). Print / PDF/A options³. | |
| 11 | `sign_pdf` | PAdES B-B / B-T CMS signature (RSA-SHA256/384/512, ECDSA-P256; `profile:'pades'`, `timestamp`, `certChainDerBase64`, `fieldName`, `allowMultiple`, `signingTime`); DER keys sign through constant-time `node:crypto` (raw P-256 scalars through the pure-JS signer). Auto-injects a placeholder. Never cached. | |
| 12 | `add_ltv` | PAdES B-LT: embed `/DSS` + `/VRI` (certs, OCSP, CRLs). `mode:'online'` via the operator provider, `mode:'offline'` with caller-supplied DER material. | |
| 13 | `timestamp_pdf` | PAdES B-LTA: append an RFC 3161 `/DocTimeStamp` from the operator TSA; re-run to extend the chain. | |
| 14 | `verify_pdf` | Verify every PAdES signature and document timestamp (integrity + value + chain; verification is pure JS). A `/DocTimeStamp` counts in `allValid` like any signature. `ltv:true` adds profile / timestamp / revocation / `ltvLevel`. Supports `password`. | ✓ |
| 15 | `validate_pdf` | PDF/UA (ISO 14289-1) structural conformance. | ✓ |
| 16 | `inspect_pdf` | Metadata: version, pages (+ boxes), encryption (+ `encryptionInfo`), PDF/A claim (not its validity), signatures (+ `signatures:true` inventory, `dss`, `docTimestampCount`), `trapped`, attachments. `check:[…]` → `checks` with the requested keys only + `checksPassed`. Supports `password`. | ✓ |
| 17 | `update_metadata` | Rewrite `/Info` title / author / subject / keywords (+ XMP, incl. XMP dates) of an **existing** PDF (incremental update; unencrypted only). | |
| 18 | `add_attachment` | PDF/A-3 with embedded files (Factur-X / ZUGFeRD). Print / PDF/A options³. | |
| 19 | `extract_attachments` | Read embedded files back out (byte-for-byte). Supports `password`. | ✓ |
| 20 | `extract_text` | Unicode text extraction (resolves `/ToUnicode`), optional positioned `runs`. Supports `password`. | ✓ |
| 21 | `merge_pdfs` | Concatenate 2–50 PDFs into one (page-tree API; page boxes preserved). Optional `password` / `encrypt`. | |
| 22 | `split_pdf` | Split a PDF into one document per page range (multi-output). Optional `password` / `encrypt`. | |
| 23 | `extract_pages` | Pull an arbitrary page subset into a single PDF. Optional `password` / `encrypt`. | ✓¹ |
| 24 | `encrypt_pdf` | Re-secure a PDF with AES-128 / AES-256 (owner/user passwords, permissions, rotation). | |
| 25 | `decrypt_pdf` | Emit an unencrypted copy of an RC4 / AES-128 / AES-256 document. | |
| 26 | `annotate_pdf` | Add markup annotations (highlight, sticky note, square/circle, line, freetext). Visual overlay only — does **not** redact underlying content. | |
| 27 | `draft_governance_issue` | Draft a governance-compliant GitHub issue for **human** review. Produces a local draft + compliance report; **never submits**, no network. | ✓² |

¹ `extract_pages` only reads the source, but it produces a new PDF, so it is not annotated `readOnlyHint`.
² `draft_governance_issue` is read-only in the default inline mode; `outputMode:'file'` writes a `.md` into the sandbox, so its `readOnlyHint` is `false`.
³ Print / PDF/A options (v1.6.0, every document-producing tool): `print` (`bleed` shorthand or `trimBox` / `bleedBox` / `artBox` / `cropBox`, `marks`, `userUnit`), `metadata` (`author`, `subject`, `keywords`, `trapped`), `outputIntent` (custom RGB ICC), `embedFonts` (the 8 Latin tools — `add_international_text` always embeds), `strict`, `includeDiagnostics`, and `creationDate` (ISO-8601; pins `/CreationDate`, the XMP dates and therefore the trailer `/ID` — byte-identical output on the same host time zone). `viewerPreferences` also takes `duplex`, `pickTrayByPDFSize`, `printPageRange`, `numCopies`. All optional; defaults stay byte-identical. Unknown or misspelt keys (top-level or nested) are rejected with `VALIDATION_ERROR`.

**Known limitations (engine-side, pdfnative 1.7.0):** `add_form` with `pdfA` + `embedFonts: true` still fails PDF/A-2b under veraPDF — the AcroForm `/DR /Helv` default-resource font is an unembedded Type1 (ISO 19005-2 rule 6.2.11.4.1); a candidate upstream issue for `draft_governance_issue`. An unsigned placeholder from `prepare_signature_placeholder` with `pdfA` is not conformant until it is signed (ISO 19005-2 6.4.3, empty `/Contents`); `sign_pdf profile: 'pades'` makes it pass. `inspect_pdf` reports the PDF/A *claim*, never its validity.

## 2. Decision tree

```
Need a NEW PDF?
 ├─ has embedded files (Factur-X/ZUGFeRD)? → add_attachment  (only tool that embeds files; plain documents → generate_basic_pdf)
 ├─ a chart (bar/stacked/line/area/scatter/pie/donut)? → add_chart  (axis2 for a right axis, xAxis.type 'linear'|'time' + xValues, axis.scale 'log')
 ├─ a table/report?                        → add_table
 ├─ non-Latin text / emoji?                → add_international_text
 ├─ a barcode/QR?                          → add_barcode
 ├─ an image?                              → embed_image
 ├─ a NEW interactive form?                → add_form
 └─ otherwise                              → generate_basic_pdf  (supports `chart` blocks)
 Print-ready (bleed, crop marks, boxes)?   → add `print: { bleed, marks }` (+ `metadata.trapped`) to any tool above; `userUnit` not under pdfa1b
 VALID PDF/A claim (veraPDF)?              → add `embedFonts: true` (+ `strict: true` to fail instead of warn, `includeDiagnostics: true` to see why); add_form stays non-conformant (engine gap, see §1)
 Byte-identical output across calls?       → pin `creationDate` (document tools), `signingTime` (sign_pdf / prepare_signature_placeholder), `modDate` (update_metadata) — same host time zone
Work with an EXISTING form?
 ├─ list its fields?                       → read_form_fields
 └─ fill / flatten it?                     → fill_form
Annotate an existing PDF (overlay)?       → annotate_pdf
Change title/author/subject/keywords of an existing PDF? → update_metadata (incremental; sign again afterwards if needed)
Combine / carve existing PDFs?
 ├─ join several into one?                 → merge_pdfs   (password / encrypt optional)
 ├─ split into per-range documents?        → split_pdf    (password / encrypt optional)
 └─ keep an arbitrary page subset (1 PDF)? → extract_pages (password / encrypt optional)
Encryption?
 ├─ protect a PDF?                         → encrypt_pdf
 ├─ get an unencrypted copy?               → decrypt_pdf
 └─ just READ an encrypted PDF?            → pass `password` to inspect_pdf / extract_text / …
Need to SIGN?  (PAdES ladder, ETSI EN 319 142-1)
 ├─ B-B  basic signature                   → sign_pdf  (profile:'pades' recommended; rsa-sha256/384/512 or ecdsa-sha256; auto-injects the placeholder)
 ├─ customise the placeholder first?       → prepare_signature_placeholder (subFilter, reserveTimestamp, placeholderBytes, signer metadata, signingTime — frozen at placeholder time) then sign_pdf
 ├─ B-T  + signature timestamp             → sign_pdf with timestamp:true          (needs PDFNATIVE_MCP_TSA_URL)
 ├─ B-LT + certs / OCSP / CRL in /DSS      → add_ltv   mode:'online' (needs PDFNATIVE_MCP_REVOCATION + allow-list) or mode:'offline' (caller-supplied DER, zero network)
 ├─ B-LTA + archival document timestamp    → timestamp_pdf  (needs the TSA; re-run before the TSA cert expires)
 ├─ several signatures?                    → sign_pdf with fieldName (+ allowMultiple:true for the 2nd, 3rd …)
 └─ check the level reached                → verify_pdf with ltv:true  (ltvLevel B-B / B-T / B-LT / B-LTA)
Need to READ a PDF?      (all accept `password` for encrypted sources)
 ├─ metadata/structure?  → inspect_pdf  (pages:true → boxes; signatures:true → field inventory; check:['dss','docTimestamp','trapped'])
 ├─ is it signed?        → inspect_pdf check:['signed'] is STRUCTURAL (a signed field exists); cryptographic validity → verify_pdf
 ├─ signatures valid?    → verify_pdf  (ltv:true → ltvLevel; keep fields:['ltvLevel'] or verbosity:'summary' — both keep it)
 ├─ PDF/UA conformant?   → validate_pdf
 ├─ embedded files?      → extract_attachments
 ├─ form fields?         → read_form_fields
 └─ plain text (+runs)?  → extract_text
Propose a bug/feature to GitHub? → draft_governance_issue (local draft; a human reviews & submits)
```

## 3. Token-frugal responses

The six read-only tools (`inspect_pdf`, `verify_pdf`, `validate_pdf`, `extract_text`,
`extract_attachments`, `read_form_fields`) accept two optional inputs (defaults unchanged):

- `verbosity: 'summary'` — compact scalar verdict; drops heavy arrays / full text but
  keeps the scalars you branch on (`inspect_pdf`: `docTimestampCount` / `trapped` /
  `checksPassed` when present; `verify_pdf`: `ltvLevel` with `ltv: true`).
- `fields: ['a', 'b.c']` — dot-path projection (array segments map over elements),
  applied **after** `verbosity`. Unmatched paths are omitted, and the result then
  carries `_meta.unmatchedFields` + `_meta.availableFields` so a typo is visible.

Smallest "signed & valid?" probe: `{ pdfBase64, verbosity: 'summary', fields: ['allValid'] }`.
The output schemas of these six tools declare every property optional, so a projected
`structuredContent` always validates against `outputSchema`.

Generated PDFs (base64 mode) are delivered **once** as an embedded `resource`
content block (`data:application/pdf;base64,…`), not duplicated into
`structuredContent` (which is `{ mode, sizeBytes }`, plus `diagnostics[]` when
`includeDiagnostics:true` and a `summary` object for `add_ltv`).

## 4. Output modes & environment

- `outputMode: 'base64'` (default) — bytes in the `resource` block.
- `outputMode: 'file'` — writes inside `PDFNATIVE_MCP_OUTPUT_DIR`. `outputPath`
  must be **relative**, end in `.pdf`, no traversal / absolute paths / NUL bytes.
- `PDFNATIVE_MCP_OUTPUT_DIR` — sandbox root for file output (unset = file mode disabled).
- `PDFNATIVE_MCP_CACHE_DIR` — opt-in SHA-256 cache (1 h TTL, 256 MiB LRU; key namespaced
  by `TOOL_API_VERSION/PDFNATIVE_MCP_VERSION`, so an engine upgrade never serves old
  bytes). Never caches `encrypt_pdf` / `decrypt_pdf` / `sign_pdf` / `add_ltv` /
  `timestamp_pdf` / `update_metadata` (secret-, time- or network-dependent) or any
  file-mode call. A hit carries `_meta.cached: true` and returns the **earlier** call's
  bytes (its `/CreationDate` and `/ID` included) for identical inputs.
- `PDFNATIVE_MCP_PORT` — opt-in Streamable HTTP transport on `127.0.0.1` (stdio otherwise).
- `PDFNATIVE_MCP_HTTP_TOKEN` — opt-in bearer token for the HTTP transport (≥ 16 characters,
  no whitespace; a weaker value aborts startup). When set, every request to `/mcp` must
  carry `Authorization: Bearer <token>` or is answered `401` + `WWW-Authenticate`. Without
  it the HTTP endpoint has **no authentication** — any local process can reach it.
- `PDFNATIVE_MCP_TSA_URL` — RFC 3161 TSA for `sign_pdf timestamp:true` and `timestamp_pdf`
  (unset ⇒ `TSA_NOT_CONFIGURED`). `PDFNATIVE_MCP_TSA_AUTH` — optional `Authorization`
  header value (secret, never echoed).
- `PDFNATIVE_MCP_REVOCATION` — `ocsp` | `crl` | `ocsp,crl` for `add_ltv mode:'online'`
  (unset ⇒ `REVOCATION_NOT_CONFIGURED`); requires `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS`
  (comma-separated `host`, `host:port`, `*.suffix`). Allow-list caveats: entries are
  **hostnames**, not URLs; a `host:port` entry only matches URLs with an *explicit*
  port (the URL parser drops default `:80` / `:443`, so list the bare host for those);
  wildcard entries cannot carry a port; IDN hostnames must be listed in punycode
  (`xn--…`); IPv6 literals in brackets (`[2001:db8::1]`). The guard checks address
  **literals** only — a listed hostname that resolves to an internal address (DNS
  rebinding) is not detected, because there is no resolver without a dependency.
  Material returned by OCSP / CRL responders is parse-validated before it is embedded,
  and response-size caps are enforced while streaming (not after download).
- `PDFNATIVE_MCP_NETWORK_TIMEOUT_MS` — per-request timeout, 1000–120000 (default 10000).

**Privacy / network policy:** no telemetry; outbound network is **none by default** —
the only egress the server can ever perform goes to the operator-configured TSA /
OCSP / CRL endpoints above, never to a URL supplied by a tool argument, never to
GitHub. Document bytes only ever flow back in the JSON-RPC response (a timestamp
request sends only a digest to the TSA; OCSP / CRL requests carry certificate
identifiers). The optional HTTP transport (`PDFNATIVE_MCP_PORT`) binds `127.0.0.1`
only and enables DNS-rebinding protection (foreign `Host`/`Origin` → 403; `GET` /
`DELETE` → 405); that guard does not stop *other local processes* — set
`PDFNATIVE_MCP_HTTP_TOKEN` for that. Embedded files are passed through verbatim — the
server never executes, renders, or scans them, so scan untrusted attachments in the caller.

**Protocol:** MCP 2026-07-28 (stateless, `server/discover`, `resultType`, cache
hints) on the MCP TypeScript SDK v2, with automatic fallback to the 2025-era
`initialize` handshake on stdio and HTTP — existing hosts need no change. A
`tools/call` naming an unknown tool is a JSON-RPC protocol error (`-32602`,
`[UNKNOWN_TOOL] Unknown tool: …`), not an `isError` result. Generated files are listed
as `pdfnative://output/<path>` (template `pdfnative://output/{+path}`). Six prompts
ship as ready-made recipes: `pades_ladder`, `print_ready`, `reproducible_output`,
`pdfa_valid`, plus the governance pair `governance_contract` / `draft_issue_workflow`.

## 5. Recipes

- **Factur-X round-trip:** `add_attachment` → `inspect_pdf` → `extract_attachments` → *(optional)* `validate_pdf`.
- **Sign & verify:** `sign_pdf` → `verify_pdf` (add `trustedRootsDerBase64` for chain trust).
- **Sign with timestamp + LTV (PAdES B-LTA):** `sign_pdf` `{ profile: 'pades', timestamp: true, certChainDerBase64: [...] }` → `add_ltv` `{ mode: 'online' }` (or `{ mode: 'offline', certificatesDerBase64, ocspResponsesDerBase64, crlsDerBase64 }` when air-gapped) → `timestamp_pdf` → `verify_pdf` `{ ltv: true }` and read `ltvLevel`. The operator must set `PDFNATIVE_MCP_TSA_URL` (+ `PDFNATIVE_MCP_REVOCATION` / `..._ALLOWED_HOSTS` for online LTV); see [docs/guides/LTV.md](docs/guides/LTV.md).
- **Author PDF/A:** `generate_basic_pdf` / `add_table` with `pdfA: 'pdfa2b'` → `validate_pdf`.
- **Valid PDF/A claim with embedFonts:** any document tool with `pdfA: 'pdfa2b', embedFonts: true, strict: true` — without `embedFonts` the Latin text uses unembedded base-14 Helvetica and veraPDF rejects the claim (`includeDiagnostics: true` surfaces `PDFA_NO_FONT_ENTRIES`). Optional local check: `npm run validate:pdfa`.
- **Print-ready with bleed and marks:** `generate_basic_pdf` / `add_table` / … with `print: { bleed: 8.5, marks: true }, metadata: { trapped: 'False' }` (or explicit `trimBox` / `bleedBox` / `artBox` / `cropBox`; `userUnit` for formats above 14400 pt, not under `pdfa1b`) → `inspect_pdf` `{ pages: true }` to read the boxes back. Boxes survive `merge_pdfs` / `split_pdf` / `extract_pages` — but the XMP packet (and therefore a PDF/A claim) does not: page-tree tools rebuild the document without it. See [docs/guides/PRINT.md](docs/guides/PRINT.md).
- **Stacked / area / scatter / dual-axis chart:** `add_chart` with `chartType: 'stackedBar'` (or `'area'`); scatter needs `xValues` on every series plus `xAxis: { type: 'linear' }` (or `'time'` with ISO-8601 dates); a second series with `yAxis: 'right'` draws `axis2`; `axis: { scale: 'log' }` needs strictly positive, non-stacked data; `dataLabels: true` prints values; crowded labels are thinned automatically (`labelStride: 1` forces all). See [docs/guides/CHARTS.md](docs/guides/CHARTS.md).
- **Update metadata of an existing PDF:** `update_metadata` `{ author, keywords, modDate }` (incremental; `/ModDate` and the XMP dates are rewritten — pin `modDate` for bytes that are identical on the same host time zone) → `sign_pdf` / `timestamp_pdf` again if the latest revision must be signed.
- **Reproducible output:** pin `creationDate` on any document tool (`/CreationDate`, XMP dates, trailer `/ID`), `signingTime` on `sign_pdf` / `prepare_signature_placeholder` (`/Sig /M`; RSA only — ECDSA signatures are randomised by the nonce) and `modDate` on `update_metadata`. Identical bytes on the same host time zone (the engine serialises local time, e.g. `D:20260115100000+01'00'`; run the server under `TZ=UTC` for portability). TSA tokens (`timestamp: true`, `timestamp_pdf`), online `add_ltv` and `encrypt_pdf` (random IV / salt) are never reproducible. Prompt: `reproducible_output`.
- **Valid PDF/A claim with embedFonts:** see the bullet above; the `pdfa_valid` prompt carries the same recipe. Engine gap: `add_form` stays non-conformant (unembedded `/DR /Helv`), and a `prepare_signature_placeholder` output is conformant only once signed.
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
| `VALIDATION_ERROR` | Zod rejected the input: wrong type / bound / enum, an **unknown or misspelt key** (top-level or nested — schemas are strict), an empty or non-base64 payload, PEM armour where DER base64 was expected (certificates, chains, keys, offline LTV material), or a 0-based page index / range out of bounds on `merge_pdfs` / `split_pdf` / `extract_pages` / `annotate_pdf` / `extract_text` | Re-read the field schema (message lists the path and, for PEM, the exact `openssl … -outform DER` remedy); pages are 0-based. |
| `PDF_PARSE_FAILED` | Input PDF malformed/truncated — also raised when `pdfBase64` decodes to PEM text, a nested `data:` URI or base64 encoded twice (the message says which), and by `validate_pdf` on unparsable input | Pass the raw PDF bytes as base64 exactly once (a `data:…;base64,` prefix is tolerated); confirm it opens in a reader. |
| `PDF_A_COMPLIANCE_VIOLATION` | Watermark `opacity < 1.0` under `pdfA:'pdfa1b'`; `strict:true` and the engine raised a PDF/A diagnostic (e.g. `PDFA_NO_FONT_ENTRIES`); `print.userUnit` under `pdfa1b` | Use `opacity:1.0` or `pdfa2b`+; add `embedFonts:true`; drop `userUnit` or target `pdfa2b`+. |
| `PRINT_ERROR` | Engine rejected `print` / `outputIntent` (box outside MediaBox, marks without a TrimBox, non-RGB ICC) | Fix the box coordinates / supply `bleed` or `trimBox` / use an RGB ICC profile. |
| `METADATA_ERROR` | `update_metadata` could not rewrite `/Info` | Check the PDF opens; report with a reproduction if it persists. |
| `GENERATION_FAILED` | Generic engine throw while building a document | The message carries the engine text; fix the input it names. |
| `TSA_NOT_CONFIGURED` | `sign_pdf timestamp:true` / `timestamp_pdf` without `PDFNATIVE_MCP_TSA_URL` (or not an absolute URL) | Operator sets the TSA variables; no request is made otherwise. |
| `TSA_REJECTED` | TSA answered with a failure status, wrong imprint or nonce | Check the TSA endpoint / auth; raise `placeholderBytes` if the token is large. |
| `REVOCATION_NOT_CONFIGURED` | `add_ltv mode:'online'` without `PDFNATIVE_MCP_REVOCATION` + `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS` | Operator configures both, or use `mode:'offline'` with exported material. |
| `NETWORK_HOST_NOT_ALLOWED` | Certificate-advertised OCSP / CRL URL is not allow-listed, not http(s), has credentials, or targets an internal address | Add the responder host to the allow-list (verbatim for IP literals). |
| `NETWORK_ERROR` | TSA / OCSP / CRL request failed (timeout, HTTP error, response cap, invalid timeout / allow-list value) | Check connectivity and the env values; message never contains secrets. |
| `LTV_NO_SIGNATURE` | `add_ltv` on a PDF without a signed signature | Run `sign_pdf` first. |
| `LTV_EMPTY` | Online collection yielded nothing (self-signed chain, no AIA / CRL-DP) | Use `mode:'offline'` with material you hold, or a CA-issued certificate. |
| `LTV_MATERIAL_INVALID` | An offline DER blob (cert / OCSP / CRL) did not parse | Export DER (not PEM); check the field index in the message. |
| `LTV_ERROR` | Other `add_ltv` / `timestamp_pdf` failure | Message carries the engine text. |
| `PLACEHOLDER_AMBIGUOUS` | Several unsigned placeholders and no `fieldName` | Pass `fieldName` (list them with `inspect_pdf signatures:true`). |
| `SIGNATURE_FIELD_NOT_FOUND` | `fieldName` matched no signature field | Check the name via `inspect_pdf signatures:true`. |
| `MISSING_PLACEHOLDER` | `sign_pdf` w/ `autoInjectPlaceholder:false` on unplaceheld PDF | Keep the default `true`, or run `prepare_signature_placeholder`. |
| `PASSWORD_REQUIRED` | Encrypted source, no `password` supplied (read-only or page-tree tools) | Pass the `password` input (user or owner). |
| `PASSWORD_INVALID` | Supplied `password` did not open the document | Check the password; either user or owner works. |
| `ENCRYPTION_UNSUPPORTED` | Security handler this server cannot open | The document uses an unsupported scheme. |
| `ENCRYPTION_ERROR` | Re-encryption failed (e.g. no Web Crypto CSPRNG) | Run under a runtime with Web Crypto available. |
| `FORM_FIELD_NOT_FOUND` | `fill_form` value key matched no field (the message names both remedies) | Use `read_form_fields`, or `onUnknownField:'ignore'`. |
| `FORM_VALUE_TYPE_ERROR` | Wrong value type / choice not in options | Match the field type; use a valid option. |
| `FORM_UNSUPPORTED` | Tried to fill/flatten a signature field | Sign with `sign_pdf` instead. |
| `CHART_ERROR` | Chart (`add_chart` or a `generate_basic_pdf` `chart` block) failed an engine cross-field rule: log scale with non-positive values, scatter without `xValues`, `xValues` length mismatch, `yAxis:'right'` on pie, … | The message carries the remedy; hex colours only. |
| `EXTRACTION_UNSUPPORTED` | **Legacy — never raised since v1.5.0.** Kept in the contract for compatibility only | Encrypted reads use `password` (`PASSWORD_REQUIRED` / `PASSWORD_INVALID` otherwise). |
| `ENCRYPTED_SOURCE` | Encrypted input on `annotate_pdf`, `update_metadata`, `add_ltv`, `timestamp_pdf` (no `password` input). Page-tree and read tools never raise it — they take `password`. | `annotate_pdf` / `update_metadata`: `decrypt_pdf` first (drops signatures + AcroForm), edit, then `encrypt_pdf` again. `add_ltv` / `timestamp_pdf`: decrypting would destroy the signatures — sign and extend the **unencrypted** document, encrypt last (if at all). |
| `ATTACHMENT_NOT_FOUND` | `extract_attachments` `filename` matched nothing | Drop `filename` or list names via `inspect_pdf`. |
| `ATTACHMENT_TOO_LARGE` | `add_attachment` payload > 8 MiB | Shrink/split the payload. |
| `ATTACHMENT_BUILD_FAILED` | `add_attachment`: the engine threw while building the PDF/A-3 document (bad MIME type, unreadable payload, …) | The message carries the engine text; fix the attachment it names. |
| `PLACEHOLDER_FAILED` | `sign_pdf` (auto-inject) / `prepare_signature_placeholder`: the engine could not inject the `/Sig` placeholder | Check the source PDF opens; for a custom `pageIndex` confirm the page exists. |
| `VERIFY_FAILED` | `verify_pdf`: structural failure before signature checks (ByteRange beyond the file, unsupported EC public-key encoding) | Re-encode the base64; confirm the PDF is not truncated. |
| `OUTPUT_TOO_LARGE` | PDF > 50 MiB, or extraction > 16 MiB/file · 32 MiB total | Reduce content; for extraction use `includeData:false` or `filename`. |
| `UNSUPPORTED_LANG` | `add_international_text` `lang` unknown | Use a supported code. |
| `FONT_LOAD_FAILED` | Bundled font module failed to load (`add_international_text` script fonts, or the Noto Sans Latin data behind `embedFonts: true` on the document tools) | Retry; reinstall `pdfnative` if persistent. |
| `SIGNING_FAILED` · `CMS_PARSE_FAILED` · `EC_KEY_PARSE_FAILED` · `EC_CURVE_UNSUPPORTED` | Signing / key-cert problem (key does not match the certificate, unparsable CMS, EC key not P-256) | Check DER encodings (`rsaKeyPkcs1DerBase64` takes PKCS#1 **or** PKCS#8 DER; EC keys SEC1 or PKCS#8); ECDSA must be P-256. PEM input is caught earlier as `VALIDATION_ERROR`. |
| `SECURITY_VIOLATION` | Sandbox / path-traversal rejection | Set `PDFNATIVE_MCP_OUTPUT_DIR`; use a relative `.pdf` path. |
| `MISSING_OUTPUT_PATH` | `outputMode:'file'` without `outputPath` | Pass a relative `outputPath`. |
| `INVALID_PATH` | `outputPath` empty / not a string | Pass a non-empty relative path. |
| `INVALID_EXTENSION` | `outputPath` does not end in `.pdf` (`.md` for `draft_governance_issue`) | Fix the extension. |
| `UNKNOWN_RESOURCE` | `resources/read` with an unknown `pdfnative://` URI — surfaced as JSON-RPC error **`-32602`** (Invalid params), the code is carried in the message | List URIs with `resources/list`. |
| `[UNKNOWN_TOOL]` | **Protocol error, not a tool result:** `tools/call` named a tool that does not exist — JSON-RPC error **`-32602`** with message `[UNKNOWN_TOOL] Unknown tool: <name>` (MCP classifies unknown tools as protocol errors; `isError: true` is reserved for execution failures) | List tools with `tools/list`; names are lower-snake-case. |
| `GOVERNANCE_VIOLATION` | `draft_governance_issue` draft breaks the AI-governance contract (proposes a runtime dependency, missing reproduction, or `duplicateSearchPerformed:false`) | Remove the dependency proposal, include a reproduction, confirm the duplicate search. |

## 7. Contributing to this repo

- Conventions and architecture: [.github/copilot-instructions.md](.github/copilot-instructions.md)
  and the scoped rules under [.github/instructions/](.github/instructions/).
- Strict TypeScript (no `any`); validate every tool input at the boundary with Zod,
  keeping the hand-written JSON Schema and the Zod schema aligned.
- Never write outside `PDFNATIVE_MCP_OUTPUT_DIR`; never echo key/cert material or
  the `PDFNATIVE_MCP_TSA_AUTH` secret in errors or logs.
- Never add an outbound network path: egress is limited to `src/network.ts`
  (operator-configured TSA / OCSP / CRL, SSRF guard) and URLs never come from tool
  arguments.
- Optional advisory check for PDF/A output: `npm run validate:pdfa` (veraPDF over a
  24-file corpus — 22 claiming PDF/A, 3 of them negative canaries, 2 page-tree outputs;
  outcomes `PASS` / `FAIL` / `XFAIL` / `XPASS` / `INFRA` / `SKIP`; `VERAPDF_REQUIRED=1`
  fails closed when veraPDF is absent). The `verapdf.yml` CI job runs it with a
  SHA-256-pinned installer and stays non-blocking in 1.6.0.
- Catalogue parity: `tools/list` wording (descriptions, `_meta.examples`,
  instructions) may change freely; any structural change must be a deliberate
  refresh of `tests/_fixtures/tool-shape.json` (`node scripts/tool-shape.mjs --write`)
  reviewed under `docs/API_STABILITY.md` §5.
- Quality gate (all PRs):

  ```
  npm run typecheck:all && npm run lint && npm run test && npm run test:coverage && npm run build
  ```

- Releases: `release-notes/vX.Y.Z.md` is mandatory and mirrored into `CHANGELOG.md`;
  publish is via GitHub Actions Trusted Publishing (OIDC) — no `NPM_TOKEN`.
