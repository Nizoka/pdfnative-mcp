import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Workflow, supply-chain and contributor invariants ─────────────────
//
// None of this is visible to the type checker or to the test suite proper:
// a floating action tag, a checkout that keeps the job token, a release job
// that quietly skips veraPDF, an npm client that drifts between two publishes,
// a `${{ }}` interpolated into a shell script. Each is locked here as a
// plain-text assertion on the files that carry it. Ported from pdfnative's
// tests/tools/workflows.test.ts (1.9.0: the guard → build → publish → attest
// pipeline, block-mode egress, workflow lint, ClusterFuzzLite), with the
// Windows / macOS job and the MCP registry job this repository keeps.

const ROOT = process.cwd();
const WORKFLOWS = join(ROOT, '.github', 'workflows');
const workflowFiles = readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml')).sort();
// Every tracked text blob is LF (verify:docs rule eol-lf), but a working copy
// may still be CRLF on Windows; normalise so the regexes below see one line ending.
const readWorkflow = (f: string): string => readFileSync(join(WORKFLOWS, f), 'utf8').replace(/\r\n/g, '\n');
const readText = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');
/** Escape every regular-expression metacharacter, backslash included, of a literal. */
const escapeRegExp = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

const COMPOSITE_ACTIONS = ['.github/actions/setup-verapdf/action.yml'];

const HARDEN_RUNNER = 'step-security/harden-runner@';

/** The checks the main ruleset requires: every one must name a job (verify:docs rule ruleset-parity holds that too). */
const REQUIRED_CHECKS = ['ci (22)', 'ci (24)', 'os (windows-latest)', 'os (macos-latest)', 'sample-regression', 'workflow-lint'];

/** Every `- name:`/`- uses:` step block of every job, in order, keyed by job id. */
function jobSteps(text: string): Map<string, string[]> {
    const jobs = new Map<string, string[]>();
    const jobsAt = text.search(/^jobs:\s*$/m);
    if (jobsAt < 0) return jobs;
    let job: string | null = null;
    let steps: string[] | null = null;
    for (const line of text.slice(jobsAt).split('\n').slice(1)) {
        const jobId = /^  ([a-z][a-z0-9-]*):\s*$/.exec(line);
        if (jobId) {
            job = jobId[1];
            steps = null;
            continue;
        }
        if (job === null) continue;
        if (/^    steps:\s*$/.test(line)) {
            steps = [];
            jobs.set(job, steps);
            continue;
        }
        if (steps === null) continue;
        if (/^      - /.test(line)) steps.push(line);
        else if (steps.length > 0 && /^\s{8,}/.test(line)) steps[steps.length - 1] += `\n${line}`;
    }
    return jobs;
}

/** The body of one job (from its id line to the next job id or the end), comment lines dropped. */
function jobBody(text: string, job: string): string {
    const m = new RegExp(`^  ${escapeRegExp(job)}:\\s*\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:\\s*$|(?![\\s\\S]))`, 'm').exec(text);
    return (m?.[1] ?? '').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
}

// ── Actions: pinned, hardened, credential-free ───────────────────────

