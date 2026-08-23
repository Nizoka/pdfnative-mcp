/**
 * Examples-as-tests: every file under `examples/` is loaded, its referenced
 * tool name(s) are checked against the live tool registry, and any
 * self-contained single-tool example (no `<placeholder>` tokens) is executed
 * end-to-end through the MCP `tools/call` handler. PDF-producing examples then
 * have their bytes structurally validated via `assertValidPdf`.
 *
 * This guarantees the published examples never drift from the real schemas or
 * runtime behaviour: a stale field name or renamed tool fails CI immediately.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOcspRequest } from 'pdfnative';

import { callToolDirect, ensureCompressionReady } from '../src/server.js';
import { ALLOWED_HOSTS_ENV, REVOCATION_ENV, TSA_AUTH_ENV, TSA_URL_ENV, __setFetchForTests } from '../src/network.js';
import { buildEcdsaSelfSignedCert } from './_cert-fixtures.js';
import { createMockPki, createMockRevocationProvider, MOCK_CRL_URL, MOCK_OCSP_URL, type MockPki } from './_ltv-fixtures.js';
import { connectLegacy, type McpTestClient } from './_mcp-harness.js';
import { assertValidPdf } from './_pdf-assert.js';
import { startMockTsaServer, type MockTsaServer } from './_tsa-server.js';

const EXAMPLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');

interface ExampleStep {
    readonly tool: string;
    readonly arguments: Record<string, unknown>;
}
interface ExampleFile {
    readonly description?: string;
    readonly tool?: string;
    readonly arguments?: Record<string, unknown>;
    readonly steps?: ReadonlyArray<ExampleStep>;
}

interface CallResponse {
    isError?: boolean;
    content: Array<{ type: string; text?: string; resource?: { blob?: string; mimeType?: string } }>;
    structuredContent?: Record<string, unknown>;
}

/** Recursively test whether any string in `value` contains an `<...>` placeholder token. */
function hasPlaceholder(value: unknown): boolean {
    if (typeof value === 'string') return /<[^>]+>/.test(value);
    if (Array.isArray(value)) return value.some(hasPlaceholder);
    if (value !== null && typeof value === 'object') return Object.values(value).some(hasPlaceholder);
    return false;
}

/** Normalise a single-tool or multi-step example into a flat list of steps. */
function toSteps(example: ExampleFile): ExampleStep[] {
    if (Array.isArray(example.steps)) return [...example.steps];
    if (typeof example.tool === 'string') {
        return [{ tool: example.tool, arguments: example.arguments ?? {} }];
    }
    return [];
}

