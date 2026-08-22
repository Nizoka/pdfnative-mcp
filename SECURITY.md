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
- **Resource exhaustion** — strict `min`/`max` bounds on every input field; 50 MB cap on output size; response caps and timeouts on every network fetch.
- **Prototype pollution** — `additionalProperties: false` on every JSON Schema; Zod `.strict()` semantics.
- **DNS rebinding** against the HTTP transport — bound to `127.0.0.1`, foreign `Host` / `Origin` answered with 403, `GET` / `DELETE` with 405.
- **Server-side request forgery** through certificate-supplied URLs — see *Network egress* below.

We do **not** currently defend against:

- A maliciously-crafted PDF input to `sign_pdf` causing a crash inside `pdfnative` (the upstream library is responsible for parser hardening — please report such issues to both projects).
- Side-channel attacks on the user-supplied private key material in `sign_pdf`.
- A compromised or malicious **operator-configured** TSA / OCSP / CRL endpoint (the operator chose it; timestamp tokens are still verified for status, imprint and nonce before they are embedded).

## Network egress

The server makes **no outbound network call by default**. The only egress it can ever perform goes to the RFC 3161 / OCSP / CRL endpoints the **operator** configured in the environment for PAdES long-term validation — never to a URL supplied by a tool argument, never to GitHub, never for telemetry. This is enforced in one module (`src/network.ts`); no other code path opens a socket.

| Variable | Role |
| --- | --- |
| `PDFNATIVE_MCP_TSA_URL` | RFC 3161 authority used by `sign_pdf timestamp: true` and `timestamp_pdf`. Unset → `TSA_NOT_CONFIGURED`, no request. |
| `PDFNATIVE_MCP_TSA_AUTH` | **Secret.** Optional `Authorization` header value for the TSA. Never logged, never echoed in errors (network errors report only the error class / HTTP status). |
| `PDFNATIVE_MCP_REVOCATION` | `ocsp` / `crl` / `ocsp,crl` — enables `add_ltv mode: 'online'`. Unset → `REVOCATION_NOT_CONFIGURED`. |
| `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS` | Allow-list for OCSP / CRL responders (`host`, `host:port`, `*.suffix`). **Mandatory** with `PDFNATIVE_MCP_REVOCATION`. |
| `PDFNATIVE_MCP_NETWORK_TIMEOUT_MS` | Per-request timeout, 1000–120000 ms (default 10000). |

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
