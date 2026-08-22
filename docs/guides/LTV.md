# Long-term validation guide — the PAdES ladder (for AI agents and operators)

This guide explains, in two pages, how pdfnative-mcp v1.6.0 (on pdfnative 1.7.0)
exposes the **PAdES baseline levels** of ETSI EN 319 142-1 — B-B, B-T, B-LT and
B-LTA — through four tools, what the **operator** must configure before any
network step works, and what `verify_pdf ltv: true` does and does not prove.

## TL;DR — the ladder as four tool calls

| Level | What it adds | Tool | Needs network? |
| --- | --- | --- | --- |
| **B-B** | A CMS signature with ESS signing-certificate-v2 (`/SubFilter /ETSI.CAdES.detached`) | `sign_pdf` with `profile: 'pades'` | No |
| **B-T** | An RFC 3161 **signature timestamp** inside the CMS (proves the signature existed at that time) | `sign_pdf` with `profile: 'pades', timestamp: true` | Yes — TSA |
| **B-LT** | A **Document Security Store** (`/DSS` + per-signature `/VRI`) holding the certificate chain and OCSP / CRL revocation material | `add_ltv` | `mode: 'online'`: yes — OCSP / CRL responders. `mode: 'offline'`: **no** |
| **B-LTA** | An RFC 3161 **document timestamp** (`/DocTimeStamp`, `/SubFilter /ETSI.RFC3161`) over the whole file; re-applied periodically to extend the archival chain | `timestamp_pdf` | Yes — TSA |
| check | Reads the level reached and the evidence behind it | `verify_pdf` with `ltv: true` | No |

Every rung is an **incremental revision**: earlier bytes — and earlier signatures —
stay byte-identical. The worked example is [`examples/pades-ltv-ladder.json`](../../examples/pades-ltv-ladder.json).

```jsonc
// 1. B-B + B-T
{ "tool": "sign_pdf", "arguments": {
  "pdfBase64": "<any PDF>",
  "algorithm": "rsa-sha256",              // or rsa-sha384 / rsa-sha512 / ecdsa-sha256
  "profile": "pades",
  "timestamp": true,                      // B-T — requires PDFNATIVE_MCP_TSA_URL
  "certDerBase64": "<signer cert DER>",
  "certChainDerBase64": ["<intermediate CA DER>"],
  "rsaKeyPkcs1DerBase64": "<PKCS#1 DER>",
  "signerName": "Alice Example", "reason": "Approved for archival"
}}
// 2. B-LT
{ "tool": "add_ltv", "arguments": { "pdfBase64": "<from 1>", "mode": "online" } }
// 3. B-LTA
{ "tool": "timestamp_pdf", "arguments": { "pdfBase64": "<from 2>" } }
// 4. Check
{ "tool": "verify_pdf", "arguments": { "pdfBase64": "<from 3>", "ltv": true, "trustedRootsDerBase64": ["<root CA DER>"] } }
```

## Network is off by default — operator setup

pdfnative itself never opens a socket: timestamping and revocation collection go
through injected providers. pdfnative-mcp mirrors that contract at the deployment
boundary: **no outbound request is ever made unless the operator configures an
endpoint in the environment**, and **tool arguments can never supply a URL**. Without
configuration the network steps fail fast — before the document is touched — with
`TSA_NOT_CONFIGURED` or `REVOCATION_NOT_CONFIGURED`.

| Variable | Purpose |
| --- | --- |
| `PDFNATIVE_MCP_TSA_URL` | Absolute `http(s)` URL of the RFC 3161 authority (`POST application/timestamp-query`). Used by `sign_pdf timestamp: true` and `timestamp_pdf`. |
| `PDFNATIVE_MCP_TSA_AUTH` | Optional `Authorization` header value for the TSA (e.g. `Basic …` or `Bearer …`). **Secret** — never logged, never echoed in error messages. |
| `PDFNATIVE_MCP_REVOCATION` | `ocsp`, `crl` or `ocsp,crl` — enables online collection for `add_ltv mode: 'online'`. |
| `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS` | Comma-separated allow-list for OCSP / CRL hosts: `ocsp.example.com`, `crl.example.com:8080`, `*.pki.example.org`. **Mandatory** when `PDFNATIVE_MCP_REVOCATION` is set. Bare wildcards and paths are rejected. |
| `PDFNATIVE_MCP_NETWORK_TIMEOUT_MS` | Per-request timeout, 1000–120000 (default 10000). |