const exampleFiles = readdirSync(EXAMPLES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

let knownTools: Set<string>;
let client: McpTestClient;

describe('examples/*.json', () => {
    beforeAll(async () => {
        delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
        await ensureCompressionReady();
        client = await connectLegacy();
        const list = await client.listTools();
        knownTools = new Set(list.tools.map((t) => t.name));
    });

    afterAll(async () => {
        await client.close();
    });

    it('discovers at least the four canonical examples', () => {
        expect(exampleFiles.length).toBeGreaterThanOrEqual(4);
    });

    for (const file of exampleFiles) {
        describe(file, () => {
            const raw = readFileSync(path.join(EXAMPLES_DIR, file), 'utf8');

            it('is valid JSON with a description and a tool or steps', () => {
                const parsed = JSON.parse(raw) as ExampleFile;
                expect(typeof parsed.description).toBe('string');
                const steps = toSteps(parsed);
                expect(steps.length, 'example must declare a tool or steps').toBeGreaterThan(0);
            });

            it('references only registered tools with object arguments', () => {
                const steps = toSteps(JSON.parse(raw) as ExampleFile);
                for (const step of steps) {
                    expect(knownTools, `unknown tool '${step.tool}' in ${file}`).toContain(step.tool);
                    expect(typeof step.arguments).toBe('object');
                    expect(step.arguments).not.toBeNull();
                }
            });

            it('executes end-to-end when self-contained (no placeholders)', async () => {
                const parsed = JSON.parse(raw) as ExampleFile;
                const steps = toSteps(parsed);
                const executable = steps.length === 1 && !hasPlaceholder(steps[0].arguments);
                if (!executable) {
                    // Multi-step / placeholder examples are documentation-only: the
                    // structural checks above already guarantee they stay current.
                    return;
                }
                const step = steps[0];
                const response = (await client.callTool(step.tool, step.arguments)) as CallResponse;

                expect(response.isError, `${file}: ${response.content[0]?.text ?? ''}`).not.toBe(true);

                const pdfBlob = response.content.find((c) => c.type === 'resource')?.resource?.blob;
                if (pdfBlob !== undefined && pdfBlob.length > 0) {
                    assertValidPdf(pdfBlob);
                }
                // Generous timeout: multi-script examples embed large Noto CJK font
                // modules on first load, which is slow under coverage instrumentation.
            }, 60_000);
        });
    }
});

/* -------------------------------------------------------------------------- */
/* F-17: multi-step / placeholder examples run for real, chained in order     */
/* -------------------------------------------------------------------------- */

/**
 * Placeholder conventions used by `examples/*.json` (every `<...>` token that
 * appears inside `arguments`). Step references are resolved from the PDF bytes
 * produced by the named earlier step; certificate / key / revocation material
 * comes from the offline mock PKI and the self-signed EC fixture; the PAdES
 * network rungs talk to the loopback TSA and the mock OCSP / CRL responder.
 */
interface ChainContext {
    readonly pki: MockPki;
    readonly ec: { readonly certDerBase64: string; readonly pkcs8DerBase64: string };
    readonly crlDerBase64: string;
    readonly ocspDerBase64: string;
    /** Lazily generated helper documents (memoised per example run). */
    readonly fresh: (kind: 'plain' | 'signed' | 'encryptedA' | 'encryptedB', password?: string) => Promise<string>;
}

function pdfBlobOf(response: CallResponse): string | undefined {
    return response.content.find((c) => c.type === 'resource')?.resource?.blob;
}

async function callOk(tool: string, args: Record<string, unknown>, label: string): Promise<CallResponse> {
    const response = (await callToolDirect(tool, args)) as CallResponse;
    expect(response.isError, `${label}: ${response.content[0]?.text ?? ''}`).not.toBe(true);
    return response;
}

/** Resolve one `<placeholder>` token; `outputs[i]` is the PDF produced by step i+1. */
async function resolvePlaceholder(token: string, ctx: ChainContext, outputs: ReadonlyArray<string | undefined>, step: ExampleStep): Promise<string> {
    const stepRef = /^base64 from step (\d+)$/.exec(token);
    if (stepRef !== null) {
        const out = outputs[Number(stepRef[1]) - 1];
        if (out === undefined) throw new Error(`step ${stepRef[1]} produced no PDF to chain`);
        return out;
    }
    if (token === 'base64-of-the-generated-pdf') {
        const out = outputs[0];
        if (out === undefined) throw new Error('step 1 produced no PDF to chain');
        return out;
    }
    const password = typeof step.arguments['password'] === 'string' ? step.arguments['password'] : undefined;
    switch (token) {
        case 'any PDF base64':
        case 'any unencrypted PDF base64':
            return ctx.fresh('plain');
        case 'signed PDF base64':
        case 'base64 signed PDF':
            return ctx.fresh('signed');
        case 'base64 of encrypted PDF A':
            return ctx.fresh('encryptedA', password);
        case 'base64 of encrypted PDF B':
            return ctx.fresh('encryptedB', password);
        case 'author cert DER, base64':
        case 'signer cert DER, base64':
            return ctx.pki.signer.certDerBase64;
        case 'author RSA PKCS#1 DER, base64':
        case 'RSA private key PKCS#1 DER, base64':
            return ctx.pki.signer.rsaKeyPkcs1DerBase64;
        case 'intermediate CA DER, base64':
        case 'root CA DER, base64':
        case 'optional self-signed root or CA in DER, base64':
            // The mock PKI has no intermediate: the root plays both roles.
            return ctx.pki.root.certDerBase64;
        case 'reviewer cert DER, base64':
        case 'your ECDSA cert in DER, base64':
            return ctx.ec.certDerBase64;
        case 'reviewer EC key PKCS#8 DER, base64':
        case 'your EC private key in PKCS#8 DER, base64':
            return ctx.ec.pkcs8DerBase64;
        case 'CRL DER, base64':
            return ctx.crlDerBase64;
        case 'OCSPResponse DER, base64':
            return ctx.ocspDerBase64;
        default:
            throw new Error(`unknown example placeholder '<${token}>' — extend the resolver in tests/examples.test.ts`);
    }
}

async function resolveArguments(value: unknown, ctx: ChainContext, outputs: ReadonlyArray<string | undefined>, step: ExampleStep): Promise<unknown> {
    if (typeof value === 'string') {
        const m = /^<(.+)>$/.exec(value);
        return m === null ? value : resolvePlaceholder(m[1]!, ctx, outputs, step);
    }
    if (Array.isArray(value)) return Promise.all(value.map((v) => resolveArguments(v, ctx, outputs, step)));
    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) out[k] = await resolveArguments(v, ctx, outputs, step);
        return out;
    }
    return value;
}

const chainedFiles = exampleFiles.filter((f) => {
    const parsed = JSON.parse(readFileSync(path.join(EXAMPLES_DIR, f), 'utf8')) as ExampleFile;
    const steps = toSteps(parsed);
    return steps.length > 1 || steps.some((s) => hasPlaceholder(s.arguments));
});

