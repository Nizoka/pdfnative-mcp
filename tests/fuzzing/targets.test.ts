/**
 * The ClusterFuzzLite targets, run here on a seeded corpus (1.8.0).
 *
 * The container is the only place Jazzer's coverage guidance exists, so a
 * target committed without a local proof is a claim rather than a check.
 * What this suite establishes is the half that can be established anywhere:
 * the modules load, the exported `fuzz` is callable, it survives every
 * truncation and mutation the seeded corpus produces, and — the part that
 * matters — it rethrows a programming error (`TypeError`, `RangeError`, …)
 * and reports an uncoded tool failure or a sandbox escape. A target that
 * swallowed every exception would run for a week in the container and find
 * nothing, and no coverage report would say so.
 *
 * The targets import `../dist/fuzz-surface.js`; vitest aliases that path to
 * `src/fuzz-surface.ts` (vitest.config.ts), the container builds dist/ first.
 * Same file, two engines. The seeds are the ones the container zips
 * (`tests/fuzzing/_fuzz-seeds.ts`), so a seed that stopped validating fails
 * here before it starts a fuzzer outside the grammar.
 */
import { readFileSync, readdirSync } from 'node:fs';

import { beforeAll, describe, expect, it } from 'vitest';

import { FUZZ_TARGETS, fuzzSeeds, type FuzzTarget } from './_fuzz-seeds.js';

type Target = { readonly fuzz: (data: Buffer) => void | Promise<void> };

const TARGETS = readdirSync('fuzz').filter((f) => f.endsWith('.js')).sort();
const nameOf = (file: string): FuzzTarget => file.replace(/\.js$/, '') as FuzzTarget;

/** A small deterministic generator (xorshift32), so a failure reproduces without a seed flag. */
function prng(seed: number): { int: (n: number) => number } {
    let s = seed >>> 0 || 1;
    return {
        int(n: number): number {
            s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
            return s % n;
        },
    };
}

/** Bytes that are none of the grammars: shared by every target. */
function sharedCorpus(): Uint8Array[] {
    return [
        new Uint8Array(0),
        new TextEncoder().encode('{'),
        new TextEncoder().encode('{"tool":"generate_basic_pdf","args":null}'),
        new TextEncoder().encode('%PDF-1.7\n%%EOF'),
        Uint8Array.of(0xff, 0xd8, 0xff),
        Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
        Uint8Array.of(0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20),
        new TextEncoder().encode('..\\..\\x.pdf'),
    ];
}

let SEEDS: Readonly<Record<FuzzTarget, readonly Uint8Array[]>>;
beforeAll(async () => {
    SEEDS = await fuzzSeeds();
}, 120_000);

