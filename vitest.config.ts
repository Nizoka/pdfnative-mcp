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
                // v1.0.0 baseline. Phase 4 (verify_pdf) and Phase 5 (new tools)
                // intentionally add substantial defensive error-handling that is
                // exercised by integration tests but not all branches are unit-
                // testable without contrived ASN.1 fuzzing. Encrypted-PDF fixtures
                // (Phase 6) and conformance fixtures (Phase 8) will lift these
                // back to >=92% lines / >=80% branches.
                statements: 88,
                branches: 75,
                functions: 85,
                lines: 90,
            },
        },
    },
});
