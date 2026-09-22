# Security Policy

## Supported versions

The latest published minor on npm receives security patches. Older versions are unsupported once a new minor lands.

| Version  | Supported          |
| -------- | ------------------ |
| `1.7.x`  | :white_check_mark: |
| `< 1.7`  | :x:                |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Email the maintainer directly at **[security@pdfnative.dev](mailto:security@pdfnative.dev)** (PGP key on request) with:

- A description of the vulnerability.
- Reproduction steps or a minimal proof of concept.
- The version of `pdfnative-mcp` and Node.js you tested against.
- Any suggested mitigation.

You will receive an acknowledgement within **72 hours**. We aim to ship a fix and a coordinated public advisory within **30 days** of the initial report (or sooner for critical issues).

## Threat model

`pdfnative-mcp` is designed to run as a local MCP server, spawned by a trusted host (Claude Desktop, Cursor, etc.) and communicating over stdio (or a loopback-only Streamable HTTP endpoint when `PDFNATIVE_MCP_PORT` is set). The threat model assumes:

- The **host process is trusted** (the user installed it themselves).
- The **operator** who sets the environment variables is trusted.
- The **LLM controlling the host is untrusted** — it may send arbitrary, malicious tool arguments.
- **PDF inputs are untrusted** — including any certificate, URL or extension they carry.
- The **filesystem outside `PDFNATIVE_MCP_OUTPUT_DIR` must remain inaccessible**.

In particular we defend against:

- **Path traversal** (`..`, absolute paths, NUL bytes, non-`.pdf` extensions).
- **Arbitrary file overwrite** — `wx` flag refuses to overwrite existing files.
- **Resource exhaustion** — strict `min`/`max` bounds on every input field; 50 MB cap on output size; response caps and timeouts on every network fetch; a 24 MiB per-call budget on decoded image bytes (inline `image` blocks, each ≤ 12 M base64 characters; watermark images ≤ 8 MiB — `embed_image.imageBase64` keeps its unbounded 1.5.0 contract); `svg` data ≤ 100 000 characters; at most 50 000 engine blocks per document; 256 MiB stdio frame / HTTP body cap.
- **Decompression bombs** — the engine bounds every FlateDecode expansion (100 MiB per stream by default). `PDFNATIVE_MCP_MAX_INFLATE_BYTES` lets the operator lower or raise that cap (integer ≥ 1024, read once at startup; an invalid value refuses to start rather than silently running with the default). A capped attachment stream fails `extract_attachments includeData: true` with `PDF_PARSE_FAILED`; `extract_text` degrades to empty page text for a capped content stream (engine behaviour — no error is surfaced). Tool arguments can never change the cap.
- **Unsupported image variants** — PNGs are checked against their IHDR at the boundary (alpha, palette, 16-bit and interlaced files are rejected with `VALIDATION_ERROR` and a remedy) and JPEG / PNG magic bytes must match the declared `mimeType`, so the engine's decoder never meets a variant it cannot handle.
- **Malformed print and colour inputs** (1.7.0) — `outputIntent.iccProfileBase64` must decode to 1 byte – 8 MiB (`VALIDATION_ERROR`) and be a real ICC profile: the `acsp` signature and a header size field no larger than the buffer are required, so a hand-made stub is refused (`PRINT_ERROR`) before it is embedded; `pdfx` additionally needs device class `prtr`. Every colour input is schema-bounded (hex, RGB, a CMYK operand string of four 0–1 components, or a CMYK tuple of four 0–100 components — anything else is `VALIDATION_ERROR`), and every `typography` key is bounded (line quotas 1–10, at most 100 short tokens per list, at most 32 punctuation rules, an enumerated set of OpenType feature tags).
- **Incoherent conformance requests** (1.7.0) — the static PDF/X conflicts (`pdfx` with `pdfA`, with `encrypt`, without `outputIntent`, with an unknown trapping state, with both a TrimBox and an ArtBox) are refused as `VALIDATION_ERROR` before any document is built.
- **Uncoded failures on damaged PDFs** (1.7.0) — pdfnative parses lazily, so a damaged file can throw from any accessor; one net at the `tools/call` boundary classifies whatever escapes a tool that takes PDF input as `PDF_PARSE_FAILED`, so a parser message never reaches the caller as an uncoded error.
- **Prototype pollution** — `additionalProperties: false` on every JSON Schema input object; Zod `.strict()` on every input schema (unknown top-level *and* nested keys are rejected with `VALIDATION_ERROR`, never silently stripped).
- **Malformed base64 / key material at the boundary** — `data:` URIs, PEM armour where DER is expected, double-encoded or empty payloads are rejected with a coded error before any parser runs; inputs are never echoed back.
- **DNS rebinding** against the HTTP transport — bound to `127.0.0.1`, foreign `Host` / `Origin` answered with 403, `GET` / `DELETE` with 405. The `Origin` check is port-pinned: the SDK's loopback check accepts any `http://localhost:<n>`, so the server additionally requires the `Origin` port to equal its own port (a local dev page on another port cannot target the endpoint).
- **Unauthenticated local access to the HTTP transport** — *only when the operator opts in:* `PDFNATIVE_MCP_HTTP_TOKEN` (≥ 16 characters, no whitespace; a weaker value aborts startup) makes every request to `/mcp` require `Authorization: Bearer <token>`; anything else is answered `401` with `WWW-Authenticate: Bearer realm="pdfnative-mcp"` — followed by `, error="invalid_token"` only when the request carried credentials, per RFC 6750 §3.1 — before the MCP handler runs. The comparison is constant-time (SHA-256 + `timingSafeEqual`) and the token is never logged or echoed. stdio mode needs no token (the host owns the pipe).
- **Listener exhaustion on keep-alive HTTP connections** — disconnect detection is attached per response, not per socket, so long-lived connections do not accumulate listeners.
- **Server-side request forgery** through certificate-supplied URLs — see *Network egress* below.

