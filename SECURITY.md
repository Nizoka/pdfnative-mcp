# Security Policy

## Supported versions

The latest published `0.x` minor on npm receives security patches. Older versions are unsupported once a new minor lands.

| Version  | Supported          |
| -------- | ------------------ |
| `0.1.x`  | :white_check_mark: |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Email the maintainer directly at **[security@pdfnative.dev](mailto:security@pdfnative.dev)** (PGP key on request) with:

- A description of the vulnerability.
- Reproduction steps or a minimal proof of concept.
- The version of `pdfnative-mcp` and Node.js you tested against.
- Any suggested mitigation.

You will receive an acknowledgement within **72 hours**. We aim to ship a fix and a coordinated public advisory within **30 days** of the initial report (or sooner for critical issues).

## Threat model

`pdfnative-mcp` is designed to run as a local MCP server, spawned by a trusted host (Claude Desktop, Cursor, etc.) and communicating over stdio. The threat model assumes:

- The **host process is trusted** (the user installed it themselves).
- The **LLM controlling the host is untrusted** — it may send arbitrary, malicious tool arguments.
- The **filesystem outside `PDFNATIVE_MPC_OUTPUT_DIR` must remain inaccessible**.

In particular we defend against:

- **Path traversal** (`..`, absolute paths, NUL bytes, non-`.pdf` extensions).
- **Arbitrary file overwrite** — `wx` flag refuses to overwrite existing files.
- **Resource exhaustion** — strict `min`/`max` bounds on every input field; 50 MB cap on output size.
- **Prototype pollution** — `additionalProperties: false` on every JSON Schema; Zod `.strict()` semantics.

We do **not** currently defend against:

- A maliciously-crafted PDF input to `sign_pdf` causing a crash inside `pdfnative` (the upstream library is responsible for parser hardening — please report such issues to both projects).
- Side-channel attacks on the user-supplied private key material in `sign_pdf`.

## Disclosure history

_None yet._
