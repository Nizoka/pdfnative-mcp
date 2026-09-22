# Third-party notices

pdfnative-mcp itself is MIT-licensed (see [LICENSE](LICENSE)) and has **exactly three
runtime dependencies** — `pdfnative`, `@modelcontextprotocol/server` and `zod` — and no
other. Two of them are third-party packages; the third is the engine this server wraps,
by the same author. Every package below is MIT-licensed; the licence text of each one
ships inside the package itself (`node_modules/<package>/LICENSE`), and the CycloneDX
SBOM attached to every GitHub release names the exact resolved versions. This file
quotes the version ranges of `package.json`, so it does not go stale with a lockfile
update.

## MCP TypeScript SDK — MIT

`@modelcontextprotocol/server` (`^2.0.0`) and its sole dependency
`@modelcontextprotocol/core`, from
[modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)
(copyright Anthropic, PBC; MIT). It provides the Model Context Protocol transport and
request handling — `server/discover` on MCP 2026-07-28, the 2025-era `initialize`
fallback, stdio framing and the Streamable HTTP handler. pdfnative-mcp registers its
tools, prompts and resources on the SDK's low-level `Server` and adds its own loopback
guard and bearer-token check around the HTTP transport (`src/http.ts`, `src/auth.ts`).

## zod — MIT

`zod` (`^4.2.0`), from [colinhacks/zod](https://github.com/colinhacks/zod) (copyright
Colin McDonnell; MIT). Every `tools/call` argument is validated at the boundary with a
`.strict()` zod schema kept in lock-step with the JSON Schema advertised in `tools/list`.
zod is also a dependency of the MCP SDK; npm deduplicates it to one copy.

## pdfnative — MIT

`pdfnative` (`^1.8.0`), from [Nizoka/pdfnative](https://github.com/Nizoka/pdfnative)
(copyright Nizoka; MIT) — the zero-dependency PDF engine every tool delegates to. Its
own [THIRD-PARTY-NOTICES.md](https://github.com/Nizoka/pdfnative/blob/main/THIRD-PARTY-NOTICES.md)
covers the material that travels inside the engine: the Noto font subsets (SIL Open Font
License 1.1), Unicode Character Database tables and the Adobe Core 14 font metrics.
pdfnative-mcp bundles none of that itself; it reaches it through the engine's font
modules at run time.

## Development-time material, not shipped

- `tests/_fixtures/server.schema.2025-12-11.json` — the MCP registry `server.json`
  schema, vendored so the gate's `server-json` step validates `server.json` offline (the
  step checks that the vendored `$id` is the URL `server.json` names); published by the
  [modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry)
  project under its own licence. Used by the gate only, never by the server.
- veraPDF — the PDF/A reference validator, downloaded by CI at a pinned version and
  checked against a committed SHA-256 before it runs (`.github/actions/setup-verapdf`).
  An external tool; nothing of it is bundled or redistributed.
- The dev toolchain (`typescript`, `eslint`, `vitest`, `tsx`, …) is listed in
  `package.json` `devDependencies` and never ships in the npm package: `files` holds
  `dist/`, the licence files, the README, the changelog, `server.json` and `llms.txt`.

## Not included

No font file, ICC profile, image, hyphenation dictionary or certificate is committed to
this repository or shipped in the package. The synthetic ICC profiles used by the
conformance corpus and the examples are generated at test time by
`scripts/lib/synthetic-icc.ts`; the signing identity of the corpus is generated at test
time by `scripts/lib/corpus-cert.ts`.
