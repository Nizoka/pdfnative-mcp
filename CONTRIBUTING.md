# Contributing to pdfnative-mcp

Thanks for considering a contribution! This project is intentionally small, focused, and high-quality — the bar is **zero runtime dependencies beyond `@modelcontextprotocol/sdk`, `pdfnative`, and `zod`**.

## Quick start

```bash
git clone https://github.com/Nizoka/pdfnative-mpc.git
cd pdfnative-mcp
npm install
npm run typecheck && npm run lint && npm test
```

## Workflow

1. **Open an issue first** for non-trivial changes (new tools, breaking changes, dependency additions).
2. **Branch from `main`**: `git checkout -b feat/my-feature` (use Conventional Commit prefixes: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`).
3. **Keep diffs small and focused**. One logical change per PR.
4. **Add tests** for any new behaviour. The CI pipeline runs `npm run typecheck`, `npm run lint`, and `npm test` on every PR.
5. **Update the changelog** under the `## [Unreleased]` section.

## Coding standards

- TypeScript **strict** mode is mandatory.
- ESLint must pass with **zero warnings**.
- No `any`. Use `unknown` + narrowing.
- Public APIs (anything exported from `src/index.ts`) require TSDoc comments.
- All tool inputs MUST be validated with Zod inside the handler (defence in depth — the JSON Schema is for clients, the Zod schema is for safety).

## Adding a new tool

1. Create `src/tools/<tool-name>.ts` exporting:
   - `<TOOL>_NAME` constant
   - `<TOOL>_INPUT_SCHEMA` (JSON Schema, served to clients)
   - `<toolName>` handler `(args: unknown) => Promise<OutputResult>`
2. Register the tool in `src/server.ts` (`TOOLS` array). Provide `title`, `description`, and appropriate `annotations`.
3. Add tests in `tests/tools.test.ts` (or a dedicated file).
4. Document the tool in `README.md`.
5. Bump the changelog.

## Reporting bugs

Use [GitHub Issues](https://github.com/Nizoka/pdfnative-mpc/issues) with:
- Reproduction steps (ideally a JSON-RPC payload sent to the stdio server).
- Expected vs. actual output.
- Node version (`node -v`) and OS.

## Security issues

**Do not open public issues for security problems.** See [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contributions will be licensed under the [MIT License](LICENSE).

