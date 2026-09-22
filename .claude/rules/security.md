---
paths:
  - "src/output.ts"
  - "src/network.ts"
  - "src/http.ts"
  - "src/auth.ts"
  - "src/image.ts"
  - "src/inflate-cap.ts"
  - "src/reproducible.ts"
  - "src/cache.ts"
  - "src/base64.ts"
  - "src/tools/sign-pdf.ts"
  - "src/tools/add-ltv.ts"
  - "src/tools/timestamp-pdf.ts"
  - "src/server.ts"
  - ".github/workflows/**"
---
<!-- GENERATED from .github/instructions/security.instructions.md by scripts/build-claude-rules.ts — do not edit -->

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
- Read once at boot, never from a tool argument; an invalid value refuses to start (silently falling back would leave the operator believing a protection is in force): `PDFNATIVE_MCP_MAX_INFLATE_BYTES` (`src/inflate-cap.ts`, zip-bomb cap), `PDFNATIVE_MCP_CREATION_DATE` / `SOURCE_DATE_EPOCH` (`src/reproducible.ts`, pinned creation instant — logged to stderr with its source).
- A new `PDFNATIVE_MCP_*` variable must be declared in `server.json` (`tests/metadata.test.ts` holds the two sets together).
- Images go through `src/image.ts` (magic bytes + PNG IHDR checks, 24 MiB per-call budget); `embed_image.imageBase64` has no length bound (1.5.0 contract) — do not add one. ICC profiles go through `decodeBase64Field` and the engine's `acsp` / size checks.

## Response cache
- Never cache secret-, time- or network-dependent output (`NON_CACHEABLE_TOOLS`, any call carrying `encrypt`, any `outputMode: 'file'`). The namespace carries the API version, the server version and the pinned creation instant.

## Dependency and CI security
- Exactly three runtime dependencies (pdfnative, `@modelcontextprotocol/server`, zod); adding one is a governance blocker.
- npm publish via OIDC Trusted Publishing only, from the protected `npm-publish` environment, with an exactly pinned npm client, `--provenance`, a CycloneDX SBOM and a build-provenance attestation.
- Every workflow job: `step-security/harden-runner` first (skipped on macOS only — the action supports Linux, and Windows in audit mode), `persist-credentials: false`, `npm ci --ignore-scripts`, explicit `permissions`, a timeout; one commit SHA per action across the tree. `tests/tools/workflows.test.ts` asserts all of it — update the test in the same change as a workflow.
- `.npmrc` sets `ignore-scripts=true`: nothing builds on install, the gate builds.
- Keep the lockfile committed; `npm audit --audit-level=high` runs in CI and weekly; Dependency Review runs on every pull request; CodeQL and Scorecard run weekly.
- veraPDF is downloaded at a pinned version and checked against a committed SHA-256 before it is executed (`.github/actions/setup-verapdf`).
