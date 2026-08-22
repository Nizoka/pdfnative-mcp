# Draft issue for Nizoka/pdfnative (docs repo): reflect pdfnative-mcp v1.6.0 in `ecosystem.json` and `docs/guides/mcp.md`

> **HUMAN-SUBMITTED DRAFT.** Produced locally under the AI-governance / human-in-the-loop
> contract ([.github/ai-governance.json](../ai-governance.json),
> [.github/AGENT_RULES.md](../AGENT_RULES.md)). Nothing in this repository or in the
> `pdfnative-mcp` server can submit it. A maintainer must review it, validate it with
> `npm run verify:issue -- .github/drafts/issue-v1.6.0-ecosystem.md`, and open it on
> GitHub under their own identity — they share responsibility for the content.
>
> Suggested title: **docs: update ecosystem.json + guides/mcp.md for pdfnative-mcp v1.6.0 (27 tools, pdfnative ^1.7.0)**
> Target repository: `Nizoka/pdfnative` · Labels: `documentation`, `ecosystem`
> Affected packages: `pdfnative` (docs only), `pdfnative-mcp` (none — no code change)
> Runtime dependencies introduced: **none** (zero-dependency policy preserved)

## Summary

`pdfnative-mcp` **v1.6.0** (released 2026-08-23, built on **pdfnative 1.7.0**) ships three
new tools (`add_ltv`, `timestamp_pdf`, `update_metadata`), the full PAdES LTV ladder, print
production, charts v2, PDF/A font embedding + diagnostics, and the MCP 2026-07-28 protocol
on the MCP TypeScript SDK v2. The docs site still describes v1.5.0 / 24 tools:

- `docs/assets/ecosystem.json` → `packages["pdfnative-mcp"]` says `version: "1.5.0"`,
  `pin: "^1.6.0"`, `toolCount: 24`.
- `docs/guides/mcp.md` says "exposes **24 tools**" and its tool table stops at the v1.5.0
  additions.

## Reproduction (executed locally)

```bash
# docs repo
node -e "const e=require('./docs/assets/ecosystem.json').packages['pdfnative-mcp']; console.log(e.version, e.pin, e.toolCount, e.tools.length)"
# → 1.5.0 ^1.6.0 24 24

# pdfnative-mcp v1.6.0 checkout (release/v1.6.0)
node -e "const p=require('./package.json'); console.log(p.version, p.dependencies.pdfnative)"
# → 1.6.0 ^1.7.0
npx vitest run tests/metadata.test.ts tests/server.test.ts
# → metadata lock-step passes; tools/list advertises 27 tools
```

**Result:** the ecosystem entry and the MCP guide lag the published package (version,
engine pin and tool count all stale; three tools undocumented).

**Expected:** `ecosystem.json` and `guides/mcp.md` describe v1.6.0 exactly.

## Proposed change 1 — `docs/assets/ecosystem.json`

Replace `packages["pdfnative-mcp"]` with:

```json
{
  "version": "1.6.0",
  "pinField": "dependencies",
  "pin": "^1.7.0",
  "repo": "https://github.com/Nizoka/pdfnative-mcp",
  "toolCount": 27,
  "tools": [
    "add_attachment",
    "add_barcode",
    "add_chart",
    "add_form",
    "add_international_text",
    "add_ltv",
    "add_table",
    "annotate_pdf",
    "decrypt_pdf",
    "draft_governance_issue",
    "embed_image",
    "encrypt_pdf",
    "extract_attachments",
    "extract_pages",
    "extract_text",
    "fill_form",
    "generate_basic_pdf",
    "inspect_pdf",
    "merge_pdfs",
    "prepare_signature_placeholder",
    "read_form_fields",
    "sign_pdf",
    "split_pdf",
    "timestamp_pdf",
    "update_metadata",
    "validate_pdf",
    "verify_pdf"
  ],
  "prompts": [
    "governance_contract",
    "draft_issue_workflow"
  ]
}
```

(`tools[]` is the sorted list of the 27 names advertised by `tools/list`; `prompts[]` is
unchanged.)

## Proposed change 2 — `docs/guides/mcp.md`

- Header line: "Tracks the latest published `pdfnative-mcp` (**v1.6.0**, built on pdfnative
  **1.7.0**)".
- "exposes **27 tools**"; add three rows to the tool table:
  - `add_ltv` _(v1.6.0)_ — PAdES B-LT: embed a `/DSS` (+ `/VRI`) with certificates and
    OCSP / CRL material; `mode: 'online'` through the operator-configured revocation
    provider, `mode: 'offline'` with caller-supplied DER material (zero network).
  - `timestamp_pdf` _(v1.6.0)_ — PAdES B-LTA: append an RFC 3161 `/DocTimeStamp` from the
    operator-configured TSA; re-run to extend the archival chain.
  - `update_metadata` _(v1.6.0)_ — rewrite `/Info` title / author / subject / keywords (+ XMP)
    of an existing PDF as an incremental update.
- `sign_pdf` row: add `profile: 'pades'`, `timestamp: true` (B-T), RSA-SHA384/512,
  `certChainDerBase64`, `fieldName` / `allowMultiple`; `verify_pdf` row: document timestamps
  verified, `ltv: true` reports `ltvLevel`.
- `add_chart` row: charts v2 — `stackedBar` / `stackedBarH` / `area` / `scatter`, `axis2`,
  `axis.scale: 'log'`, `xAxis.type: 'linear' | 'time'`, `dataLabels`, `labelStride`.
- New short sections (or pointers to the pdfnative-mcp guides):
  - **Print production** — `print` (boxes, `bleed`, `marks`, `userUnit`), `metadata`
    (`trapped`), `outputIntent`, print-dialog `viewerPreferences` on every document tool
    → `docs/guides/PRINT.md` in pdfnative-mcp.
  - **PDF/A honesty** — `embedFonts: true` required for a valid claim (base-14 Helvetica is
    not embedded), `strict`, `includeDiagnostics` → `docs/guides/PDFA.md`.
  - **Network policy** — no outbound call by default; only operator-configured TSA / OCSP /
    CRL endpoints via `PDFNATIVE_MCP_TSA_URL`, `PDFNATIVE_MCP_TSA_AUTH` (secret),
    `PDFNATIVE_MCP_REVOCATION`, `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS`,
    `PDFNATIVE_MCP_NETWORK_TIMEOUT_MS`; tool arguments never supply a URL
    → `docs/guides/LTV.md`.
  - **Protocol** — MCP 2026-07-28 (stateless, `server/discover`, cache hints) on
    `@modelcontextprotocol/server` ^2.0.0 with automatic fallback to the 2025-era
    `initialize` handshake on stdio and HTTP; existing client configurations need no change.
- Env-var table: add the five network variables above.

## Out of scope

- No pdfnative code change. `redact_pdf` stays deferred (no content-removal API);
  `ecdsaVerifyHash` is still not exported (pdfnative-mcp keeps its local P-256 verifier).

## Compliance report

- zero_dependency_confirmed: **true** (documentation-only change)
- reproduction_command: see "Reproduction" above
- reproduction_result: stale version / pin / tool count in `ecosystem.json`; 24 tools in `guides/mcp.md`
- duplicate_search_performed: **to be confirmed by the submitting human** (search open and closed issues in `Nizoka/pdfnative` for "ecosystem.json pdfnative-mcp 1.6")
- affected_packages: `pdfnative` (docs), `pdfnative-mcp` (docs parity)
- identity_reminder_shown: **yes** — this issue is published under the submitting human's GitHub identity.
