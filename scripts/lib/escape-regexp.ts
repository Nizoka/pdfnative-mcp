/**
 * Escape every character that has a meaning in a regular expression, so a
 * literal (a version string, a path, a tool name) can be interpolated into a
 * `new RegExp(...)` source. Backslash included — the omission CodeQL's
 * `js/incomplete-sanitization` rule flags in a bare `.replace(/\./g, '\\.')`.
 * Shared by the repository tooling and the tests.
 */
export function escapeRegExp(literal: string): string {
    return literal.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
}
