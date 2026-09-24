# Reproducible output guide (for AI agents and operators)

Applies to pdfnative-mcp v1.7.0 · pdfnative 1.8.0. Verified on 2026-09-21 against pdfnative-mcp 1.7.0 and pdfnative 1.8.0.

**The promise:** the same inputs and the same pinned instant give the **same bytes** —
across calls, on every host and in every time zone. It is what a golden-file test
suite, a reproducible build or a regulated archive needs, and it is what lets the
response cache and a content hash mean something.

Three facts make it work:

1. The engine writes **every date in UTC** (`/CreationDate` ends in `+00'00'`, the XMP
   dates in `+00:00`), whatever the server's time zone.
2. The trailer `/ID` is a hash of the title, the creation date and the object count —
   not a random value. Pin the instant and unencrypted output becomes a pure function of
   its inputs.
3. The `{date}` placeholder of `headerTemplate` / `footerTemplate` is the UTC calendar
   date (`YYYY-MM-DD`) of the **pinned** instant, so a dated footer does not break the
   promise. Unpinned, it is the build day.

Nothing is pinned by default: a call that pins nothing uses the wall clock, exactly as
before, and two such calls differ.

## TL;DR — pin the instant on the call

```json
{ "tool": "generate_basic_pdf", "arguments": {
  "title": "Quarterly statement",
  "creationDate": "2026-01-01T00:00:00Z",
  "footerTemplate": { "left": "Generated {date}", "right": "{page}/{pages}" },
  "blocks": [
    { "type": "heading", "text": "Quarterly statement", "level": 1 },
    { "type": "paragraph", "text": "The same inputs produce the same file on every machine." }
  ]
}}
```

Call it twice, on two machines if you like, and compare the bytes: they are identical,
and the footer reads `Generated 2026-01-01`. Worked example:
[`examples/reproducible-footer-date.json`](../../examples/reproducible-footer-date.json).

## Three ways to pin, and their precedence

Highest first:

