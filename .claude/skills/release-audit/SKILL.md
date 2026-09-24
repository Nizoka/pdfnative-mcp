---
name: release-audit
description: Pre-release audit of pdfnative-mcp — two parallel auditors (claims vs code; docs, counters and agent surfaces), an adversarial verifier, an agent-autonomy pass and a GO/NO-GO ledger under .audit/<version>/. Run by the maintainer before every release; never invoked by the model on its own.
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(npm run *), Bash(npx tsx scripts/*), Bash(npx vitest *), Bash(node dist/cli.js*), Bash(git diff*), Bash(git log*), Bash(git show*), Agent
argument-hint: [release-notes/vX.Y.Z.md] [previous-tag]
---

# Release audit

Audit the release described by `$0` (default: the newest `release-notes/v*.md`) against everything that changed since `$1` (default: the previous `v*` tag from `git tag -l`). The audit produces findings, never fixes: every fix goes through the normal edit → gate loop afterwards, and the ledger records what was fixed.

Read `ledger.md` first for the ledger and verdict formats. Each phase below hands a template to the agents it spawns; the agents return findings, you file them.

## Ledger location

`.audit/<version>/` — git-ignored (check `.gitignore` covers it before writing; it is NOT under `test-output/`, which Claude Code is denied to Read), so nothing here is ever committed. One Markdown file per report: auditor-a, auditor-b, verifier-1, auditor-d, verifier-2, then the ledger and the verdict (formats in `ledger.md`).

## Phase A and B — two auditors, in parallel

Spawn both with the Agent tool in the same message (distinct angles; neither sees the other's report):

- **Auditor A — claims vs code.** Template: `auditor-a.md`. Every claim in the release note and the top CHANGELOG entry is checked against `src/tools/`, the shared fragments under `src/`, `tests/`, `examples/` and `scripts/`; at least one assertion per claim is *reproduced with a command* (a test, a script, a `tools/call` against the BUILT server), not inferred from reading.
- **Auditor B — docs and agent surfaces.** Template: `auditor-b.md`. The README tool matrix, `docs/AGENT_CONTRACT.md`, `llms.txt`, `docs/AI_GUIDE.md`, `docs/API_STABILITY.md` §5, the live `tools/list` descriptions, `SERVER_INSTRUCTIONS` and the prompts, `server.json`, `docs/assets/ecosystem.json` counters, the sample baseline, the conformance corpus — every surface an agent or a human reads — compared with the behaviour that actually shipped.

Both write their report in the finding format of `ledger.md` (id, severity, claim, evidence command, observed, expected).

## Phase C — adversarial verifier

Spawn one verifier (template: `verifier.md`) with both reports. It re-derives every finding from scratch — re-runs the evidence command, reads the cited lines — and stamps each one `CONFIRMED | DOWNGRADED | REJECTED | DUPLICATE` with a one-line justification. Auditors have about 10 % false findings; the verifier exists to keep them out of the ledger. A finding the verifier cannot reproduce is `REJECTED`, not "probably fine".

## Phase D — agent-autonomy pass, then verify

Spawn Auditor D (template: `auditor-b.md`, section "Autonomy pass") with one question: *can an agent that has only what an MCP host shows it — `tools/list` (names, descriptions, input schemas, `_meta.examples`), `serverInfo.instructions`, `prompts/get`, `resources/list`, plus `llms.txt` and `docs/AGENT_CONTRACT.md` — drive every 1.x feature without reading `src/`?* It picks every feature the release note names plus a sample of older ones, writes the `tools/call` it would send from those surfaces alone, and sends it to the built server. Then a second verifier pass (template: `verifier.md`) over its findings.

## Phase E — GO / NO-GO

Merge the confirmed findings into the ledger, then write the verdict file (both formats are in `ledger.md`):

- **GO** — no CONFIRMED finding of severity `blocker`; every `major` has a fix commit or an explicit maintainer waiver in the ledger.
- **NO-GO** — otherwise. List the blockers first, each with its evidence command, so the fix loop starts from the ledger, not from memory.

Report the verdict, the counts per severity and per stamp, and the ledger path. Do not push, tag, open a PR or publish: `scripts/release-prepare.ts` and the maintainer take over from `GO`.

## Driving the built server

The server speaks newline-delimited JSON-RPC on stdio and exits when stdin closes, so one call is one shell command — write the request lines to a file with Write, then `node dist/cli.js < request.jsonl`. Read the frames on stdout; the boot log is on stderr. `tests/_stdio-session.ts` is the same harness in test form, and `scripts/helpers/server.ts` calls `callToolDirect()` of `dist/server.js` without a transport.

## Known blind spots

Add a check for each of these to the auditor briefs; they are where an audit of this server misses something.

- **Two schemas per tool, kept in step by hand.** Every tool has a JSON Schema (what `tools/list` advertises) and a Zod schema (what the handler enforces). `tests/_fixtures/tool-shape.json` proves the STRUCTURE of the first only; nothing proves the two agree on a bound, an enum or a nested key unless a test sends a value at the edge. For each new input, send one value the JSON Schema accepts and check the handler accepts it, and one it rejects.
- **Capability negotiation and the legacy fallback.** The same binary serves MCP 2026-07-28 (`server/discover`) and the 2025-era `initialize` handshake, on stdio and on HTTP. A feature that only works in one era ships silently: the unit tests call handlers directly. `tests/cli-stdio.test.ts` and `tests/http-modern.test.ts` are the only places the eras are exercised.
- **stdout purity.** One `console.log` anywhere under `src/` — or in a dependency — corrupts the stdio framing for every host. The gate's `smoke` and `dist-probe` steps catch the built tree; an engine diagnostic that falls back to `console.warn` (a build path without the `onDiagnostic` sink) goes to stderr and is invisible to them.
- **`structuredContent` versus `outputSchema`.** The read tools' output schemas are projectable (every property optional) so a `fields` / `verbosity` projection always validates — which also means a missing field never fails validation. Check new output fields on the default, `summary` and projected paths, and on the error path.
- **Cache poisoning.** `PDFNATIVE_MCP_CACHE_DIR` serves earlier bytes for equal inputs. A new tool whose output depends on a secret, the clock, the network or an operator knob must be in `NON_CACHEABLE_TOOLS` or carry its dependency in the namespace (`cacheNamespace()`); a call carrying `encrypt` is never cached. A miss here is silent and wrong.
- **The SSRF guard.** The only egress is `src/network.ts`, to operator-configured endpoints; a tool argument must never supply a URL. Grep new inputs for `url`, `uri`, `endpoint`, `href`; a `/URI` written INTO a PDF is data, not egress.
- **The output sandbox.** `outputMode: 'file'` writes under `PDFNATIVE_MCP_OUTPUT_DIR` only; the deprecated misspelt alias `PDFNATIVE_MPC_OUTPUT_DIR` is still honoured. A new file-writing path that bypasses `src/output.ts` is a blocker.
- **`TOOL_API_VERSION`.** A schema or error-code change that ships without the bump leaves hosts and the response cache on a stale contract. Diff `tests/_fixtures/tool-shape.json` and the error table of `docs/AGENT_CONTRACT.md` against the previous tag.
- **Byte identity is proven for the corpus only.** `tests/_fixtures/samples.sha256.json` holds the samples the generator produces; a behaviour change on an input no example exercises is invisible to it. The six PKI / TSA examples are not fingerprinted at all — vitest runs them.
- Regex-driven `verify:docs` rules are blind to wording: they prove counts, versions, links and presence, never that a sentence is true.
- CI assumptions live outside the repo: Trusted Publishing needs npm ≥ 11.5.1 on the runner (publish.yml installs it) and the `npm-publish` environment must exist and be bound on npmjs.com; a green local gate proves nothing about the publish job.
- Auditors have ~10 % false findings — never file an unverified finding, and never let a `REJECTED` one reach the verdict.
- Publish-related strings in a shell command trip the guard hook (`.claude/hooks/guard.mjs`, wired to Bash and PowerShell): anything containing `npm publish`, `gh release`, `git push` or `git tag <name>` inside a segment, a `$( )`, or an interpreter payload is refused. Write such strings into files with Edit or Write, never through `echo` or a heredoc.
