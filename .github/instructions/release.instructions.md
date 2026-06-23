---
description: "Use when preparing releases, changelog entries, and GitHub release notes."
applyTo: "release-notes/**,CHANGELOG.md"
---
# Release Note Standards

## Structure
- One file per release: release-notes/vX.Y.Z.md
- Keep sections ordered and omit empty sections.
- Use conventional prefixes in bullets: feat(scope), fix(scope), chore(scope), docs(scope), ci(scope).

## Required parity
- CHANGELOG entry must mirror release bullets.
- GitHub Release body should come from release-notes/vX.Y.Z.md.
- Include compatibility statement for patch/minor releases.

## Publication flow
1. Write release-notes/vX.Y.Z.md.
2. Mirror into CHANGELOG.md.
3. Bump package version.
4. Run the quality gate (`examples:check` runs as part of `test:coverage` in CI — keep it green).
5. Tag vX.Y.Z.
6. Publish GitHub Release.
7. Let publish workflow publish to npm via OIDC.

## Pre-publish dry run & rollback
- **Dry run the registry payload** before tagging: `npx -y @modelcontextprotocol/publisher@latest validate server.json`
  (or the repo's `mcp-publish` step) to catch `name`/version drift early.
- **npm:** Trusted Publishing runs from the tag — do **not** publish manually. If a
  bad version ships, do **not** unpublish; cut a superseding patch (vX.Y.Z+1) and,
  if within npm's 72 h window and truly broken, `npm deprecate pdfnative-mcp@X.Y.Z "use X.Y.Z+1"`.
- **Tags are immutable once released.** A mistake = new patch tag, never a force-moved tag.
