import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        environment: 'node',
        globals: false,
        // AES-256 (R6) uses the ISO 32000-2 SHA-256/384/512 hash rotation in
        // pure JS; under v8 coverage instrumentation an encrypt→decrypt round
        // trip can exceed the 5 s default, so allow generous headroom.
        testTimeout: 30_000,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: [
                'src/cli.ts',
                'src/index.ts',
            ],
            thresholds: {
                // v1.6.0 measured on the final branch: 93.06 / 84.68 / 98.59 / 95.09 (statements /
                // branches / functions / lines). Thresholds sit 4–9 points below the measured
                // values so a regression fails CI while ordinary churn does not.
                // Never lower these; raise them when a release lifts coverage.
                statements: 89,
                branches: 80,
                functions: 90,
                lines: 91,
            },
        },
    },
});