We do **not** currently defend against:

- **Other local processes reaching the HTTP endpoint when `PDFNATIVE_MCP_HTTP_TOKEN` is unset.** The default HTTP mode (`PDFNATIVE_MCP_PORT` without a token) has **no authentication**: the loopback bind and the Host / Origin guard stop browsers and remote hosts, not a process running on the same machine. Set the token whenever anything untrusted can run locally; the startup log states which mode is active (`bearer token required` / `no authentication (loopback only)`).
- A maliciously-crafted PDF input to `sign_pdf` causing a crash inside `pdfnative` (the upstream library is responsible for parser hardening — please report such issues to both projects).
- Side-channel attacks on the user-supplied private key material in `sign_pdf`. DER keys are signed through `node:crypto` (constant-time primitives); raw P-256 scalars (`ecPrivateScalarHex`) go through the pure-JS signer, and **signature verification is pure JS** (`verify_pdf`) — no constant-time claim is made for either.
- A compromised or malicious **operator-configured** TSA / OCSP / CRL endpoint (the operator chose it). A timestamp token is checked for status, message imprint and nonce before it is embedded; the token's own CMS signature is verified later by `verify_pdf`, not at embedding time.
- Anything stored in the opt-in response cache (`PDFNATIVE_MCP_CACHE_DIR`) — it writes tool output as plaintext at rest, which is why `encrypt_pdf`, `decrypt_pdf`, `sign_pdf`, `add_ltv`, `timestamp_pdf`, `update_metadata`, any document call carrying `encrypt` (build-time encryption takes passwords) and file-mode calls are never cached; protect the directory like the output sandbox.
- Content of `svg` and `link` blocks beyond what the engine enforces: SVG markup is rendered by pdfnative's own subset parser (no XML parser, no entity expansion beyond the named few, no external reference is ever fetched; `<script>`, `<image>`, `<use>` are ignored) and link URLs are restricted to `http:` / `https:` / `mailto:` without control characters — but the resulting PDF is opened by a viewer the server does not control.

## Network egress

The server makes **no outbound network call by default**. The only egress it can ever perform goes to the RFC 3161 / OCSP / CRL endpoints the **operator** configured in the environment for PAdES long-term validation — never to a URL supplied by a tool argument, never to GitHub, never for telemetry. This is enforced in one module (`src/network.ts`); no other code path opens a socket.

| Variable | Role |
| --- | --- |
| `PDFNATIVE_MCP_TSA_URL` | RFC 3161 authority used by `sign_pdf timestamp: true` and `timestamp_pdf`. Unset → `TSA_NOT_CONFIGURED`, no request. |
| `PDFNATIVE_MCP_TSA_AUTH` | **Secret.** Optional `Authorization` header value for the TSA. Never logged, never echoed in errors (network errors report only the error class / HTTP status). |
| `PDFNATIVE_MCP_REVOCATION` | `ocsp` / `crl` / `ocsp,crl` — enables `add_ltv mode: 'online'`. Unset → `REVOCATION_NOT_CONFIGURED`. |
| `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS` | Allow-list for OCSP / CRL responders (`host`, `host:port`, `*.suffix`). **Mandatory** with `PDFNATIVE_MCP_REVOCATION`. |
| `PDFNATIVE_MCP_NETWORK_TIMEOUT_MS` | Per-request timeout, 1000–120000 ms (default 10000). |

