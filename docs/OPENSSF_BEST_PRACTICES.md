# OpenSSF Best Practices — self-assessment

This page maps pdfnative-mcp to the [OpenSSF Best Practices Badge](https://www.bestpractices.dev/)
criteria (the *passing* level, with the *silver* items the project already meets marked
as such). It is the evidence a reviewer needs to verify each claim in the repository
itself; the badge application quotes it. Nothing here is a policy of its own — every line
points at the file or workflow that enforces it.

Status: **self-assessed; badge application pending** (the maintainer submits it —
agents never register the project anywhere).

## Basics

| Criterion | Status | Evidence |
| --- | --- | --- |
| Project website, description | Met | [README.md](../README.md), the npm page, `server.json` (MCP registry). |
| Open-source licence, OSI-approved | Met | [LICENSE](../LICENSE) (MIT); runtime dependencies are MIT too ([THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md)). |
| Documentation: basics and interface | Met | [README.md](../README.md), [AGENT_CONTRACT.md](AGENT_CONTRACT.md) (the consumer contract), [KNOWLEDGE_BASE.md](KNOWLEDGE_BASE.md), [guides/](guides/). The interface itself is self-describing (`tools/list` with `_meta.examples`, `outputSchema`, 7 prompts). |
| HTTPS for the project sites | Met | GitHub, npmjs.com, the MCP registry. |
| Discussion mechanism | Met | [SUPPORT.md](../SUPPORT.md): issues and discussions. |
| English | Met | Code, comments, tests, docs and release notes are English; demonstrated text in another language carries a `demo-language` marker (`verify:docs` rule `prose-language`). |
| Maintained | Met | One release per engine release ([CHANGELOG.md](../CHANGELOG.md), [release-notes/](../release-notes/)); issues are triaged within five business days ([SUPPORT.md](../SUPPORT.md)). |

## Change control

| Criterion | Status | Evidence |
| --- | --- | --- |
| Public version-controlled repository | Met | GitHub; interim versions are visible as commits and branches. |
| Unique version numbers, semantic versioning | Met | `package.json`, `server.json`, `src/version.ts`, `CITATION.cff` move in lock-step ([tests/metadata.test.ts](../tests/metadata.test.ts)); [API_STABILITY.md](API_STABILITY.md) is the charter. |
| Release notes | Met | [CHANGELOG.md](../CHANGELOG.md) and one `release-notes/vX.Y.Z.md` per release, each listing every runtime change, byte change and upgrade note. |
| Tags for releases | Met | `v*` tags, protected by `.github/rulesets/tags.json` (never deleted or moved). |

## Reporting

| Criterion | Status | Evidence |
| --- | --- | --- |
| Bug-reporting process | Met | Issue templates; agents draft issues locally through `draft_governance_issue` and a human submits ([guides/AI_GOVERNANCE.md](guides/AI_GOVERNANCE.md)). |
| Vulnerability-reporting process, private | Met | [SECURITY.md](../SECURITY.md): GitHub private advisories or `security@pdfnative.dev`; acknowledgement within 72 hours, fix and coordinated advisory within 30 days. |
| Archive of reports | Met | GitHub issues; the *Disclosure history* section of [SECURITY.md](../SECURITY.md). |

## Quality

| Criterion | Status | Evidence |
| --- | --- | --- |
| Working build system | Met | `npm run build` (`tsc`), `npm run gate` as the single definition of green ([scripts/gate.ts](../scripts/gate.ts), [guides/LOCAL_TESTING.md](guides/LOCAL_TESTING.md)). |
| Automated test suite | Met | vitest: one suite per tool and module, examples-as-tests, the conformance corpus under veraPDF, a byte baseline of 112 samples, fuzz targets on a seed corpus. Coverage thresholds are enforced in [vitest.config.ts](../vitest.config.ts) and only ever move up. |
| New functionality tested | Met | Every tool change touches its test, its example and the engine-surface matrix ([AGENTS.md](../AGENTS.md) §Architecture); `verify:docs` fails on a missed step. |
| Warning flags | Met | TypeScript strict, `eslint --max-warnings 0`, `tsc` over `src/`, `tests/` and `scripts/`. |
| Continuous integration (silver) | Met | Required checks on Linux (Node 22 and 24), Windows and macOS, the sample baseline and the workflow linter ([.github/rulesets/main.json](../.github/rulesets/main.json)). |
| Reproducible builds (silver) | Met | UTC dates, a pinned creation instant, the sample set held byte for byte ([guides/REPRODUCIBLE.md](guides/REPRODUCIBLE.md)); the publish pipeline packs twice and compares digests. |

## Security

| Criterion | Status | Evidence |
| --- | --- | --- |
| Secure development knowledge | Met | [SECURITY.md](../SECURITY.md) threat model; [.github/instructions/security.instructions.md](../.github/instructions/security.instructions.md) is the per-area rule every change is held to. |
| Use basic good cryptographic practices | Met | Signing through `node:crypto` for DER keys; RSA and ECDSA P-256 verification through the engine; AES-128 / AES-256 for output, RC4 read-only; passwords and key material never logged ([SECURITY.md](../SECURITY.md)). |
| Secured delivery against MITM | Met | npm Trusted Publishing with provenance, three SBOMs and a build attestation on every release; `npm audit signatures` verifies an install. |
| Publicly known vulnerabilities fixed | Met | `npm audit --audit-level=high` in CI and weekly; Dependabot on every ecosystem with a seven-day cooldown; Dependency Review on every pull request. |
| No leaked credentials | Met | No secret in the repository; `persist-credentials: false` on every checkout; secrets scoped to the `npm-publish` environment. |
| Input validation at the boundary (silver) | Met | Zod `.strict()` on every tool input, every failure coded ([AGENT_CONTRACT.md](AGENT_CONTRACT.md) §6); the boundary is fuzzed (ClusterFuzzLite, `fuzz/`). |
| Hardening (silver) | Met | Filesystem sandbox, SSRF guard, loopback-only HTTP with an optional bearer token, decompression cap, image-byte budget, hardened CI runners in block mode ([SECURITY.md](../SECURITY.md)). |

## Analysis

| Criterion | Status | Evidence |
| --- | --- | --- |
| Static code analysis | Met | CodeQL (`javascript-typescript` and `actions`, `security-extended`) weekly and on pull requests; ESLint; zizmor + actionlint on the workflows. |
| Dynamic code analysis | Met | ClusterFuzzLite over the `tools/call` boundary (`fuzz.yml`), the targets replayed on a seed corpus at every gate ([guides/LOCAL_TESTING.md](guides/LOCAL_TESTING.md) §3.5). |
| Medium and higher findings fixed | Met | Code-scanning and Dependabot alerts are triaged in each release ([release-notes/](../release-notes/)). |

## Not applicable or accepted

- **Two-person review of every change** — a single-maintainer project; every change is reviewed by the maintainer before it lands, and agents never merge ([.github/AGENT_RULES.md](../.github/AGENT_RULES.md)). Also listed under *Accepted OpenSSF Scorecard findings* in [SECURITY.md](../SECURITY.md).
- **Cryptographic agility beyond the engine** — the algorithm set (RSA PKCS#1 v1.5 with SHA-256/384/512, ECDSA P-256) is the engine's; a signature outside it is reported as invalid, never as valid. Extending it is an upstream change.
- **A memory-safe language** — TypeScript on Node.js; the only native code is the runtime's.