describe('fuzz targets', () => {
    it('are the set the container builds and seeds', () => {
        expect(TARGETS).toEqual(FUZZ_TARGETS.map((t) => `${t}.js`));
        const build = readFileSync('.clusterfuzzlite/build.sh', 'utf8');
        for (const target of TARGETS) {
            expect(build, `build.sh does not compile ${target}`).toContain(`compile_javascript_fuzzer pdfnative-mcp fuzz/${target} --sync`);
        }
        expect(build, 'build.sh does not loop over every target when zipping seeds').toContain(`for target in ${FUZZ_TARGETS.join(' ')}; do`);
        expect(build).toContain('npx tsx tests/fuzzing/_fuzz-seeds.ts');
        expect(build).toContain('npm run build');
    });

    it('pin the engine to one version and every package of its tree to an integrity hash', () => {
        // An unpinned `npm install @jazzer.js/core` resolves whatever the
        // registry serves on the day of the build — a supply-chain input the
        // project's own lockfile discipline exists to refuse.
        const manifest = JSON.parse(readFileSync('.clusterfuzzlite/engine/package.json', 'utf8')) as { dependencies: Record<string, string> };
        expect(Object.keys(manifest.dependencies)).toEqual(['@jazzer.js/core']);
        const version = manifest.dependencies['@jazzer.js/core'] ?? '';
        expect(version, 'an exact version, not a range').toMatch(/^\d+\.\d+\.\d+$/);

        const lock = JSON.parse(readFileSync('.clusterfuzzlite/engine/package-lock.json', 'utf8')) as {
            lockfileVersion: number;
            packages: Record<string, { version?: string; integrity?: string; resolved?: string }>;
        };
        expect(lock.lockfileVersion).toBe(3);
        expect(lock.packages['node_modules/@jazzer.js/core']?.version).toBe(version);
        const installed = Object.entries(lock.packages).filter(([path]) => path !== '');
        expect(installed.length).toBeGreaterThan(1);
        for (const [path, entry] of installed) {
            expect(entry.integrity, `${path} has no sha512 integrity`).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
            expect(entry.resolved, `${path} resolves outside the npm registry`).toMatch(/^https:\/\/registry\.npmjs\.org\//);
        }

        const build = readFileSync('.clusterfuzzlite/build.sh', 'utf8');
        const commands = build.split('\n').filter((line) => !line.trimStart().startsWith('#'));
        expect(commands.filter((line) => /\bnpm (install|i|add)\b/.test(line)), 'build.sh installs outside a lockfile').toEqual([]);
        expect(commands.join('\n')).toContain('(cd .clusterfuzzlite/engine && npm ci --ignore-scripts)');
        expect(readFileSync('.clusterfuzzlite/engine/.npmrc', 'utf8')).toContain('ignore-scripts=true');
    });

    it('keep the engine out of the package: three runtime dependencies, and fuzz/ is not published', () => {
        const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string>; files: string[] };
        expect(Object.keys(pkg.dependencies).sort()).toEqual(['@modelcontextprotocol/server', 'pdfnative', 'zod']);
        for (const entry of pkg.files) expect(entry).not.toMatch(/fuzz|clusterfuzzlite/);
        expect(readFileSync('.clusterfuzzlite/Dockerfile', 'utf8')).toMatch(/^FROM gcr\.io\/oss-fuzz-base\/base-builder-javascript:[\w.-]+@sha256:[0-9a-f]{64}$/m);
    });

    it.each(FUZZ_TARGETS)('the %s seeds are non-empty', (target) => {
        expect(SEEDS[target].length).toBeGreaterThan(2);
    });

    it.each(TARGETS)('%s survives the seeded corpus, truncated and mutated', async (file) => {
        const { fuzz } = (await import(/* @vite-ignore */ `../../fuzz/${file}`)) as Target;
        expect(typeof fuzz, `${file} exports no fuzz function`).toBe('function');

        const rand = prng(0x5eed_1009);
        const run = async (bytes: Uint8Array): Promise<void> => {
            await fuzz(Buffer.from(bytes));
        };
        for (const seed of SEEDS[nameOf(file)]) await run(seed);
        // Fewer mutations on the tool-call target (each run builds a document) than on the parsers.
        const rounds = nameOf(file) === 'tool-call' ? 6 : 48;
        for (const seed of [...sharedCorpus(), ...SEEDS[nameOf(file)].slice(0, 3)]) {
            const stride = Math.max(1, Math.ceil(seed.length / 16));
            for (let cut = 0; cut < seed.length; cut += stride) await run(seed.subarray(0, cut));
            for (let i = 0; i < rounds; i++) {
                const mutated = Uint8Array.from(seed);
                const flips = 1 + rand.int(4);
                for (let f = 0; f < flips && mutated.length > 0; f++) mutated[rand.int(mutated.length)] = rand.int(256);
                await run(mutated);
            }
        }
    }, 300_000);

    it('tool-call reports an uncoded failure instead of swallowing it', async () => {
        const { fuzz } = (await import(/* @vite-ignore */ `../../fuzz/${'tool-call.js'}`)) as Target;
        // An unknown tool is a protocol error by design and must NOT be reported; a coded failure neither.
        await expect(fuzz(Buffer.from('{"tool":"no_such_tool","args":{}}'))).resolves.toBeUndefined();
        await expect(fuzz(Buffer.from('{"tool":"extract_text","args":{"pdfBase64":"@@@@"}}'))).resolves.toBeUndefined();
    });

    it('output-path accepts refusals and sandboxed paths alike, and never writes to disk', async () => {
        const { fuzz } = (await import(/* @vite-ignore */ `../../fuzz/${'output-path.js'}`)) as Target;
        for (const probe of ['../x.pdf', '/etc/passwd.pdf', 'C:\\Windows\\x.pdf', 'a\0.pdf', 'fine/report.pdf', 'draft.md']) {
            expect(() => fuzz(Buffer.from(probe)), probe).not.toThrow();
        }
        expect(process.env['PDFNATIVE_MCP_OUTPUT_DIR']).toContain('pdfnative-mcp-fuzz-sandbox');
    });
});