The remaining variables carry no egress role: `PDFNATIVE_MCP_OUTPUT_DIR` (file-output sandbox; unset = file mode disabled), `PDFNATIVE_MCP_CACHE_DIR` (opt-in response cache), `PDFNATIVE_MCP_PORT` (loopback HTTP transport), `PDFNATIVE_MCP_HTTP_TOKEN` (**secret**, bearer token for that transport — see *Threat model*) and `PDFNATIVE_MCP_MAX_INFLATE_BYTES` (engine decompression cap — see *Threat model*).

Two more operator variables pin the creation instant and carry no egress role either: `PDFNATIVE_MCP_CREATION_DATE` (ISO 8601 with a time zone) and `SOURCE_DATE_EPOCH` (integer seconds) — see *Reproducible builds* below. That makes twelve operator variables, all declared in `server.json`, all read once at boot; an invalid value refuses to start, never a silent fallback.

OCSP and CRL URLs come from the AIA / CRL-distribution-point extensions of **untrusted certificates inside the PDF** — a classic SSRF vector. A certificate-supplied URL is fetched only when:

- its host matches the operator allow-list (bare wildcards and paths are rejected as entries). Entries are **hostnames**, not URLs: a `host:port` entry only matches URLs with an *explicit* port — the URL parser drops default `:80` / `:443`, so list the bare host for those; wildcard entries cannot carry a port; IDN hostnames must be listed in punycode (`xn--…`); IPv6 literals in brackets;
- the scheme is `http:` or `https:` and the URL carries no embedded credentials;
- redirects are never followed (`redirect: 'error'`);
- the host is not a loopback, link-local, private (RFC 1918), unique-local, CGNAT, unspecified or multicast address literal — including decimal / octal / hex spellings and IPv4-mapped IPv6 — unless that literal is allow-listed **verbatim** (a wildcard never unlocks an internal range). **Known limitation:** the guard inspects address *literals* only. A listed hostname that resolves to an internal address (DNS rebinding) is not detected — there is no resolver step without adding a dependency — so allow-list only responders you control;
- the response stays under the cap (TSA 256 KiB, OCSP 1 MiB, CRL 16 MiB), enforced while the body is streamed, and within the timeout;
- OCSP responses and CRLs returned by responders are parse-validated before `add_ltv` embeds them — a responder cannot plant arbitrary bytes in the `/DSS`.

The TSA URL is operator-trusted, so only the scheme and credential checks apply to it. Providers are constructed per call and passed through pdfnative's per-call options — the process-wide provider setters are never used, so concurrent requests share nothing. `add_ltv mode: 'offline'` embeds caller-supplied DER material with zero network access (every blob is parsed before it is written). The server's instructions report the egress policy as endpoint kinds only, never URLs or secrets.

## Cryptographic verification scope (`verify_pdf`)

`verify_pdf` verifies, with no network access, for every `/FT /Sig` widget of the document:

- **Byte-range integrity** — the digest of the bytes covered by `/ByteRange` (SHA-256, SHA-384 or SHA-512, as the signer declared) against the CMS `messageDigest` signed attribute.
- **CMS signature value** — RSA PKCS#1 v1.5 with SHA-256 / 384 / 512, and ECDSA P-256 with SHA-256, over the re-encoded `signedAttrs`; the ECDSA arithmetic is the server's own pure-JavaScript P-256 verifier (the engine exports no `ecdsaVerifyHash` yet — ROADMAP). A signature outside that list (ECDSA with another curve or digest, any other algorithm OID) is reported with `valid: false`, `algorithm: null` and the parse error, never as valid.
- **Certificate chain and trust** — the chain carried in the CMS is walked with the engine's `verifyCertSignature` against `trustedRootsDerBase64` when the caller supplies roots; otherwise the signer certificate is reported as `self-signed` or `unverified`, never as trusted.
- **Document timestamps** (`/DocTimeStamp`, PAdES B-LTA) — each RFC 3161 token's `messageImprint` is checked against the covered byte range and the token's own SignerInfo signature is verified with the TSA certificate it carries; reported with `isDocTimestamp: true`.
- **With `ltv: true`** — the signature timestamp of each signature (imprint and token signature), the embedded `/DSS` revocation material (OCSP matched by serial, CRL by issuer and serial), and a structural `ltvLevel` (B-B / B-T / B-LT / B-LTA).

**Out of scope** — stated in the tool's own `caveats[]` and in [docs/guides/LTV.md](docs/guides/LTV.md); do not rely on `verify_pdf` alone for legal or regulatory non-repudiation:

- responder and CRL signatures are not verified, and chain validity *at signing time* is not evaluated — revocation is read from embedded `/DSS` material only, never fetched;
- TSA certificate trust is not evaluated unless `trustedRootsDerBase64` includes the TSA's root, and the revocation status of the TSA's own certificate is never checked;
- `ltvLevel` is a structural classification (verified timestamp, `/VRI` entry, relevant revocation material, covering document timestamp), not an ETSI EN 319 102-1 validation, and a document-timestamp chain is validated token by token, not as a renewal policy over time.