| # | Pin | Scope | Format |
| --- | --- | --- | --- |
| 1 | `creationDate` on the tool call | one document | ISO 8601 instant **with a time zone**: `2026-01-15T09:00:00Z`, `2026-01-15T10:00:00+01:00` |
| 2 | `PDFNATIVE_MCP_CREATION_DATE` (operator) | the whole server process | the same format as `creationDate` — the two are parsed by the same validator |
| 3 | `SOURCE_DATE_EPOCH` (operator) | the whole server process | integer seconds since the Unix epoch (the [reproducible-builds.org](https://reproducible-builds.org/docs/source-date-epoch/) convention), 1–12 digits: `1767225600` |
| 4 | the wall clock | — | the historical behaviour: every call differs |

`creationDate` is accepted by the nine document tools — `generate_basic_pdf`,
`add_table`, `add_chart`, `add_barcode`, `embed_image`, `add_form`,
`add_international_text`, `add_attachment` and `prepare_signature_placeholder`. A value
without a time zone (`2026-01-15T09:00:00`) is refused with `VALIDATION_ERROR`: an
instant that depends on where it is read would defeat the purpose.

The two operator variables follow the rules of every operator knob of this server:

- **Read once at boot.** A tool argument can never change them, and changing the
  environment of a running server does nothing.
- **An invalid value refuses to start.** A `PDFNATIVE_MCP_CREATION_DATE` that is not an
  ISO 8601 instant with a time zone, or a `SOURCE_DATE_EPOCH` that is not an integer,
  stops the server with a message naming the variable. Silently falling back to the
  wall clock would leave the operator believing the output is pinned.
- **The pin is logged on stderr** at boot, with its source and nothing else:
  `creation date pinned to 2026-01-01T00:00:00.000Z (SOURCE_DATE_EPOCH) — a call's own creationDate still wins`.
- **A call's own `creationDate` still wins**, so an agent that pins per document is
  unaffected by the operator's choice.
- An empty value counts as unset. When both variables are set,
  `PDFNATIVE_MCP_CREATION_DATE` wins.
- **The response cache is namespaced by the pin** (`PDFNATIVE_MCP_CACHE_DIR`): an entry
  rendered under one pinned instant is never served under another, or under none.

### MCP host configuration

```json
{
  "mcpServers": {
    "pdfnative": {
      "command": "npx",
      "args": ["-y", "pdfnative-mcp"],
      "env": {
        "PDFNATIVE_MCP_CREATION_DATE": "2026-01-01T00:00:00Z"
      }
    }
  }
}
```

With this block every generated document carries the same creation instant, with no
per-call argument — useful when you cannot trust every caller to remember
`creationDate`.

> **Warning — a shell that exports `SOURCE_DATE_EPOCH` pins every document.** Many
> build environments (distribution packaging, Nix, some CI images) export it already.
> From 1.7.0 the server honours it: every document's `/CreationDate` — and every
> `{date}` footer — then shows that instant, not today. If that is not what you want,
> unset the variable for the server process (or override it with an explicit
> `PDFNATIVE_MCP_CREATION_DATE`). The stderr boot line tells you which case you are in.

## What is NOT covered, and why

The pin governs the **creation instant of generated documents**. These instants and
bytes have a meaning of their own and are deliberately left alone:

| Not covered | Why | Can it be pinned? |
| --- | --- | --- |
| `signingTime` (`sign_pdf`, `prepare_signature_placeholder`) | The moment of signature is a legal fact, not a build parameter. It defaults to now. | **Yes** — pass `signingTime` (ISO 8601 with a time zone). On `prepare_signature_placeholder` it is frozen into the `/Sig` dictionary at placeholder time, so pin it there. |
| `modDate` (`update_metadata`) | `/ModDate` is always refreshed; it defaults to now. | **Yes** — pass `modDate` (ISO 8601 with a time zone). |
| The second `/ID` of incremental writers (`annotate_pdf`, `fill_form`) | An incremental update regenerates the second half of the trailer `/ID` to mark the revision. | No. |
| RFC 3161 timestamp tokens (`sign_pdf` with `timestamp: true`, `timestamp_pdf`) and online revocation data (`add_ltv` in `online` mode) | They carry the TSA's or the responder's own clock and nonce — fresh by design. | No. |
| Encryption (`encrypt` on a document tool, `encrypt_pdf`, the page-tree `encrypt` option) | A fresh file key, salts and IVs are drawn for every file. Repeating them would be a security defect. | No — encrypted output is never byte-reproducible, and never cached. |
| ECDSA signatures (`algorithm: 'ecdsa-sha256'`) | Randomised by design. RSA signatures are deterministic. | No — use RSA when the signed bytes must repeat. |

A fully pinned signing flow therefore looks like this (RSA, no timestamp):

```json
{ "tool": "prepare_signature_placeholder", "arguments": {
  "title": "Contract",
  "creationDate": "2026-01-15T09:00:00Z",
  "signingTime": "2026-01-15T09:05:00Z",
  "blocks": [{ "type": "paragraph", "text": "Signed and reproducible." }]
}}
```

followed by `sign_pdf` with the same `signingTime`, an `rsa-*` algorithm and no
`timestamp`. And for metadata:

```json
{ "tool": "update_metadata", "arguments": {
  "pdfBase64": "<pdf>",
  "title": "Contract (final)",
  "modDate": "2026-01-16T08:00:00Z"
}}
```

## Proving it from an agent

Call the tool twice with identical arguments and compare the embedded resource blobs
(or `structuredContent.sizeBytes` as a cheap first check), or hash the bytes on the
host. With `PDFNATIVE_MCP_CACHE_DIR` set, a repeated call may be served from the cache
(`_meta.cached: true`) — the bytes are then the earlier render, which proves nothing;
run the comparison against a server without the cache, or across two hosts. The
`reproducible_output` MCP prompt carries the same checklist.

## How the repository proves it

- **A two-time-zone test on the built server.**
  [`tests/reproducible-build.test.ts`](../../tests/reproducible-build.test.ts) spawns
  `dist/cli.js` under `Pacific/Kiritimati` (UTC+14) and `America/Los_Angeles`, 22 hours
  apart and on opposite sides of the date line, with an instant (23:30 UTC) that falls
  on different calendar days in each. It asserts that a call pinned with `creationDate`
  is byte-identical in both zones and that its dates are UTC; that `SOURCE_DATE_EPOCH`
  alone makes unpinned calls reproducible and that the boot log says why; that
  `PDFNATIVE_MCP_CREATION_DATE` wins over `SOURCE_DATE_EPOCH` and gives the same bytes
  as the per-call pin; and that **without** any pin two calls differ — so the pin is
  what does the work. Unit tests cannot show this: the test runner pins `TZ=UTC`.
- **A 96-sample byte baseline.** `npm run test:generate` drives the **built** server
  under `TZ=UTC`, with every operator variable scrubbed and every instant pinned, and
  writes 96 samples (the hermetic examples and the conformance corpus);
  `npm run verify:samples` holds them to `tests/_fixtures/samples.sha256.json`:

  ```bash
  npm run build && npm run test:generate && npm run verify:samples
  ```

  94 samples are fingerprinted **by bytes** (SHA-256 of the file). 2 are fingerprinted
  in **semantic** mode — a hash of a canonical projection of what the document says —
  because their bytes cannot repeat: one is encrypted (fresh key, salts, IVs), one is
  signed with a throw-away key generated per run. Both are listed explicitly, with the
  reason, in `scripts/lib/sample-fingerprint.ts`. The baseline is a chain: an unchanged
  entry keeps the version it was anchored at, so a byte change is always attributable
  to a release. Details: [`scripts/README.md`](../../scripts/README.md).

An intended output change is rebaselined on purpose and declared in the release note;
the baseline is never refreshed to silence a surprise.

## See also

- [PRINT.md](PRINT.md) — `creationDate` sits next to `print` / `metadata` on the same
  nine tools.
- [ENCRYPTION.md](ENCRYPTION.md) — why protected bytes never repeat.
- [LTV.md](LTV.md#reproducibility) — what repeats along the PAdES ladder.
- [docs/AGENT_CONTRACT.md](../AGENT_CONTRACT.md) — operator variables and error codes.