A typical stdio host configuration:

```jsonc
{
  "mcpServers": {
    "pdfnative": {
      "command": "npx", "args": ["-y", "pdfnative-mcp"],
      "env": {
        "PDFNATIVE_MCP_TSA_URL": "https://tsa.example.com/tsr",
        "PDFNATIVE_MCP_TSA_AUTH": "Basic dXNlcjpwYXNz",
        "PDFNATIVE_MCP_REVOCATION": "ocsp,crl",
        "PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS": "ocsp.example.com,*.crl.example.com"
      }
    }
  }
}
```

### Why the allow-list is mandatory (SSRF guard)

OCSP and CRL URLs are read from the **AIA / CRL-distribution-point extensions of
untrusted certificates inside the PDF** — a classic server-side-request-forgery
vector. A certificate-supplied URL is fetched only when **all** of these hold:

- the host matches the operator allow-list (exact, `host:port`, or `*.suffix`);
- the scheme is `http:` or `https:`; the URL carries no embedded credentials;
- redirects are never followed;
- loopback, link-local, private (RFC 1918), unique-local, CGNAT, unspecified and
  multicast address literals — including decimal / octal / hex spellings and
  IPv4-mapped IPv6 — are rejected **unless that literal is allow-listed verbatim**
  (a wildcard never unlocks an internal range);
- the response stays under the cap (OCSP 1 MiB, CRL 16 MiB), enforced while the body
  streams, and within the timeout;
- every OCSP response / CRL the responder returns is parse-validated before it is
  embedded into the `/DSS`.

Allow-list caveats worth knowing before you write the entry:

- Entries are **hostnames**, not URLs. A `host:port` entry only matches URLs with an
  *explicit* port — the URL parser drops default `:80` / `:443`, so
  `ocsp.example.com:443` never matches `https://ocsp.example.com/`; list the bare host.
- Wildcard entries (`*.suffix`) cannot carry a port.
- IDN hostnames must be listed in punycode (`xn--…`), which is how they appear in the
  parsed URL.
- IPv6 literals go in brackets (`[2001:db8::1]`).
- The guard checks address **literals only**. A listed hostname that resolves to an
  internal address (DNS rebinding) is not detected — there is no resolver step without
  adding a dependency. Allow-list only responders you control.

The TSA URL is operator-trusted (the operator chose it), so only the scheme and
credential checks apply there — loopback is permitted, which is what the test-suite's
loopback TSA relies on. TSA responses are capped at 256 KiB. Providers are built per
call and passed through pdfnative's per-call options; the process-wide
`setTimestampProvider` / `setRevocationProvider` are never used, so concurrent
requests share nothing. `server/discover` (and the legacy `initialize`) instructions
report the current policy as *"no outbound network"* or the configured endpoint
kinds — never the URLs or the secret.

## Offline mode — air-gapped pipelines

`add_ltv mode: 'offline'` embeds material you collected out-of-band, with **zero**
network access and no environment variables:

```jsonc
{ "tool": "add_ltv", "arguments": {
  "pdfBase64": "<signed PDF>",
  "mode": "offline",
  "certificatesDerBase64": ["<intermediate CA DER>", "<root CA DER>"],   // ≤ 64
  "ocspResponsesDerBase64": ["<OCSPResponse DER, RFC 6960>"],           // ≤ 64
  "crlsDerBase64": ["<CertificateList DER, RFC 5280>"]                  // ≤ 16
}}
```

- At least one of the three lists is required; every blob is **parsed before it is
  embedded** (`LTV_MATERIAL_INVALID` names the field and index that failed). Export
  DER, not PEM.
- The `/VRI` entry of every signed signature references all supplied items (the
  Adobe-tolerant superset).
- `structuredContent.summary` reports `{ mode, signatures, certificates, ocspResponses, crls }`;
  in online mode `{ mode, signatures }`.
- Worked example: [`examples/ltv-offline.json`](../../examples/ltv-offline.json).