describe('every workflow and composite action', () => {
    const allFiles = [
        ...workflowFiles.map((f) => ({ label: f, text: readWorkflow(f) })),
        ...COMPOSITE_ACTIONS.map((p) => ({ label: p, text: readText(...p.split('/')) })),
    ];

    it('is the expected set of workflows', () => {
        expect(workflowFiles).toEqual([
            'audit.yml', 'ci.yml', 'codeql.yml', 'dependency-review.yml', 'docs.yml', 'fuzz.yml',
            'node-current.yml', 'publish.yml', 'sample-regression.yml', 'scorecard.yml', 'verapdf.yml',
        ]);
    });

    it('pins every action to a 40-hex commit SHA with a version comment', () => {
        for (const { label, text } of allFiles) {
            const uses = [...text.matchAll(/^\s*(?:- )?uses:\s*(\S+)[^\n]*$/gm)];
            expect(uses.length, `${label} declares no action`).toBeGreaterThan(0);
            for (const m of uses) {
                const ref = m[1];
                if (ref.startsWith('./')) continue; // local composite action
                expect(ref, `${label}: ${ref}`).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
                // ClusterFuzzLite publishes a moving `v1` tag only; the SHA is still what runs.
                expect(m[0], `${label}: ${ref} lacks a "# vX.Y.Z" comment`).toMatch(/#\s*v\d+(?:\.\d+\.\d+)?\s*$/);
            }
        }
    });

    it('pins each action to ONE SHA across the tree (no version drift between workflows)', () => {
        const pins = new Map<string, Set<string>>();
        for (const { text } of allFiles) {
            for (const m of text.matchAll(/uses:\s*([^@\s]+)@([0-9a-f]{40})/g)) {
                // github/codeql-action/{init,analyze,upload-sarif} and clusterfuzzlite/actions/* share one release each.
                const action = m[1].startsWith('github/codeql-action/') ? 'github/codeql-action' : m[1].startsWith('google/clusterfuzzlite/') ? 'google/clusterfuzzlite' : m[1];
                const set = pins.get(action) ?? new Set<string>();
                set.add(m[2]);
                pins.set(action, set);
            }
        }
        for (const [action, shas] of pins) expect([...shas], action).toHaveLength(1);
    });

    it('every actions/checkout step disables persist-credentials', () => {
        for (const { label, text } of allFiles) {
            const re = /uses: actions\/checkout@[^\n]*\n((?:[ \t]+[^\n]*\n)*)/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(text)) !== null) {
                const block = m[1].split('\n').filter((l) => l.trim() !== '' && !/^\s+- /.test(l));
                expect(block.some((l) => /persist-credentials:\s*false/.test(l)), `${label}: checkout keeps credentials`).toBe(true);
            }
        }
    });

    it('never interpolates an expression inside a run: script (template injection — values go through env:)', () => {
        for (const { label, text } of allFiles) {
            const runs = [...text.matchAll(/^\s*run:\s*\|?[^\n]*\n((?:[ \t]+[^\n]*\n?)*)/gm)];
            for (const m of runs) {
                expect(`${m[0]}`, `${label}: a \${{ }} inside run:`).not.toMatch(/\$\{\{/);
            }
        }
    });
});

describe('every workflow job', () => {
    it('starts with harden-runner — block mode with an allow-list, or audit mode with a dated reason', () => {
        for (const f of workflowFiles) {
            const jobs = jobSteps(readWorkflow(f));
            expect(jobs.size, `${f}: no job with steps`).toBeGreaterThan(0);
            for (const [job, steps] of jobs) {
                expect(steps[0], `${f} › ${job}: first step`).toContain(HARDEN_RUNNER);
                if (/egress-policy:\s*block/.test(steps[0])) {
                    expect(steps[0], `${f} › ${job}: block mode without an allow-list`).toMatch(/allowed-endpoints:\s*>\s*\n(?:\s+[\w.-]+:\d+\s*\n?)+/);
                } else {
                    expect(steps[0], `${f} › ${job}: egress policy`).toMatch(/egress-policy:\s*audit\s*#\s*(?:\d{4}-\d{2}-\d{2}:|Windows runners)/);
                }
            }
        }
    });

    it('installs dependencies with --ignore-scripts', () => {
        for (const f of workflowFiles) {
            for (const m of readWorkflow(f).matchAll(/run: npm ci\b[^\n]*/g)) {
                expect(m[0], `${f}`).toContain('npm ci --ignore-scripts');
            }
        }
    });

    it('declares permissions, a timeout and (except publish) a cancelling concurrency group', () => {
        for (const f of workflowFiles) {
            const text = readWorkflow(f);
            expect(text, `${f}: permissions`).toMatch(/^permissions:/m);
            expect(text, `${f}: timeout`).toMatch(/timeout-minutes:\s*\d+/);
            if (f === 'publish.yml') continue;
            if (['audit.yml', 'dependency-review.yml'].includes(f)) continue; // single short job, no cancel needed
            expect(text, `${f}: concurrency`).toMatch(/concurrency:\s*\n\s*group:[^\n]+\n\s*cancel-in-progress:\s*true/);
        }
    });

    it('grants no write permission at the workflow level (job-scoped only: Scorecard Token-Permissions)', () => {
        for (const f of workflowFiles) {
            const text = readWorkflow(f);
            const top = /^permissions:\s*\n((?:  [a-z-]+:\s*[a-z-]+\s*\n)*)/m.exec(text);
            const topLevel = top?.[1] ?? '';
            expect(topLevel, `${f}: top-level write`).not.toMatch(/:\s*write/);
            expect(text, `${f}: read-all or an explicit map`).toMatch(/^permissions:\s*(?:read-all|\n  [a-z-]+:)/m);
        }
    });

    it('mints an OIDC token only where nothing from the lockfile runs (publish, attest, registry, scorecard)', () => {
        for (const f of workflowFiles) {
            const text = readWorkflow(f);
            for (const [job] of jobSteps(text)) {
                const body = jobBody(text, job);
                if (!/id-token:\s*write/.test(body)) continue;
                expect(['publish', 'attest', 'registry', 'analysis'], `${f} › ${job} mints a token`).toContain(job);
                expect(body, `${f} › ${job}: a job that mints a token installs no dependency`).not.toMatch(/run: npm ci\b/);
            }
        }
    });
});

// ── The gate is the only definition of green ─────────────────────────

describe('ci.yml', () => {
    const ci = readWorkflow('ci.yml');

    it('keeps the job ids and matrices the ruleset requires, and runs on every change (no paths filter)', () => {
        expect(ci).toMatch(/^  ci:\s*$/m);
        expect(ci).toMatch(/node-version:\s*\[22, 24\]/);
        expect(ci).toMatch(/^  workflow-lint:\s*$/m);
        expect(ci).not.toMatch(/^\s*paths(-ignore)?:/m);
        const ruleset = JSON.parse(readText('.github', 'rulesets', 'main.json')) as {
            rules: Array<{ type: string; parameters?: { required_status_checks?: Array<{ context: string }> } }>;
        };
        const contexts = ruleset.rules.find((r) => r.type === 'required_status_checks')?.parameters?.required_status_checks?.map((c) => c.context) ?? [];
        expect(contexts).toEqual(REQUIRED_CHECKS);
    });

    it('runs the gate with --require-all and audits outside it, in block mode on Linux', () => {
        expect(ci).toMatch(/run: npx tsx scripts\/gate\.ts --ci --require-all/);
        expect(ci).toMatch(/run: npm audit --audit-level=high/);
        expect(ci).toMatch(/if: failure\(\)[\s\S]*upload-artifact[\s\S]*test-output\/\.gate\//);
        expect(jobSteps(ci).get('ci')?.[0]).toMatch(/egress-policy:\s*block/);
    });

    it('lists no gate step by hand', () => {
        // The `ci` job; the `os` job is held to the same rule in the next describe.
        const gated = (jobSteps(ci).get('ci') ?? []).join('\n');
        expect(gated).toContain('scripts/gate.ts');
        for (const step of ['typecheck:all', 'test:coverage', 'validate:pdfa', 'validate:pdfx', 'verify:samples', 'verify:docs', 'npm run build', 'npm run lint', 'node dist/cli.js']) {
            expect(gated, step).not.toMatch(new RegExp(`run: (npm run )?${escapeRegExp(step)}\\s*$`, 'm'));
        }
    });

    it('lints the workflows with zizmor and a checksummed actionlint', () => {
        const steps = jobSteps(ci).get('workflow-lint') ?? [];
        expect(steps.some((s) => /uses: zizmorcore\/zizmor-action@[0-9a-f]{40}/.test(s) && /min-severity:\s*medium/.test(s))).toBe(true);
        const actionlint = steps.find((s) => /name: actionlint/.test(s)) ?? '';
        expect(actionlint).toMatch(/ACTIONLINT_SHA256:\s*[0-9a-f]{64}/);
        expect(actionlint).toMatch(/sha256sum --check --strict/);
        expect(actionlint).toMatch(/--proto '=https'/);
    });
});

describe('ci.yml os matrix job (Windows and macOS)', () => {
    const ci = readWorkflow('ci.yml');
    const steps = jobSteps(ci).get('os') ?? [];

    it('runs the same gate on windows-latest and macos-latest from the pinned Node line, as required checks', () => {
        expect(ci).toMatch(/^  os:\s*\n\s*runs-on:\s*\$\{\{ matrix\.os \}\}/m);
        expect(ci).toMatch(/os:\s*\[windows-latest, macos-latest\]/);
        expect(steps.some((s) => /node-version-file:\s*\.nvmrc/.test(s)), 'setup-node reads .nvmrc').toBe(true);
        const index = (needle: string): number => steps.findIndex((s) => s.includes(needle));
        expect(index('run: npm ci --ignore-scripts')).toBeGreaterThanOrEqual(0);
        expect(index('run: npx tsx scripts/gate.ts --ci --require-all')).toBeGreaterThan(index('run: npm ci --ignore-scripts'));
        expect(steps.some((s) => /if: failure\(\)[\s\S]*upload-artifact[\s\S]*test-output\/\.gate\//.test(s)), 'gate logs uploaded on failure').toBe(true);
        expect(steps.join('\n')).not.toMatch(/run: npm (test|run build)\s*$/m); // the gate, never a hand-written subset
        const ruleset = readText('.github', 'rulesets', 'main.json');
        expect(ruleset).toContain('"os (windows-latest)"');
        expect(ruleset).toContain('"os (macos-latest)"');
    });

    it('skips harden-runner on macOS only (the action supports Linux, and Windows in audit mode) and says so', () => {
        expect(steps[0]).toContain(HARDEN_RUNNER);
        expect(steps[0]).toMatch(/if: runner\.os != 'macOS'/);
        expect(ci).toMatch(/harden-runner supports Windows runners in audit mode only/);
        expect(ci).toMatch(/does not support\s+# macOS at all/);
    });
});

describe('node-current.yml and fuzz.yml are advisory', () => {
    it('neither is a required check, and neither hides a red run with continue-on-error', () => {
        const ruleset = readText('.github', 'rulesets', 'main.json');
        expect(ruleset).not.toMatch(/node-current|node 26|fuzz/);
        for (const f of ['node-current.yml', 'fuzz.yml']) {
            expect(readWorkflow(f), f).not.toMatch(/^\s*continue-on-error:/m);
        }
        expect(readWorkflow('node-current.yml')).toMatch(/node-version:\s*26/);
        expect(readWorkflow('node-current.yml')).toMatch(/run: npx tsx scripts\/gate\.ts --ci --require-all/);
    });

    it('fuzz.yml builds and runs the ClusterFuzzLite targets in code-change mode on pull requests and batch mode weekly', () => {
        const fuzz = readWorkflow('fuzz.yml');
        expect(fuzz).toMatch(/uses: google\/clusterfuzzlite\/actions\/build_fuzzers@[0-9a-f]{40}/);
        expect(fuzz).toMatch(/uses: google\/clusterfuzzlite\/actions\/run_fuzzers@[0-9a-f]{40}/);
        expect(fuzz).toMatch(/mode: code-change/);
        expect(fuzz).toMatch(/mode: batch/);
        expect(fuzz).toMatch(/output-sarif: true/);
        expect(fuzz).toMatch(/schedule:\s*\n\s*(?:#[^\n]*\n\s*)*- cron:/);
        expect(existsSync(join(ROOT, '.clusterfuzzlite', 'project.yaml'))).toBe(true);
    });
});

describe('codeql.yml', () => {
    it('scans the sources and the workflows with the security-extended suite, security-events scoped to the job', () => {
        const codeql = readWorkflow('codeql.yml');
        expect(codeql).toMatch(/language:\s*\[actions, javascript-typescript\]/);
        expect(codeql).toMatch(/queries:\s*security-extended/);
        expect(codeql).toMatch(/build-mode:\s*none/);
        expect(codeql).not.toMatch(/^\s*paths(-ignore)?:/m);
        expect(jobBody(codeql, 'analyze')).toMatch(/security-events:\s*write/);
    });
});

describe('publish.yml — guard → build → publish → attest → registry', () => {
    const publish = readWorkflow('publish.yml');
    const jobs = jobSteps(publish);

    it('has the five jobs in that dependency order', () => {
        expect([...jobs.keys()]).toEqual(['guard', 'build', 'publish', 'attest', 'registry']);
        expect(jobBody(publish, 'build')).toMatch(/needs:\s*guard/);
        expect(jobBody(publish, 'publish')).toMatch(/needs:\s*build/);
        expect(jobBody(publish, 'attest')).toMatch(/needs:\s*\[build, publish\]/);
        expect(jobBody(publish, 'registry')).toMatch(/needs:\s*\[publish, attest\]/);
    });

    it('guards before the environment: a tag only, equal to the package version, nothing installed, nothing minted', () => {
        const guard = jobBody(publish, 'guard');
        expect(guard).not.toMatch(/environment:/);
        expect(guard).not.toMatch(/id-token/);
        expect(guard).not.toMatch(/run: npm ci/);
        expect(guard).toMatch(/if \[ "\$\{GITHUB_REF_TYPE\}" != "tag" \]/);
        expect(guard).toMatch(/does not match package\.json version/);
        expect(guard).toMatch(/egress-policy:\s*block/);
    });

    it('builds on the .nvmrc Node line, runs the publish gate after veraPDF, lists no gate step by hand, and packs once with digests', () => {
        const build = jobBody(publish, 'build');
        expect(build).toMatch(/node-version-file:\s*\.nvmrc/);
        expect(build).not.toMatch(/node-version:\s*'>=/);
        expect(build).not.toMatch(/id-token/);
        const steps = jobs.get('build') ?? [];
        const index = (needle: string | RegExp): number => steps.findIndex((s) => (typeof needle === 'string' ? s.includes(needle) : needle.test(s)));
        const verapdf = index('./.github/actions/setup-verapdf');
        const gate = index('run: npx tsx scripts/gate.ts --publish --require-all');
        const dry = index('run: npm pack --dry-run');
        const pack = index(/npm pack --pack-destination/);
        const upload = index(/uses: actions\/upload-artifact@/);
        expect([verapdf, gate, dry, pack, upload].every((i) => i >= 0)).toBe(true);
        expect(verapdf).toBeLessThan(gate);
        expect(gate).toBeLessThan(dry);
        expect(dry).toBeLessThan(pack);
        expect(pack).toBeLessThan(upload);
        expect(build).toMatch(/VERAPDF_HOME:\s*\$\{\{ steps\.verapdf\.outputs\.home \}\}/);
        expect(build).toMatch(/sha256sum[^\n]*\n[\s\S]*openssl dgst -sha512/);
        for (const hand of ['npm run validate:pdfa', 'npm run corpus:pdfa', 'npm run verify:samples', 'npm run test:coverage', 'npm run typecheck:all', 'npm run verify:tool-shape']) {
            expect(publish, hand).not.toContain(`run: ${hand}`);
        }
    });

    it('publishes from the npm-publish environment, one release at a time, with an npm client pinned by SHA-512 and nothing installed', () => {
        const pub = jobBody(publish, 'publish');
        expect(pub).toMatch(/^\s*environment:\s*npm-publish\s*$/m);
        expect(publish).toMatch(/concurrency:\s*\n\s*group:\s*publish\s*\n\s*cancel-in-progress:\s*false/);
        expect(pub).toMatch(/id-token:\s*write/);
        expect(pub).not.toMatch(/run: npm ci/);
        expect(pub).not.toMatch(/npm install -g/);
        expect(publish).not.toMatch(/secrets\.NPM_TOKEN/);
        const version = /NPM_CLIENT_VERSION:\s*(\d+\.\d+\.\d+)/.exec(pub)?.[1];
        expect(version).toBeDefined();
        const [major, minor, patch] = version!.split('.').map(Number);
        expect(major === 11 && (minor > 5 || (minor === 5 && patch >= 1))).toBe(true);
        expect(pub).toMatch(/NPM_CLIENT_INTEGRITY:\s*sha512-[A-Za-z0-9+/]+=*/);
        expect(pub).toMatch(/sha256sum --check --strict/);
        expect(pub).toMatch(/npm-cli\.js" publish "\.\/\$\{TARBALL\}" --provenance --access public/);
        expect(pub).toMatch(/sparse-checkout:\s*\.nvmrc/);
    });

    it('has an attest job with exactly three permissions that attests the registry bytes and the three SBOMs', () => {
        const body = jobBody(publish, 'attest');
        const perms = /permissions:\s*\n((?:\s{6}[a-z-]+:\s*\w+[^\n]*\n)+)/.exec(body);
        expect(perms).not.toBeNull();
        const granted = perms![1].trim().split('\n').map((l) => l.trim().replace(/\s*#.*$/, '')).sort();
        expect(granted).toEqual(['attestations: write', 'contents: write', 'id-token: write']);
        expect(body).toMatch(/npm sbom --sbom-format cyclonedx --omit dev --package-lock-only/);
        expect(body).toMatch(/npm sbom --sbom-format spdx --omit dev --package-lock-only/);
        expect(body).not.toMatch(/cyclonedx-npm/);
        expect(body).toMatch(/npm pack "pdfnative-mcp@\$\{VERSION\}"/);
        expect(body).toMatch(/dist\.integrity/);
        expect(body).toMatch(/npm audit signatures/);
        expect(body).toMatch(/uses: actions\/attest-build-provenance@[0-9a-f]{40}/);
        expect(body).toMatch(/pdfnative-mcp-\$\{VERSION\}\.sigstore\.json/);
        expect(body).toMatch(/gh release view "v\$\{VERSION\}"[\s\S]*gh release upload "v\$\{VERSION\}"[\s\S]*--clobber/);
        expect(body).not.toMatch(/gh release create/);
    });

    it('publishes server.json to the MCP registry with the workflow identity and a doubly verified publisher', () => {
        const body = jobBody(publish, 'registry');
        expect(body).toMatch(/id-token:\s*write/);
        expect(body).toMatch(/MCP_PUBLISHER_VERSION:\s*v\d+\.\d+\.\d+/);
        expect(body).toMatch(/MCP_PUBLISHER_SHA256:\s*[0-9a-f]{64}/);
        expect(body).toMatch(/cosign verify-blob/);
        expect(body).toMatch(/--certificate-identity "https:\/\/github\.com\/modelcontextprotocol\/registry\//);
        expect(body).toMatch(/mcp-publisher" login github-oidc/);
        expect(body).toMatch(/mcp-publisher" publish/);
        expect(body).not.toMatch(/secrets\./);
        expect(body).toMatch(/server\.json declares/);
    });

    it('lists the endpoints of the block policies and the hosts still to baseline', () => {
        for (const host of ['api.github.com', 'registry.npmjs.org', 'software.verapdf.org', 'api.adoptium.net', 'fulcio.sigstore.dev', 'rekor.sigstore.dev', 'tuf-repo-cdn.sigstore.dev', 'uploads.github.com']) {
            expect(publish).toContain(host);
        }
    });
});

describe('package.json publish settings', () => {
    const pkg = JSON.parse(readText('package.json')) as {
        publishConfig?: Record<string, unknown>;
        scripts: Record<string, string>;
        dependencies: Record<string, string>;
    };

    it('declares public access with provenance', () => {
        expect(pkg.publishConfig).toEqual({ access: 'public', provenance: true });
    });

    it('keeps exactly three runtime dependencies', () => {
        expect(Object.keys(pkg.dependencies).sort()).toEqual(['@modelcontextprotocol/server', 'pdfnative', 'zod']);
    });

    it('does not rely on lifecycle scripts that .npmrc disables', () => {
        // ignore-scripts=true: `prepare` would never run, so the build is a gate step.
        expect(pkg.scripts['prepare']).toBeUndefined();
        expect(pkg.scripts['prepublishOnly']).toBe('npm run build');
    });

    it('exposes the opt-in git hooks', () => {
        expect(pkg.scripts['hooks:install']).toBe('node scripts/install-git-hooks.mjs');
        expect(pkg.scripts['hooks:uninstall']).toBe('node scripts/install-git-hooks.mjs --uninstall');
        expect(existsSync(join(ROOT, '.githooks', 'pre-commit'))).toBe(true);
        expect(existsSync(join(ROOT, '.githooks', 'pre-push'))).toBe(true);
    });
});

// ── veraPDF: pinned and checksummed ──────────────────────────────────

describe('setup-verapdf composite action', () => {
    const action = readText('.github', 'actions', 'setup-verapdf', 'action.yml');

    it('checks the installer against a committed SHA-256 before installing it', () => {
        const version = /default:\s*'(\d+\.\d+\.\d+)'/.exec(action)?.[1];
        expect(version).toBeDefined();
        expect(action).toMatch(/sha256sum -c/);
        const checksum = readText('.github', 'checksums', `verapdf-greenfield-${version}-installer.zip.sha256`);
        expect(checksum).toMatch(new RegExp(`^[0-9a-f]{64}  verapdf-greenfield-${escapeRegExp(version!)}-installer\\.zip\\n$`));
    });

    it('hands the install directory back as the `home` output, which verapdf.yml and publish.yml pass as VERAPDF_HOME', () => {
        expect(action).toMatch(/outputs:\s*\n\s*home:/);
        expect(action).toMatch(/echo "home=\$HOME\/verapdf" >> "\$GITHUB_OUTPUT"/);
        // zizmor `github-env`: a composite action that writes GITHUB_ENV / GITHUB_PATH hands every
        // later step of a caller on a dangerous trigger a value it did not choose.
        expect(action, 'the action writes to GITHUB_ENV or GITHUB_PATH').not.toMatch(/>>\s*"?\$GITHUB_(ENV|PATH)"?/);
        for (const f of ['verapdf.yml', 'publish.yml']) {
            expect(readWorkflow(f), f).toContain('uses: ./.github/actions/setup-verapdf');
            expect(readWorkflow(f), f).toMatch(/VERAPDF_HOME:\s*\$\{\{ steps\.verapdf\.outputs\.home \}\}/);
            expect(readWorkflow(f), f).not.toMatch(/software\.verapdf\.org\/rel\/[\d.]+\/verapdf/);
        }
    });

    it('CONTRIBUTING documents the same veraPDF version', () => {
        const version = /default:\s*'(\d+\.\d+\.\d+)'/.exec(action)?.[1];
        expect(readText('CONTRIBUTING.md')).toContain(`verapdf-greenfield-${version}`);
    });
});

// ── Sample regression: a required check with no paths filter ─────────

describe('sample-regression.yml', () => {
    const wf = readWorkflow('sample-regression.yml');

    it('runs on every push and pull request, with no paths filter, deciding the scope inside through env', () => {
        expect(wf).toMatch(/^on:\s*\n\s*push:\s*\n\s*branches:[^\n]*\n\s*pull_request:/m);
        expect(wf).not.toMatch(/^\s*paths(-ignore)?:/m);
        expect(wf).toMatch(/package-lock\\\.json/);
        expect(wf).toMatch(/EVENT_NAME:\s*\$\{\{ github\.event_name \}\}/);
        expect(wf).toMatch(/BASE_SHA:\s*\$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
    });

    it('builds the server before generating and verifying', () => {
        const steps = jobSteps(wf).get('sample-regression') ?? [];
        const index = (needle: string): number => steps.findIndex((s) => s.includes(needle));
        expect(index('run: npm run build')).toBeGreaterThan(index('run: npm ci --ignore-scripts'));
        expect(index('run: npm run test:generate')).toBeGreaterThan(index('run: npm run build'));
        expect(index('run: npx tsx scripts/verify-samples.ts')).toBeGreaterThan(index('run: npm run test:generate'));
    });
});

// ── Dependency hygiene ───────────────────────────────────────────────

describe('dependency review, audit and Dependabot', () => {
    it('reviews every pull request for high vulnerabilities and licences', () => {
        const review = readWorkflow('dependency-review.yml');
        expect(review).toMatch(/^on:\s*\n\s*pull_request:/m);
        expect(review).toMatch(/uses: actions\/dependency-review-action@[0-9a-f]{40}/);
        expect(review).toMatch(/fail-on-severity:\s*high/);
        expect(review).toMatch(/allow-licenses:\s*MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0, Unlicense/);
        expect(review).toMatch(/comment-summary-in-pr:\s*on-failure/);
        // The action's Scorecard column resolves packages through api.deps.dev and reads
        // api.securityscorecards.dev; in block mode a missing host is a bare "fetch failed".
        for (const host of ['api.deps.dev:443', 'api.securityscorecards.dev:443']) expect(review, host).toContain(host);
    });

    it('audits the lockfile weekly', () => {
        const audit = readWorkflow('audit.yml');
        expect(audit).toMatch(/schedule:\s*\n\s*- cron:/);
        expect(audit).toMatch(/workflow_dispatch:/);
        expect(audit).toMatch(/run: npm ci --ignore-scripts/);
        expect(audit).toMatch(/run: npm audit --audit-level=high/);
    });

    it('.npmrc, .nvmrc and .node-version carry the contributor defaults', () => {
        expect(readText('.npmrc')).toBe('ignore-scripts=true\nfund=false\naudit-level=high\n');
        expect(readText('.node-version')).toBe('22\n');
        expect(readText('.nvmrc')).toBe('22\n');
    });

    it('Dependabot waits seven days on every ecosystem, including the fuzz engine and its image', () => {
        const dependabot = readText('.github', 'dependabot.yml');
        const ecosystems = [...dependabot.matchAll(/package-ecosystem:\s*(\S+)\s*\n\s*directory:\s*(\S+)/g)].map((m) => `${m[1]} ${m[2]}`);
        expect(ecosystems).toEqual(['npm /', 'github-actions /', 'npm /.clusterfuzzlite/engine', 'docker /.clusterfuzzlite']);
        expect((dependabot.match(/cooldown:\s*\n\s*default-days:\s*7/g) ?? []).length).toBe(ecosystems.length);
    });

    it('protects release tags with a ruleset the maintainer creates tags under', () => {
        const tags = JSON.parse(readText('.github', 'rulesets', 'tags.json')) as {
            target: string; conditions: { ref_name: { include: string[] } }; rules: Array<{ type: string }>;
        };
        expect(tags.target).toBe('tag');
        expect(tags.conditions.ref_name.include).toEqual(['refs/tags/v*']);
        expect(tags.rules.map((r) => r.type).sort()).toEqual(['deletion', 'non_fast_forward', 'update']);
    });
});

// ── Contributor checklist parity ─────────────────────────────────────

describe('pull request template', () => {
    it('lists the gate and the same items as CONTRIBUTING.md, word for word', () => {
        const template = readText('.github', 'pull_request_template.md');
        const contributing = readText('CONTRIBUTING.md');
        const section = /## Pull Request Checklist\s*\n([\s\S]*?)\n## /.exec(contributing);
        expect(section).not.toBeNull();
        const items = section![1].split('\n').filter((l) => l.startsWith('- [ ]'));
        expect(items.length).toBeGreaterThan(5);
        // Links are rewritten to reach CONTRIBUTING.md from .github/; the wording is identical.
        const normalise = (s: string): string => s.replace(/\]\((?:\.\.\/CONTRIBUTING\.md)?#/g, '](#');
        for (const item of items) expect(normalise(template), item.slice(0, 60)).toContain(normalise(item));
        const templateItems = template.split('\n').filter((l) => l.startsWith('- [ ]'));
        expect(templateItems.map(normalise).sort()).toEqual(items.map(normalise).sort());
        expect(template).toMatch(/`npm run gate` passes/);
        for (const mention of ['ROADMAP.md', 'release-notes/vX.Y.Z.md', 'rebaseline', 'AGENT_RULES.md']) {
            expect(template).toContain(mention);
        }
    });
});