describe('examples/*.json — multi-step and placeholder examples run end-to-end (F-17)', () => {
    const ENV = [TSA_URL_ENV, TSA_AUTH_ENV, REVOCATION_ENV, ALLOWED_HOSTS_ENV];
    let ctx: ChainContext;
    let tsa: MockTsaServer;

    beforeAll(async () => {
        delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
        await ensureCompressionReady();
        const pki = createMockPki();
        const ecFixture = buildEcdsaSelfSignedCert('Example Reviewer');
        const revocation = createMockRevocationProvider(pki);
        const crl = await revocation.fetchCrl!(MOCK_CRL_URL);
        const ocsp = await revocation.fetchOcsp!(MOCK_OCSP_URL, buildOcspRequest(pki.signer.cert, pki.root.cert));

        // PAdES ladder rungs: loopback RFC 3161 TSA + mock.invalid OCSP / CRL routed through the fetch seam.
        tsa = await startMockTsaServer(pki);
        process.env[TSA_URL_ENV] = tsa.url;
        process.env[REVOCATION_ENV] = 'ocsp,crl';
        process.env[ALLOWED_HOSTS_ENV] = 'mock.invalid';
        __setFetchForTests(async (input, init) => {
            const url = String(input);
            if (url === MOCK_OCSP_URL) {
                return new Response(await revocation.fetchOcsp!(url, init?.body as Uint8Array), { status: 200, headers: { 'content-type': 'application/ocsp-response' } });
            }
            if (url === MOCK_CRL_URL) {
                return new Response(await revocation.fetchCrl!(url), { status: 200, headers: { 'content-type': 'application/pkix-crl' } });
            }
            return globalThis.fetch(input, init);
        });

        const memo = new Map<string, Promise<string>>();
        const generate = async (title: string): Promise<string> => {
            const r = await callOk('generate_basic_pdf', { title, blocks: [{ type: 'paragraph', text: `${title} body` }] }, `fixture ${title}`);
            return pdfBlobOf(r)!;
        };
        const fresh: ChainContext['fresh'] = (kind, password) => {
            const key = `${kind}:${password ?? ''}`;
            let p = memo.get(key);
            if (p === undefined) {
                p = (async () => {
                    if (kind === 'plain') return generate('Example input');
                    if (kind === 'signed') {
                        const r = await callOk(
                            'sign_pdf',
                            {
                                pdfBase64: await generate('Signed input'),
                                algorithm: 'rsa-sha256',
                                profile: 'pades',
                                certDerBase64: pki.signer.certDerBase64,
                                certChainDerBase64: [...pki.chainDerBase64],
                                rsaKeyPkcs1DerBase64: pki.signer.rsaKeyPkcs1DerBase64,
                            },
                            'fixture signed',
                        );
                        return pdfBlobOf(r)!;
                    }
                    const r = await callOk(
                        'encrypt_pdf',
                        { pdfBase64: await generate(kind === 'encryptedA' ? 'Encrypted A' : 'Encrypted B'), ownerPassword: 'example-owner', userPassword: password ?? 'shared-open-password', algorithm: 'aes128' },
                        `fixture ${kind}`,
                    );
                    return pdfBlobOf(r)!;
                })();
                memo.set(key, p);
            }
            return p;
        };

        ctx = {
            pki,
            ec: {
                certDerBase64: Buffer.from(ecFixture.certDer).toString('base64'),
                pkcs8DerBase64: ecFixture.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
            },
            crlDerBase64: Buffer.from(crl).toString('base64'),
            ocspDerBase64: Buffer.from(ocsp).toString('base64'),
            fresh,
        };
    });

    afterAll(async () => {
        for (const k of ENV) delete process.env[k];
        __setFetchForTests(null);
        await tsa.close();
    });

    it('covers every example that the single-step runner skips', () => {
        expect(chainedFiles.length).toBeGreaterThanOrEqual(14);
    });

    for (const file of chainedFiles) {
        it(`${file}: every step succeeds with the previous step's output substituted`, async () => {
            const steps = toSteps(JSON.parse(readFileSync(path.join(EXAMPLES_DIR, file), 'utf8')) as ExampleFile);
            const outputs: Array<string | undefined> = [];
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i]!;
                const args = (await resolveArguments(step.arguments, ctx, outputs, step)) as Record<string, unknown>;
                expect(hasPlaceholder(args), `${file} step ${i + 1}: unresolved placeholder`).toBe(false);
                const response = (await callToolDirect(step.tool, args)) as CallResponse;
                const text = response.content[0]?.text ?? '';
                expect(response.isError, `${file} step ${i + 1} (${step.tool}): ${text}`).not.toBe(true);
                expect(text, `${file} step ${i + 1} (${step.tool}) failed validation`).not.toContain('VALIDATION_ERROR');
                const blob = pdfBlobOf(response);
                if (blob !== undefined && blob.length > 0) {
                    // Password-protected output cannot be opened by the plain reader; the
                    // next step (inspect_pdf / decrypt_pdf with `password`) validates it instead.
                    const encrypted = Buffer.from(blob, 'base64').toString('latin1').includes('/Encrypt');
                    if (!encrypted) assertValidPdf(blob);
                }
                outputs.push(blob);
            }
        }, 120_000);
    }
});
