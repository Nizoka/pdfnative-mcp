# Release Notes Template

This directory contains release notes for each published version of pdfnative-mcp.

## File naming

- One file per version: release-notes/vMAJOR.MINOR.PATCH.md
- Examples: v0.1.0.md, v0.2.0.md, v1.0.0.md

## Template

Copy this structure into a new release-notes/vX.Y.Z.md file.
Omit sections that do not apply (do not leave empty headings).

```markdown
# pdfnative-mcp vX.Y.Z

<!-- GitHub Release title: vX.Y.Z - short description -->

_Released YYYY-MM-DD_

<!-- One paragraph summary + compatibility statement. -->

## Highlights

- ...

## Security

- **fix(security):** ...

## Breaking Changes

- **BREAKING:** ...

## Added

- **feat(scope):** ...

## Changed

- **chore(scope):** ...

## Fixed

- **fix(scope):** ... ([#NN])

## Deprecated

- **deprecate(scope):** ...

## Removed

- **remove(scope):** ...

## Performance

- **perf(scope):** ...

## Documentation

- **docs(scope):** ...

## Install

npm install pdfnative-mcp@X.Y.Z

## Upgrade

No breaking changes. Drop-in replacement for vX.Y.Z-1.

## Links

- CHANGELOG: ../CHANGELOG.md
- Full diff: https://github.com/Nizoka/pdfnative-mcp/compare/vX.Y.Z-1...vX.Y.Z
```

## Conventions

- GitHub Release title format: vX.Y.Z - short description.
- Decide SemVer level first (major/minor/patch).
- Mirror bullets in CHANGELOG.md.
- Use conventional prefixes: feat(scope), fix(scope), chore(scope), docs(scope), ci(scope).
- No emojis in release notes.
- Include compatibility statement for patch and minor releases.

## Publication workflow

1. Draft release-notes/vX.Y.Z.md.
2. Mirror bullets into CHANGELOG.md.
3. Bump package version.
4. Merge to main.
5. Tag vX.Y.Z and publish GitHub Release.
6. Publish workflow releases to npm via OIDC Trusted Publishing.


