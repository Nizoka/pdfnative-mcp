---
description: "Audit pdfnative-mcp for security at the tools/call boundary, the agent contract, PDF/A and PDF/X conformance gates, and reproducible output."
agent: "agent"
---
# Compliance Audit

Perform a compliance audit of pdfnative-mcp. The server is the untrusted-input boundary
around the pdfnative engine: every argument of every `tools/call` comes from a model.
Every finding is reproduced with a command — a test, a script, or a request sent to the
built server (`node dist/cli.js`, after `npm run build`) — and cited with `file:line`.
Report findings with a severity (blocker / major / minor / note), the reproduction command
and the recommended fix; a finding without a reproducible command is not a finding.

## Audit Areas

### 1. Protocol contract (docs/AGENT_CONTRACT.md, docs/API_STABILITY.md)
- On stdio, stdout carries JSON-RPC frames only; every log goes to stderr (gate steps
  `smoke` and `dist-probe`, `tests/cli-stdio.test.ts`)
- Both protocol eras are served by the same binary: MCP 2026-07-28 (`server/discover`) and
  the 2025-era `initialize` handshake, on stdio and on Streamable HTTP
- A tool failure is an `isError` result carrying one documented `ToolError` code; an unknown
  tool name is JSON-RPC `-32602` `[UNKNOWN_TOOL]`. No failure is uncoded
  (`tests/engine-surface.fuzz.test.ts`, `tests/error-codes.test.ts`)
- `structuredContent` validates against the advertised `outputSchema` on the default,
  `verbosity: 'summary'` and `fields` paths (`tests/schema-conformance.test.ts`)
- `tools/list` is a superset of the published 1.5.0 catalogue
  (`tests/catalogue-superset.test.ts`); default responses are byte-identical unless the
  release notes declare the change

### 2. Input boundary
- Every object schema is Zod `.strict()`, at every nesting level, and agrees with the JSON
  Schema advertised for it — send a value at the edge of each new input
- `pdfBase64`, DER and ICC inputs go through `src/base64.ts`; images through `src/image.ts`
  (magic bytes, PNG IHDR, 24 MiB per-call budget)
- Size bounds hold: 50 MiB output, 8 MiB ICC / watermark image, 100 000-char svg, 50 000
  engine blocks, 256 MiB frame; the inflate cap is operator-set
- No `__proto__` / `constructor` / `prototype` key reaches an object the server builds;
  `Object.prototype` is untouched after the fuzz suite
- Hostile PDF bytes end in `PDF_PARSE_FAILED` / `PASSWORD_REQUIRED` /
  `ENCRYPTION_UNSUPPORTED`, never an uncoded failure, a stack overflow or a hang

### 3. Secrets, network and the sandbox
- No key material, password, certificate, `PDFNATIVE_MCP_TSA_AUTH` or
  `PDFNATIVE_MCP_HTTP_TOKEN` in any error message, result or log
- The only egress path is `src/network.ts`, to operator-configured TSA / OCSP / CRL
  endpoints behind the SSRF guard; no tool argument supplies a URL; unconfigured calls fail
  with `TSA_NOT_CONFIGURED` / `REVOCATION_NOT_CONFIGURED` and make no request
- `outputMode: 'file'` writes under `PDFNATIVE_MCP_OUTPUT_DIR` only: absolute paths,
  traversal, NUL bytes and non-`.pdf` extensions are `SECURITY_VIOLATION`
- HTTP mode binds loopback, checks Host and Origin, and honours the opt-in bearer token
- The response cache never persists secret-, time- or network-dependent output, and its
  namespace carries the pinned creation instant

### 4. Operator knobs
- Every `PDFNATIVE_MCP_*` variable (and `SOURCE_DATE_EPOCH`) is read once at boot, declared
  in `server.json`, and an invalid value refuses to start (`tests/metadata.test.ts`,
  `tests/reproducible-build.test.ts`, `tests/inflate-cap.test.ts`)

### 5. Exactly three runtime dependencies
- `package.json` `dependencies` is `pdfnative`, `@modelcontextprotocol/server`, `zod`
  (`tests/tools/workflows.test.ts`); the server reimplements no engine feature on raw
  primitives

### 6. Conformance gates
- PDF/A: the corpus (`scripts/lib/pdfa-corpus.ts`) validates under veraPDF with the
  negative canaries rejected (`npm run validate:pdfa`); `strict` escalates every `PDFA_*`
  diagnostic to `PDF_A_COMPLIANCE_VIOLATION`
- PDF/X-4: `pdfx: 'pdfx4'` needs a `prtr` output intent and a known trapping state; the
  in-process validator agrees with `validate_pdf standard: 'pdf-x-4'`
  (`npm run validate:pdfx`); its result states that it is not a certified preflight
- One conformance claim per file: `pdfx` × `pdfA` and `pdfx` × `encrypt` are
  `VALIDATION_ERROR`; attachments imply PDF/A-3b; a translucent watermark is refused under
  PDF/A-1b
- Every engine diagnostic code has an executed trigger
  (`tests/diagnostics-triggers.test.ts`) and a row in the agent contract

### 7. Reproducible output
- A pinned `creationDate` — or the operator pin — makes a document byte-identical across
  hosts and time zones (`tests/reproducible-build.test.ts`); dates are written in UTC
- The sample baseline (`tests/_fixtures/samples.sha256.json`) holds; a rebaseline is declared
  in the release note; semantic-mode samples are listed explicitly and for a stated reason
- No `toLocaleString()` without a locale in `src/` or `scripts/`; generators run under
  `TZ=UTC` with the operator knobs scrubbed

### 8. Documentation truth
- `npm run verify:docs` green: every count and version comes from
  `docs/assets/ecosystem.json`; every tool, error code and operator variable the docs name
  exists, and every one that exists is documented; every `#fragment` resolves
- Every input the docs and the tool descriptions name exists in the live schema, and every
  engine option exposed exists in the installed `pdfnative` types — a documented key the
  engine ignores is a major finding
- `tests/_fixtures/engine-surface.json` ties every engine changelog bullet to tests or a
  written waiver; every pinned upstream limit is listed in ROADMAP.md

### 9. Governance
- No `Co-Authored-By` trailer, "Generated with" footer or mention of an AI assistant in the
  branch history, the PR draft or the release notes
- Nothing pushed, tagged, published or opened by an agent (`.claude/hooks/guard.mjs`, wired
  to Bash and PowerShell)
- Issue drafts under `.github/drafts/` pass `npm run verify:issue`
