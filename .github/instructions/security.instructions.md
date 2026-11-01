---
description: "Use when touching file IO, path handling, network egress, operator knobs, or sensitive key/certificate inputs."
applyTo: "src/output.ts,src/network.ts,src/http.ts,src/auth.ts,src/image.ts,src/inflate-cap.ts,src/reproducible.ts,src/cache.ts,src/base64.ts,src/tools/sign-pdf.ts,src/tools/add-ltv.ts,src/tools/timestamp-pdf.ts,src/server.ts,.github/workflows/**"
---
# Security Standards

## Filesystem confinement
- All file writes must stay inside PDFNATIVE_MCP_OUTPUT_DIR.
- Reject:
  - absolute paths
  - .. path traversal
  - NUL byte paths
  - non-.pdf output extensions
- Use safe path resolution and canonicalization before writing.

## Signing input handling
- Treat cert/key fields as sensitive input.
- Validate base64/hex strictly before use — decode through `src/base64.ts` (DER expected; PEM is rejected with a `VALIDATION_ERROR` + openssl remedy).
- Provide clear validation errors without leaking sensitive payload content.
- Never log or echo passwords, key/cert material, `PDFNATIVE_MCP_TSA_AUTH` or `PDFNATIVE_MCP_HTTP_TOKEN`.

## Network and HTTP
- The only egress path is `src/network.ts` (operator-configured TSA / OCSP / CRL endpoints behind the SSRF guard); a tool argument never supplies a URL. A `/URI` written INTO a PDF (the `link` block) is data, not egress.
- HTTP mode (`PDFNATIVE_MCP_PORT`) binds loopback and checks Host/Origin (the Origin port must equal the server port — `src/http.ts`); `PDFNATIVE_MCP_HTTP_TOKEN` (`src/auth.ts`, ≥ 16 chars, constant-time compare, RFC 6750 challenge) is the only authentication — recommend it, and document that without it any local process can reach the endpoint.

## Operator knobs
- Read once at boot, never from a tool argument; an invalid value refuses to start (silently falling back would leave the operator believing a protection is in force): `PDFNATIVE_MCP_MAX_INFLATE_BYTES` (`src/inflate-cap.ts`, zip-bomb cap), `PDFNATIVE_MCP_CREATION_DATE` / `SOURCE_DATE_EPOCH` (`src/reproducible.ts`, pinned creation instant — logged to stderr with its source), `PDFNATIVE_MCP_OUTPUT_BASE_URL` (`src/output.ts`: absolute http(s) URL, no credentials / query / fragment, refused without `PDFNATIVE_MCP_OUTPUT_DIR`; pure string formatting — the server never requests it), `PDFNATIVE_MCP_FONT_DIR` (`src/font-dir.ts`: every `.ttf` / `.otf` parsed by the engine before registration, ≤ 64 files of ≤ 16 MiB, slugs only in results and errors, never a path).
- A new `PDFNATIVE_MCP_*` variable must be declared in `server.json` (`tests/metadata.test.ts` holds the two sets together).
- Images go through `src/image.ts` (magic bytes — JPEG, PNG, JP2 signature box or raw J2K codestream — + PNG IHDR checks, 24 MiB per-call budget); `embed_image.imageBase64` has no length bound (1.5.0 contract) — do not add one. ICC profiles go through `decodeBase64Field` and the engine's `acsp` / size checks.

## Response cache
- Never cache secret-, time- or network-dependent output (`NON_CACHEABLE_TOOLS`, any call carrying `encrypt` or `password`, any `outputMode: 'file'`): a secret never feeds a cache key and a protected document's content never lands on disk in plaintext. The namespace carries the API version, the server version, the pinned creation instant and the fingerprint of the font sandbox (`customFontCacheTag()`), so a face replaced on disk is never served from an earlier render.

## Dependency and CI security
- Exactly three runtime dependencies (pdfnative, `@modelcontextprotocol/server`, zod); adding one is a governance blocker. The fuzzing engine (Jazzer.js) lives in `.clusterfuzzlite/engine/` with its own lockfile and never in `package.json`.
- `publish.yml` is the five-job graph `guard → build → publish → attest → registry`: the guard refuses anything but a `v*` tag before any approval; the build job runs the publish gate and packs once (digests recorded, no `id-token`); the publish job installs nothing, fetches the npm client by SHA-512, re-verifies the tarball and mints the only npm token (`npm-publish` environment, Trusted Publishing, `--provenance`); the attest job fetches the registry's bytes, checks them against the build digests, attests them with three SBOMs (`npm sbom`: runtime CycloneDX + SPDX, toolchain) and attaches everything to the release; the registry job publishes `server.json` with the workflow's OIDC identity through a version-, SHA-256- and cosign-verified `mcp-publisher`. `id-token: write` only where nothing from the lockfile runs.
- Every workflow job: `step-security/harden-runner` first — `egress-policy: block` with an allow-list where the hosts are known, `audit` with a dated reason comment elsewhere (Windows runners: audit only; macOS: skipped, the action does not support it) —, `persist-credentials: false`, `npm ci --ignore-scripts`, explicit job-scoped `permissions` (never a top-level write), a timeout, values passed to `run:` through `env:` (never a `${{ }}` inside a script); one commit SHA per action across the tree. `tests/tools/workflows.test.ts` asserts all of it — update the test in the same change as a workflow.
- Required checks (`.github/rulesets/main.json`): `ci (22)`, `ci (24)`, `os (windows-latest)`, `os (macos-latest)`, `sample-regression`, `workflow-lint` (zizmor + checksummed actionlint). `node-current.yml` (Node 26) and `fuzz.yml` are advisory and never hide a red run with `continue-on-error`.
- `.npmrc` sets `ignore-scripts=true`: nothing builds on install, the gate builds. The gate's `pack-manifest` step holds the files `npm pack` ships to `tests/_fixtures/pack-manifest.json` and packs twice (byte-identical).
- Keep the lockfile committed; `npm audit --audit-level=high` runs in CI and weekly; Dependency Review runs on every pull request; CodeQL (`actions` + `javascript-typescript`, `security-extended`) and Scorecard run weekly; Dependabot waits seven days on every ecosystem.
- veraPDF is downloaded at a pinned version and checked against a committed SHA-256 before it is executed (`.github/actions/setup-verapdf`; its `home` output is what `VERAPDF_HOME` must name).

## Fuzzing
- `fuzz/*.js` are the ClusterFuzzLite targets over the boundary (`src/fuzz-surface.ts`: tools/call arguments, base64, images, the output sandbox, the HTTP guards). A target rethrows a programming error, reports an uncoded tool failure or a sandbox escape, and swallows nothing else. `tests/fuzzing/targets.test.ts` runs every target against `src/` on a seeded corpus (`tests/fuzzing/_fuzz-seeds.ts`) at every gate; `fuzz.yml` runs them coverage-guided (code-change on pull requests, batch weekly).
