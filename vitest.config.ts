import { defineConfig } from 'vitest/config';

/**
 * Reporters are chosen for token-cheap output: `dot` prints one character
 * per test instead of one line per file, and `github-actions` adds inline
 * annotations on CI only. When `scripts/gate.ts` drives the run (GATE=1) a
 * JSON report is written as well, which is where the gate reads the test
 * count from; nothing else needs the file, so it is not produced otherwise.
 */
const reporters: Array<'dot' | 'github-actions' | ['json', { outputFile: string }]> = ['dot'];
if (process.env.GITHUB_ACTIONS) reporters.push('github-actions');
if (process.env.GATE === '1') reporters.push(['json', { outputFile: 'test-output/.gate/vitest.json' }]);

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        environment: 'node',
        globals: false,
        reporters,
        // pdfnative >= 1.8 writes every date in UTC, but tests also format
        // instants themselves (signing times, TSA genTime, expected strings).
        // Pinning the zone makes the suite machine-independent;
        // scripts/helpers/hermetic.ts does the same for the sample generator.
        env: { TZ: 'UTC' },
        // Process isolation: a test that leaks a global, a timer, an env var
        // (PDFNATIVE_MCP_*), the process-wide creation-date pin or a
        // registered font cannot influence the next file's outcome.
        pool: 'forks',
        // Determinism: the same ordering on every machine, so a failure seen
        // in CI reproduces locally without a seed.
        sequence: { shuffle: false },
        // AES-256 (R6) uses the ISO 32000-2 SHA-256/384/512 hash rotation in
        // pure JS; under v8 coverage instrumentation an encrypt→decrypt round
        // trip can exceed the 5 s default, so allow generous headroom.
        testTimeout: 30_000,
        hookTimeout: 30_000,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            // Excluded from coverage thresholds:
            //   - cli.ts    process entry point (transport wiring, signal
            //               handling); the gate's `smoke` step and
            //               tests/cli-stdio.test.ts drive the built binary
            //   - index.ts  re-exports only, no logic of its own
            exclude: [
                'src/cli.ts',
                'src/index.ts',
            ],
            // `text-summary` is four lines instead of one per source file;
            // `json-summary` is what scripts/gate.ts reads the percentage
            // from; `html` stays for local drill-down.
            reporter: ['text-summary', 'json-summary', 'html'],
            thresholds: {
                // v1.7.0 measured on the final branch: 93.53 / 86.08 / 98.88 / 95.45 (statements /
                // branches / functions / lines); v1.6.0 was 93.06 / 84.68 / 98.59 / 95.09.
                // Thresholds sit about 4 points below the measured values so a regression fails
                // CI while ordinary churn does not. Branches and functions were raised in 1.7.0.
                // Never lower these; raise them when a release lifts coverage.
                statements: 89,
                branches: 82,
                functions: 94,
                lines: 91,
            },
        },
    },
});
