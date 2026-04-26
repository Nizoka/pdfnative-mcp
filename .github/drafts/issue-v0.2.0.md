---
name: Maintenance / Chore
about: Release tasks, dependency updates, metadata, documentation sync, governance
title: 'chore: release v0.2.0 completion and validation'
labels: chore
assignees: ''
---

## Type

Release

## Motivation

Finalize v0.2.0 with all roadmap items implemented and validated against the project's open-source quality and security standards, aligned with pdfnative and MCP conventions.

## Scope

### Included

- Deliver 4 new tools: add_table, add_form, embed_image, prepare_signature_placeholder.
- Deliver optional HTTP transport via PDFNATIVE_MCP_PORT.
- Update release documentation: README, CHANGELOG, release-notes/v0.2.0.md.
- Run full quality gate: typecheck, lint, tests, coverage, build.
- Validate sandbox behavior for outputMode=file (absolute path, traversal, NUL byte, and invalid extension protections).

### Excluded

- API breaking changes.
- Refactor of legacy v0.1.0 tools not required by v0.2.0 scope.
- MCP protocol changes.

## Acceptance Criteria

- [x] MCP server exposes 8 tools via tools/list.
- [x] Test suite passes (53/53) and coverage thresholds are met (statements >= 90, branches >= 80, functions >= 85, lines >= 90).
- [x] Sandbox mode is validated (writes allowed in sandbox, blocked outside sandbox constraints).
- [x] Distribution build is clean and npm package is publish-ready (npm pack --dry-run).
- [x] Release documentation is aligned (README, CHANGELOG, release-notes/v0.2.0.md).
- [x] No breaking change from v0.1.0 to v0.2.0.

## References

- Roadmap: README.md
- Release notes: release-notes/v0.2.0.md
- Changelog: CHANGELOG.md
- Security model: SECURITY.md
