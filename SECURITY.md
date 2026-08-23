# Security Policy

## Supported versions

The latest published minor on npm receives security patches. Older versions are unsupported once a new minor lands.

| Version  | Supported          |
| -------- | ------------------ |
| `1.6.x`  | :white_check_mark: |
| `< 1.6`  | :x:                |

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

OCSP and CRL URLs come from the AIA / CRL-distribution-point extensions of **untrusted certificates inside the PDF** — a classic SSRF vector. A certificate-supplied URL is fetched only when:

- its host matches the operator allow-list (bare wildcards and paths are rejected as entries). Entries are **hostnames**, not URLs: a `host:port` entry only matches URLs with an *explicit* port — the URL parser drops default `:80` / `:443`, so list the bare host for those; wildcard entries cannot carry a port; IDN hostnames must be listed in punycode (`xn--…`); IPv6 literals in brackets;
- the scheme is `http:` or `https:` and the URL carries no embedded credentials;
- redirects are never followed (`redirect: 'error'`);
- the host is not a loopback, link-local, private (RFC 1918), unique-local, CGNAT, unspecified or multicast address literal — including decimal / octal / hex spellings and IPv4-mapped IPv6 — unless that literal is allow-listed **verbatim** (a wildcard never unlocks an internal range). **Known limitation:** the guard inspects address *literals* only. A listed hostname that resolves to an internal address (DNS rebinding) is not detected — there is no resolver step without adding a dependency — so allow-list only responders you control;
- the response stays under the cap (TSA 256 KiB, OCSP 1 MiB, CRL 16 MiB), enforced while the body is streamed, and within the timeout;
- OCSP responses and CRLs returned by responders are parse-validated before `add_ltv` embeds them — a responder cannot plant arbitrary bytes in the `/DSS`.

The TSA URL is operator-trusted, so only the scheme and credential checks apply to it. Providers are constructed per call and passed through pdfnative's per-call options — the process-wide provider setters are never used, so concurrent requests share nothing. `add_ltv mode: 'offline'` embeds caller-supplied DER material with zero network access (every blob is parsed before it is written). The server's instructions report the egress policy as endpoint kinds only, never URLs or secrets.

## Disclosure history

_None yet._
