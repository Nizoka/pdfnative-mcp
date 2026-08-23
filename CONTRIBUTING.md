# Contributing to pdfnative-mcp

Thanks for considering a contribution! This project is intentionally small, focused, and high-quality — the bar is **exactly three runtime dependencies — `pdfnative`, the MCP SDK (`@modelcontextprotocol/server` ^2.0.0) and `zod` — and no new one, ever**.

## Quick start

```bash
git clone https://github.com/Nizoka/pdfnative-mcp.git
cd pdfnative-mcp
npm install
npm run typecheck && npm run lint && npm test
```

For the full local-verification workflow — quality gate, examples-as-tests, checking that generated PDFs are actually valid, opening output in a viewer, external PDF/A validation, and the MCP Inspector — see [docs/guides/LOCAL_TESTING.md](docs/guides/LOCAL_TESTING.md).

## Workflow

1. **Open an issue first** for non-trivial changes (new tools, breaking changes, dependency additions).
2. **Branch from `main`**: `git checkout -b feat/my-feature` (use Conventional Commit prefixes: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`).
3. **Keep diffs small and focused**. One logical change per PR.
4. **Add tests** for any new behaviour. The CI pipeline runs `npm run typecheck`, `npm run lint`, and `npm test` on every PR — on Linux (Node 22 and 24) and on Windows (Node 22).
5. **Update the changelog** under the `## [Unreleased]` section.

## Coding standards

- TypeScript **strict** mode is mandatory.
- ESLint must pass with **zero warnings** — enforced: `npm run lint` is `eslint src --max-warnings 0`, so a warning fails the gate (no non-null assertions; narrow explicitly).
- No `any`. Use `unknown` + narrowing.
- Public APIs (anything exported from `src/index.ts`) require TSDoc comments.
- All tool inputs MUST be validated with Zod inside the handler (defence in depth — the JSON Schema is for clients, the Zod schema is for safety).

## Adding a new tool

1. Create `src/tools/<tool-name>.ts` exporting:
   - `<TOOL>_NAME` constant
   - `<TOOL>_INPUT_SCHEMA` (JSON Schema, served to clients)
   - `<toolName>` handler `(args: unknown) => Promise<OutputResult>`
2. Register the tool in `src/server.ts` (`TOOLS` array). Provide `title`, `description`, and appropriate `annotations`.
3. Add tests in a dedicated `tests/<tool-name>.test.ts` (success, each error code, file mode). Every new `ToolError` code must appear in `AGENTS.md` §6 and be named by a test — `tests/error-codes.test.ts` enforces both.
4. Document the tool: README matrix and tool reference, `AGENTS.md` (catalogue, decision tree, §6), `docs/AI_GUIDE.md` decision table, `llms.txt`, `docs/KNOWLEDGE_BASE.md`, `docs/API_STABILITY.md` §5.
5. Add a worked example under `examples/` (it is automatically executed by `tests/examples.test.ts` — run `npm run examples:check`).
6. Refresh the catalogue-parity fixture: `npm run build && node scripts/tool-shape.mjs --write` updates `tests/_fixtures/tool-shape.json`, which `tests/catalogue-parity.test.ts` compares against the live `tools/list` (structure only — descriptions are stripped, so wording never trips it). Any fixture diff is a deliberate schema change and is reviewed under [docs/API_STABILITY.md](docs/API_STABILITY.md) §5 (it may need a `TOOL_API_VERSION` bump). `tests/catalogue-superset.test.ts` must keep passing against the frozen `tests/_fixtures/tool-shape.v1.5.0.json` — never regenerate that file; it proves nothing published in 1.5.0 was removed or narrowed.
7. Bump the changelog.

## PDF/A validation (veraPDF)

The server's PDF/A claims are checked against the official reference validator,
[veraPDF](https://verapdf.org). `npm run validate:pdfa` builds `dist/`, drives the
tool handlers to write a 26-file corpus to `test-output/pdfa/` — 24 PDF/A-claiming
documents, 3 of them negative canaries, plus 2 page-tree outputs without a claim
(`scripts/generate-pdfa-corpus.mjs` — a representative sample, not an
exhaustive feature matrix: outline / page labels / nested lists, watermark under
1b and 2b, chart blocks, print boxes and metadata, a caller-supplied ICC
`outputIntent`, tables, scatter chart, international text incl. emoji + math, QR
code, embedded JPEG, PDF/A-3b XML and PDF attachments, an AcroForm, a PAdES
signature, `update_metadata`, a composite document with `toc` / `table` / `link` /
`barcode` / `svg` / `chart` blocks, a Letter document with margins, header / footer
templates and `compress`, plus `merge_pdfs` / `extract_pages` outputs), then
validates each file against the profile it claims in XMP (1b / 2b / 2u / 3b) with
`scripts/validate-pdfa.mjs` and compares the verdict with the manifest's
`expectCompliant` flag. The full entry list with expectations is in
[docs/guides/LOCAL_TESTING.md](docs/guides/LOCAL_TESTING.md#5-external-pdfa-conformance-optional-recommended-for-archival-work).

Two guards keep the run honest. A coverage canary fails it if a file listed in
`manifest.json` is missing or its XMP claim disagrees with the manifest, so a
silent regression in claim emission cannot shrink the validated corpus (the
page-tree tools rebuild the page tree without the source XMP, so their outputs do
not claim PDF/A — the manifest records that and the validator asserts it). And
the corpus includes **negative canaries** (`expectCompliant: false` — an unsigned
signature placeholder, a file without embedded fonts) that veraPDF must reject;
an unexpected pass (`XPASS`) fails the run because it means the validator is
accepting everything. The `add_form` entry is also flagged `false` as a known
engine gap (non-embedded AcroForm `/DR` default-appearance font, 6.2.11.4.1 — the
`PDFA_UNEMBEDDED_FORM_FONT` diagnostic); flip it deliberately when that is fixed
upstream.

Per file the validator reports `PASS` / `FAIL` / `XFAIL` / `XPASS` / `INFRA` /
`SKIP`; exit 0 = every expectation met, 1 = `FAIL` or `XPASS`, 3 = `INFRA`.
Without veraPDF installed (or with a broken Java) the validator prints install
hints and exits 0 — labelled `SKIPPED`, not a pass — so local development never
blocks; set `VERAPDF_REQUIRED=1` to fail closed instead (exit 3, `INFRA`). In CI
(`.github/workflows/verapdf.yml`) the same scripts run with `VERAPDF_REQUIRED=1`
and a pinned veraPDF 1.30.2 whose installer SHA-256 is verified before `java -jar`
executes it, on every push / PR touching `src/`, `scripts/`, `examples/` or the
package manifest. The job is **advisory in 1.6.0** (the validate step has
`continue-on-error`; the exit code, the report and the raw per-file veraPDF XML
land in the job summary and the `verapdf-report` artifact) and is planned to
become **blocking in 1.7.0** — note the `paths:` filter caveat in the workflow
header before making it a required check. veraPDF is an external CI tool, not a
dependency — the no-new-runtime-dependency policy is unchanged.

Installing veraPDF locally (Java 8+ required):

```bash
# macOS
brew install --cask verapdf

# Linux (headless, no GUI — same mechanism as CI; adjust the install path)
curl -fsSL -o installer.zip https://software.verapdf.org/rel/1.30/verapdf-greenfield-1.30.2-installer.zip
unzip installer.zip && cd verapdf-greenfield-*
cat > auto-install.xml <<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<AutomatedInstallation langpack="eng">
  <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>
  <com.izforge.izpack.panels.target.TargetPanel id="install_dir"><installpath>/opt/verapdf</installpath></com.izforge.izpack.panels.target.TargetPanel>
  <com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select"><pack index="0" name="veraPDF GUI" selected="true"/><pack index="1" name="veraPDF Mac and *nix Scripts" selected="true"/><pack index="2" name="veraPDF Documentation" selected="false"/><pack index="3" name="veraPDF Sample Plugins" selected="false"/></com.izforge.izpack.panels.packs.PacksPanel>
  <com.izforge.izpack.panels.install.InstallPanel id="install"/>
  <com.izforge.izpack.panels.finish.FinishPanel id="finish"/>
</AutomatedInstallation>
XML
java -jar verapdf-izpack-installer-*.jar auto-install.xml
export VERAPDF_HOME=/opt/verapdf
```

```powershell
# Windows — download the same installer zip, unzip, and run the GUI installer
# (or the headless recipe above with a Windows <installpath>). The install
# directory contains verapdf.bat; point VERAPDF_HOME at it:
$env:VERAPDF_HOME = "C:\Program Files\veraPDF"
```

Then expose it: add the install directory to `PATH`, or set `VERAPDF_HOME` to it
(`verapdf` / `verapdf.bat` is picked up from the directory root or its `bin/`).
Windows note: the `.bat` launcher is invoked through a shell with quoted
arguments (Node refuses to spawn batch files directly), so paths with spaces work.

## Reporting bugs

Use [GitHub Issues](https://github.com/Nizoka/pdfnative-mcp/issues) with:
- Reproduction steps (ideally a JSON-RPC payload sent to the stdio server).
- Expected vs. actual output.
- Node version (`node -v`) and OS.

## Security issues

**Do not open public issues for security problems.** See [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contributions will be licensed under the [MIT License](LICENSE).


