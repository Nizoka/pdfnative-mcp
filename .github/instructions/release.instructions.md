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
4. Tag vX.Y.Z.
5. Publish GitHub Release.
6. Let publish workflow publish to npm via OIDC.