The sign side (`sign_pdf`, `add_ltv`, `timestamp_pdf`) never opens a socket itself: RFC 3161 and online revocation requests go through the operator-configured endpoints described under *Network egress*; `add_ltv mode: 'offline'` embeds caller-supplied DER material after parsing it.

## Reproducible builds

- **Dates are UTC.** Every date the engine writes — `/CreationDate`, the XMP dates, the `{date}` placeholder of a header or footer — is written in UTC, and the trailer `/ID` is derived from the pinned instant, so the same input produces byte-identical output on every host and in every time zone once an instant is pinned. A consumer can therefore verify a PDF by hash.
- **Who pins the instant.** Precedence: the per-call `creationDate` → `PDFNATIVE_MCP_CREATION_DATE` → `SOURCE_DATE_EPOCH` → the wall clock. The operator variables are parsed strictly and read once at boot; an invalid value refuses to start, so a reproducibility promise is either honoured or refused. The source of the pin is logged on stderr (never on stdout), and the response-cache namespace carries the pin. A shell that already exports `SOURCE_DATE_EPOCH` (many build environments do) pins every document — unset it for the server process if that is not wanted.
- **Not reproducible, by design:** encrypted output (the file key, salts and IVs come from the CSPRNG), ECDSA signatures, RFC 3161 tokens and revocation data, and the second `/ID` of incremental writers. `signingTime` and `modDate` are deliberate legal instants with their own inputs and are not covered by the creation-date pin.
- **The engine pin.** `pdfnative` is pinned at `^1.8.0`; the pin never moves without a release note that declares every byte change it brings, and `tests/engine-surface.test.ts` fails when the pin moves without the traceability matrix (`tests/_fixtures/engine-surface.json`).
- **The repository proves the promise on itself.** `npm run test:generate` drives the built server under `TZ=UTC` with every operator variable scrubbed, and `npm run verify:samples` holds the 96 samples to `tests/_fixtures/samples.sha256.json` — 94 byte for byte, 2 (one encrypted, one signed) through a semantic projection, each listed explicitly with its reason. A two-time-zone test covers the UTC promise. The check is blocking in CI (`sample-regression` is a required status check).

## Supply chain

- **Exactly three runtime dependencies** — `pdfnative`, `@modelcontextprotocol/server` and `zod` (all MIT, see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)), and no new one, ever. `.npmrc` sets `ignore-scripts=true` and `audit-level=high`; every CI install is `npm ci --ignore-scripts`, so no install-time lifecycle script runs, locally or in CI.
- **Hardened workflows** — every job starts with `step-security/harden-runner` (egress audited; block mode is on the ROADMAP), declares least-privilege `permissions` and a timeout, and checks out with `persist-credentials: false`. Every action is pinned to a full commit SHA, one SHA per action across the tree. `dependency-review` gates every dependency change on a pull request, CodeQL and OpenSSF Scorecard run on a schedule, and `npm audit --audit-level=high` runs in CI and weekly.
- **Trusted Publishing** — `publish.yml` runs from a protected environment (`npm-publish`, approved by the maintainer), checks that the tag equals the package version, re-runs the publish gate, and publishes through npm Trusted Publishing: a short-lived GitHub OIDC token, no long-lived npm token, with provenance. A CycloneDX SBOM (`npm sbom`) and a build-provenance attestation for the tarball and the SBOM are attached to the GitHub release. Verify an install with `npm audit signatures`.
- **One release gate** — `npx tsx scripts/gate.ts --publish --require-all` runs typecheck, lint, the build, the `dist/` checks (no `console.log` in emitted JavaScript, only `src/` under `dist/`), the built-server smoke test over stdio (stdout must carry JSON-RPC frames only), the catalogue fingerprint, the offline `server.json` validation, the sample generation, the tests with coverage, the docs verifier, the sample baseline, the PDF/X corpus and the PDF/A corpus under veraPDF 1.30.2 — whose installer is pinned by SHA-256 (`.github/checksums/`) and verified before `java -jar` executes it. A skipped step fails the publish. veraPDF is an external CI tool, not a dependency.
- **Branch and tag protection** — `.github/rulesets/main.json` and `tags.json` are the committed copies of the GitHub rulesets (required checks `ci (22)`, `ci (24)`, `sample-regression`; release tags are never deleted or moved); the maintainer imports them.
- **Agents never publish** — the human-in-the-loop policy (`.github/AGENT_RULES.md`, `.github/ai-governance.json`) is enforced in Claude Code sessions by `.claude/hooks/guard.mjs`, which refuses publishing, pushing, tagging and every GitHub write; the server itself has no code path that can write to GitHub.

## Disclosure history

_None yet._