Online mode (`addValidationInfo`) walks every signed signature and the TSA
certificates inside embedded timestamp tokens, asks the provider for OCSP (preferred,
`preferOcsp: true`) then CRL material, and merges an existing `/DSS`. Self-signed
chains and certificates without AIA / CRL-DP yield nothing → `LTV_EMPTY`; pass
`extraCertificatesDerBase64` when the CMS does not carry the full chain.

## Document timestamps

`timestamp_pdf` appends a `/DocTimeStamp` covering the whole document. The token is
verified (status, message imprint, random 64-bit nonce) by pdfnative **before** it is
written — a rejected or tampered TSA response (`TSA_REJECTED`) never lands in the
file. Field names default to `DocTimeStamp1` and auto-suffix on re-runs; raise
`placeholderBytes` (default 12288, max 65536) for TSAs that return large certificate
chains. Re-run **before the previous TSA certificate expires** to keep the archival
chain unbroken. A document timestamp on an unsigned PDF is allowed but proves only
existence at that time.

## Signer metadata, placeholders and multiple signatures

- `signerName`, `reason`, `location`, `contactInfo` are **baked into the `/Sig`
  placeholder** — by `sign_pdf` when it auto-injects one, or by
  `prepare_signature_placeholder` when you pre-build it. (On pdfnative < 1.7 this
  metadata never reached the file; v1.6.0 fixes that.)
- `prepare_signature_placeholder` freezes `subFilter` (`adbe.pkcs7.detached` or
  `ETSI.CAdES.detached` for PAdES) and can `reserveTimestamp: true` (+ 8 KiB) for a
  B-T signature.
- Several unsigned placeholders → pass `fieldName` (`PLACEHOLDER_AMBIGUOUS`
  otherwise; unknown name → `SIGNATURE_FIELD_NOT_FOUND`). A second signature next
  to an existing one: `allowMultiple: true` + a fresh `fieldName`; each signature is
  an incremental revision and earlier ones stay valid. List fields with
  `inspect_pdf signatures: true`.

## Reading the result — `verify_pdf ltv: true` and its caveats

Default `verify_pdf` output is unchanged except that every signature now carries
`subFilter`, and `/DocTimeStamp` entries appear with `isDocTimestamp: true` — they
are verified as RFC 3161 tokens (imprint vs. ByteRange digest, token SignerInfo vs.
the embedded TSA certificate) and **never flip `allValid`**. (Before v1.6.0 a
document timestamp was parsed as a CMS signature and produced `allValid: false` on
every B-LTA file.)

With `ltv: true` each signature additionally reports:

| Field | Meaning |
| --- | --- |
| `profile` | `'pades'` when the CMS carries ESS signing-certificate-v2, else `'pkcs7'`. |
| `timestamp` | The signature timestamp from the unsigned attributes, or `null`: `genTime`, `tsaSubject`, `imprintVerified` (the token's imprint equals the digest of the signature value) and `tokenSignatureValid` (the token's **own** CMS signature verifies against the TSA certificate it carries — the token sits in the *unsigned* attributes, so this check is what stops a replaced or backdated token; B-T requires it). |
| `revocation` | `{ source, status }` for the signer certificate, read from **embedded `/DSS` material only** (OCSP matched by serial number, CRL by issuer + serial). A `'revoked'` status makes the signature `valid: false` (with an explanatory entry in `errors[]`) under the ltv view; the plain verdict (`ltv` omitted) is purely cryptographic. |
| `ltvLevel` | `'B-B'`, `'B-T'`, `'B-LT'` or `'B-LTA'` reached by this signature: B-T needs a verified timestamp (imprint **and** token signature); B-LT additionally needs a `/VRI` entry for this very signature **and** revocation material that actually speaks about the signer (`good` or `revoked` — unrelated or missing material does not count); B-LTA additionally needs a valid document timestamp covering the signature's revision. |

Document-level: `dss` (store summary or `null`), `ltvLevel` (the minimum across
non-timestamp signatures) and a fixed `caveats[]`:

- revocation status is read from embedded `/DSS` material only (OCSP matched by
  serial, CRL by issuer + serial); **responder and CRL signatures are not
  verified, and chain validity at signing time is not evaluated**;
- timestamp tokens are checked for imprint consistency **and** for their own CMS
  signature against the TSA certificate they carry; **TSA certificate trust is
  not evaluated** unless `trustedRootsDerBase64` includes its root;
