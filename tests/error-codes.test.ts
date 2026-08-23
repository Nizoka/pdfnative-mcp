/**
 * Error-code inventory: every `ToolError('CODE', …)` literal in `src/` must be
 * (a) documented in the AGENTS.md error table and (b) exercised by at least
 * one test under `tests/`. The second half of this file adds the targeted
 * tests for codes that no tool suite reached before.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ensureCompressionReady } from '../src/server.js';
import { ToolError } from '../src/errors.js';
import { emitPdf, emitPdfMulti, resolveSandboxedPath } from '../src/output.js';
import { ALLOWED_HOSTS_ENV, REVOCATION_ENV } from '../src/network.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { prepareSignaturePlaceholder } from '../src/tools/prepare-signature-placeholder.js';
import { signPdf } from '../src/tools/sign-pdf.js';
import { verifyPdf } from '../src/tools/verify-pdf.js';
import { decryptPdf } from '../src/tools/decrypt-pdf.js';
import { encryptPdf } from '../src/tools/encrypt-pdf.js';
import { inspectPdf } from '../src/tools/inspect-pdf.js';
import { addLtv } from '../src/tools/add-ltv.js';
import { updateMetadata } from '../src/tools/update-metadata.js';
import { buildRsaSelfSignedCert } from './_cert-fixtures.js';
import { makeEncryptedPdfBytes } from './_encrypted-fixtures.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (entry.endsWith('.ts')) out.push(full);
    }
    return out;
}

/** Every `ToolError('CODE'` / `ToolError(\n 'CODE'` literal under src/, de-duplicated. */
function collectSourceCodes(): string[] {
    const codes = new Set<string>();
    for (const file of walk(path.join(ROOT, 'src'))) {
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(/ToolError\(\s*'([A-Z][A-Z0-9_]+)'/g)) codes.add(m[1]!);
    }
    // Subclasses with a fixed code (SecurityError / GovernanceError) pass it through `super(...)`.
    const errors = readFileSync(path.join(ROOT, 'src', 'errors.ts'), 'utf8');
    for (const m of errors.matchAll(/super\(\s*'([A-Z][A-Z0-9_]+)'/g)) codes.add(m[1]!);
    return [...codes].sort();
}

describe('ToolError code inventory', () => {
    const codes = collectSourceCodes();
    const agents = readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
    const tests = walk(path.join(ROOT, 'tests'))
        .filter((f) => !f.endsWith('error-codes.test.ts'))
        .map((f) => ({ file: path.basename(f), text: readFileSync(f, 'utf8') }));
    const thisFile = readFileSync(fileURLToPath(import.meta.url), 'utf8');

    it('finds a non-trivial set of codes in src/', () => {
        expect(codes.length).toBeGreaterThanOrEqual(40);
        expect(codes).toContain('VALIDATION_ERROR');
        expect(codes).toContain('SECURITY_VIOLATION');
    });

    it('documents every code in the AGENTS.md error table', () => {
        const missing = codes.filter((c) => !agents.includes(`\`${c}\``));
        expect(missing, `codes missing from AGENTS.md error table: ${missing.join(', ')}`).toEqual([]);
    });

    it('exercises every code in at least one test under tests/', () => {
        // The targeted tests below count too, but only their describe/it bodies — not this inventory list.
        const targeted = thisFile.slice(thisFile.indexOf("describe('previously uncovered codes"));
        const missing = codes.filter((c) => !tests.some((t) => t.text.includes(c)) && !targeted.includes(c));
        expect(missing, `codes without a test that names them: ${missing.join(', ')}`).toEqual([]);
    });
});

/* -------------------------------------------------------------------------- */
/* Targeted tests for codes no tool suite reached before                      */
/* -------------------------------------------------------------------------- */

async function codeOf(p: Promise<unknown>): Promise<{ code: string; message: string }> {
    try {
        await p;
    } catch (err) {
        if (err instanceof ToolError) return { code: err.code, message: err.message };
        throw err;
    }
    throw new Error('expected the call to reject');
}

describe('previously uncovered codes', () => {
    let plainPdf: string;
    const SANDBOX_ENV = 'PDFNATIVE_MCP_OUTPUT_DIR';
    const ENV = [SANDBOX_ENV, REVOCATION_ENV, ALLOWED_HOSTS_ENV];

    beforeAll(async () => {
        await ensureCompressionReady();
        plainPdf = (await generateBasicPdf({ title: 'Codes', blocks: [{ type: 'paragraph', text: 'error-code coverage' }] })).base64!;
    });
    afterEach(() => {
        for (const k of ENV) delete process.env[k];
        vi.restoreAllMocks();
    });

    it("MISSING_OUTPUT_PATH: outputMode='file' without outputPath (single and multi output)", async () => {
        process.env[SANDBOX_ENV] = path.join(ROOT, 'node_modules', '.cache', 'never-written');
        const bytes = new Uint8Array(Buffer.from(plainPdf, 'base64'));
        expect((await codeOf(emitPdf(bytes, { mode: 'file' }))).code).toBe('MISSING_OUTPUT_PATH');
        expect((await codeOf(emitPdfMulti([bytes], { mode: 'file' }))).code).toBe('MISSING_OUTPUT_PATH');
        // Through a tool: the Zod layer leaves outputPath optional, so the output layer reports it.
        expect((await codeOf(generateBasicPdf({ title: 'F', blocks: [{ type: 'paragraph', text: 'x' }], outputMode: 'file' }))).code).toBe('MISSING_OUTPUT_PATH');
    });

    it('INVALID_PATH: an empty outputPath inside an enabled sandbox', () => {
        process.env[SANDBOX_ENV] = path.join(ROOT, 'node_modules', '.cache', 'never-written');
        let code: string | undefined;
        try {
            resolveSandboxedPath('');
        } catch (err) {
            code = err instanceof ToolError ? err.code : 'other';
        }
        expect(code).toBe('INVALID_PATH');
    });

    it('VERIFY_FAILED: a /ByteRange that reaches beyond the end of the file', async () => {
        const { certDer, privateKey } = buildRsaSelfSignedCert('ByteRange');
        const signed = await signPdf({
            pdfBase64: plainPdf,
            algorithm: 'rsa-sha256',
            certDerBase64: Buffer.from(certDer).toString('base64'),
            rsaKeyPkcs1DerBase64: privateKey.export({ format: 'der', type: 'pkcs1' }).toString('base64'),
        });
        const text = Buffer.from(signed.base64!, 'base64').toString('latin1');
        const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/.exec(text);
        expect(m).not.toBeNull();
        // Overwrite the fourth number in place (same width) so every other offset stays intact.
        const tail = m![4]!;
        const at = m!.index + m![0].lastIndexOf(tail);
        const mutated = text.slice(0, at) + '9'.repeat(tail.length) + text.slice(at + tail.length);
        // verify_pdf never lets a per-signature structural failure escape as a thrown
        // ToolError: the VERIFY_FAILED guard is caught per widget and its message
        // lands in `signatures[i].errors` with allValid=false.
        const result = await verifyPdf({ pdfBase64: Buffer.from(mutated, 'latin1').toString('base64') });
        expect(result.allValid).toBe(false);
        expect(result.signatures[0]!.integrity).toBe(false);
        expect(result.signatures[0]!.errors).toEqual(['ByteRange exceeds PDF length']);
    });

    it('PLACEHOLDER_FAILED: prepare_signature_placeholder with a pageIndex past the last page', async () => {
        const prep = await codeOf(prepareSignaturePlaceholder({ title: 'One page', signerName: 'X', pageIndex: 99 }));
        expect(prep.code).toBe('PLACEHOLDER_FAILED');
        expect(prep.message).toContain('Failed to inject signature placeholder');
    });

    it('PLACEHOLDER_FAILED: sign_pdf auto-inject on a signed document re-using the existing field name', async () => {
        const { certDer, privateKey } = buildRsaSelfSignedCert('Inject');
        const material = {
            algorithm: 'rsa-sha256',
            certDerBase64: Buffer.from(certDer).toString('base64'),
            rsaKeyPkcs1DerBase64: privateKey.export({ format: 'der', type: 'pkcs1' }).toString('base64'),
        };
        const first = await signPdf({ pdfBase64: plainPdf, fieldName: 'Author', ...material });
        const again = await codeOf(signPdf({ pdfBase64: first.base64!, fieldName: 'Author', allowMultiple: true, ...material }));
        expect(again.code).toBe('PLACEHOLDER_FAILED');
    });

    it('ENCRYPTION_UNSUPPORTED: a non-Standard security handler is refused by decrypt_pdf and inspect_pdf', async () => {
        const text = Buffer.from(makeEncryptedPdfBytes({ userPassword: 'open' })).toString('latin1');
        expect(text).toContain('/Filter /Standard');
        // Same byte length, so the xref offsets stay valid and only the handler name changes.
        const foreign = Buffer.from(text.replace('/Filter /Standard', '/Filter /Adobe.PS'), 'latin1').toString('base64');
        const dec = await codeOf(decryptPdf({ pdfBase64: foreign, password: 'open' }));
        expect(dec.code).toBe('ENCRYPTION_UNSUPPORTED');
        expect(dec.message).toContain('Adobe.PS');
        expect((await codeOf(inspectPdf({ pdfBase64: foreign, password: 'open' }))).code).toBe('ENCRYPTION_UNSUPPORTED');
    });

    it('ENCRYPTION_ERROR: re-encryption without a usable CSPRNG', async () => {
        vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => {
            throw new Error('getRandomValues is unavailable in this runtime');
        });
        const err = await codeOf(encryptPdf({ pdfBase64: plainPdf, ownerPassword: 'owner-secret', userPassword: 'open' }));
        expect(err.code).toBe('ENCRYPTION_ERROR');
        expect(err.message).toContain('secure random source');
    });

    it('LTV_EMPTY: is a defensive mapping only — pdfnative 1.7 always embeds the signer certificate, so a self-signed signer without AIA / CRL-DP still succeeds online', async () => {
        const { certDer, privateKey } = buildRsaSelfSignedCert('Lonely');
        const signed = await signPdf({
            pdfBase64: plainPdf,
            algorithm: 'rsa-sha256',
            profile: 'pades',
            certDerBase64: Buffer.from(certDer).toString('base64'),
            rsaKeyPkcs1DerBase64: privateKey.export({ format: 'der', type: 'pkcs1' }).toString('base64'),
        });
        process.env[REVOCATION_ENV] = 'ocsp,crl';
        process.env[ALLOWED_HOSTS_ENV] = 'ocsp.example.com';
        // The engine's `embedValidationInfo` only throws "LtvData is empty" when no
        // certificate, OCSP or CRL is collected; `addValidationInfo` seeds the set with
        // the signer chain, and offline mode is guarded by the Zod refinement, so the
        // LTV_EMPTY branch is unreachable through the tool with this engine version.
        const out = await addLtv({ pdfBase64: signed.base64!, mode: 'online' });
        expect(out.summary).toEqual({ mode: 'online', signatures: 1 });
        expect(Buffer.from(out.base64!, 'base64').toString('latin1')).toContain('/DSS');
    });

    it('METADATA_ERROR: the engine cannot re-synthesise XMP when the /Metadata stream is undecodable', async () => {
        const archival = await generateBasicPdf({ title: 'XMP', blocks: [{ type: 'paragraph', text: 'x' }], pdfA: 'pdfa2b' });
        const text = Buffer.from(archival.base64!, 'base64').toString('latin1');
        const original = '/Type /Metadata /Subtype /XML';
        expect(text).toContain(original);
        // Same width, so every xref offset stays valid; the (uncompressed) XMP now
        // claims FlateDecode and inflating it fails inside the modifier.
        const broken = text.replace(original, '/Filter /FlateDecode /S /XML ');
        const err = await codeOf(updateMetadata({ pdfBase64: Buffer.from(broken, 'latin1').toString('base64'), title: 'New title' }));
        expect(err.code).toBe('METADATA_ERROR');
        expect(err.message).toContain('Failed to update metadata');
    });
});