- `ltvLevel` is a structural classification (verified timestamp, `/VRI` entry,
  relevant revocation material, covering document timestamp) — not a full
  ETSI EN 319 102-1 validation.

Chain trust (`chainTrust`) walks the intermediate certificates carried in the CMS
(`sign_pdf certChainDerBase64`) up to one of the supplied roots; a document
timestamp whose TSA signature does not verify (or whose TSA is untrusted when roots
are supplied) is reported `valid: false` and flips `allValid`.

In other words, `verify_pdf` proves integrity and reports the evidence the document
carries; it is not a full trust-anchor validator. Use `inspect_pdf` with
`check: ['signed', 'dss', 'docTimestamp']` for cheap CI assertions and
`signatures: true` for the per-field inventory (`subFilter`, `isDocTimestamp`,
`isPlaceholder`, `byteRange`, `vriKey`).

## Error codes

| Code | Raised by | Meaning / fix |
| --- | --- | --- |
| `TSA_NOT_CONFIGURED` | `sign_pdf timestamp: true`, `timestamp_pdf` | `PDFNATIVE_MCP_TSA_URL` unset or not an absolute URL. No request was made. |
| `TSA_REJECTED` | `sign_pdf`, `timestamp_pdf` | TSA answered with a failure status, or the token's imprint / nonce did not match. Check the endpoint / auth; raise `placeholderBytes`. |
| `REVOCATION_NOT_CONFIGURED` | `add_ltv mode: 'online'` | `PDFNATIVE_MCP_REVOCATION` unset / invalid, or set without `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS`. Configure both or use `mode: 'offline'`. |
| `NETWORK_HOST_NOT_ALLOWED` | `add_ltv` (online), TSA URL parsing | Certificate-advertised URL not allow-listed, not `http(s)`, has credentials, or targets an internal address not listed verbatim. |
| `NETWORK_ERROR` | any network step | Request failed (timeout, HTTP status, response cap, connection error) or an env value is invalid (`..._TIMEOUT_MS` out of range, bad allow-list entry). The message never contains the `Authorization` value. |
| `LTV_NO_SIGNATURE` | `add_ltv` | No signed signature in the document — run `sign_pdf` first. |
| `LTV_EMPTY` | `add_ltv` (online) | Nothing could be collected (self-signed chain, no AIA / CRL-DP). |
| `LTV_MATERIAL_INVALID` | `add_ltv` (offline) | A DER blob did not parse; the message names `field[index]`. |
| `LTV_ERROR` | `add_ltv`, `timestamp_pdf` | Any other engine failure; the message carries the engine text. |
| `PLACEHOLDER_AMBIGUOUS` / `SIGNATURE_FIELD_NOT_FOUND` | `sign_pdf` | Pass / fix `fieldName`. |
| `ENCRYPTED_SOURCE` | `add_ltv`, `timestamp_pdf` | Unencrypted PDFs only — `decrypt_pdf` first (this drops signatures, so decrypt *before* signing). |

## Caching

`add_ltv`, `timestamp_pdf` and `sign_pdf` with `timestamp: true` are never served
from the opt-in response cache (`PDFNATIVE_MCP_CACHE_DIR`): their output embeds a
token minted at call time or material fetched at call time.

## Design note / follow-up

- **Offline `/VRI` composition lives in the wrapper.** In `mode: 'offline'` the server
  builds the per-signature `/VRI` map itself — every supplied certificate / OCSP
  response / CRL is referenced from every signed signature (the Adobe-tolerant
  superset) before `embedValidationInfo` writes the `/DSS`. pdfnative has no helper
  that derives the `/VRI` mapping from loose material yet; one will be requested
  upstream (through `draft_governance_issue`, human-submitted), and the wrapper will
  delegate to it once available with no change to inputs, outputs or error codes.
- **`ltvLevel` is structural, not a full ETSI validation.** `verify_pdf ltv: true`
  classifies a signature from what the file carries: a verified signature timestamp
  (B-T), revocation material in `/DSS` relevant to the signer (B-LT), a verified
  `/DocTimeStamp` (B-LTA). It does not build the chain to a trust anchor at signing
  time, validate responder signatures, or apply grace periods — ETSI EN 319 102-1
  validation stays the job of a dedicated validator. The fixed `caveats[]` in the
  response states the same.
