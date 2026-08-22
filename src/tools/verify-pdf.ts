/**
 * Tool: verify_pdf
 *
 * Read-only verification of PAdES Baseline / adbe.pkcs7.detached signatures
 * embedded in a PDF. For every `/FT /Sig` widget the tool:
 *
 *   1. Recomputes the SHA-256 of the bytes covered by `/ByteRange`.
 *   2. ASN.1-decodes the CMS SignedData blob in `/Contents`.
 *   3. Extracts the signed `messageDigest` attribute and compares it against
 *      the recomputed PDF digest — this is the **integrity** check.
 *   4. Verifies the CMS `signatureValue` over the re-encoded `signedAttrs` SET
 *      using the signer certificate's public key.
 *   5. Optionally walks the certificate chain against `trustedRootsDerBase64`
 *      using pdfnative's `verifyCertSignature`; otherwise reports the cert as
 *      either `self-signed` or `unverified`.
 *
 * Inputs: `pdfBase64`, optional `trustedRootsDerBase64: string[]`.
 * Output (validated against the structured outputSchema):
 *   - `signatureCount`, `signatures: VerifyResult[]`, `allValid`, `summary`.
 *
 * Algorithms supported in v1.0.0: RSA-SHA256, ECDSA-SHA256 (P-256).
 */
import { createHash } from 'node:crypto';

import {
    decodeEcPublicKey,
    isSelfSigned,
    openPdf,
    parseCertificate,
    parseRsaPublicKey,
    rsaVerifyHash,
    verifyCertSignature,
    type X509Certificate,
} from 'pdfnative';
import { z } from 'zod';

import { ToolError } from '../errors.js';
import { mapDecryptError, PASSWORD_INPUT_SCHEMA, PasswordSchema } from '../encryption.js';
import {
    decodeEcdsaSignature,
    parseCmsSignedData,
    reencodeSignedAttrsAsSet,
    type CmsAlgorithm,
    type CmsDigest,
} from '../cms.js';
import {
    collectSignatureWidgets,
    contentsToBytes,
    type SignatureWidget,
} from '../pdf-introspection.js';

export const VERIFY_PDF_NAME = 'verify_pdf';

export const VERIFY_PDF_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        pdfBase64: {
            type: 'string',
            minLength: 4,
            description: 'Base64-encoded PDF bytes to verify.',
        },
        password: PASSWORD_INPUT_SCHEMA,
        trustedRootsDerBase64: {
            type: 'array',
            description:
                'Optional list of base64-encoded X.509 root certificates (DER). When supplied, each signer certificate is validated against these roots; otherwise chainTrust is reported as self-signed or unverified.',
            maxItems: 16,
            items: { type: 'string', minLength: 4 },
        },
        verbosity: {
            type: 'string',
            enum: ['summary', 'full'],
            default: 'full',
            description:
                "Response verbosity. 'full' (default) returns the per-signature signatures[] array; 'summary' returns a token-frugal verdict { signatureCount, allValid, invalid, summary } and drops signatures[].",
        },
        fields: {
            type: 'array',
            description:
                "Optional dot-path projection applied to the structured result (e.g. ['allValid'] or ['signatures.valid']). Composes after verbosity. Unknown paths are omitted.",
            maxItems: 16,
            items: { type: 'string', minLength: 1 },
        },
    },
    required: ['pdfBase64'],
} as const;

export const VERIFY_PDF_OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['signatureCount', 'signatures', 'allValid', 'summary'],
    properties: {
        signatureCount: { type: 'integer', minimum: 0 },
        allValid: { type: 'boolean' },
        summary: { type: 'string' },
        signatures: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['valid', 'integrity', 'algorithm', 'chainTrust', 'errors'],
                properties: {
                    fieldName: { type: ['string', 'null'] },
                    valid: { type: 'boolean' },
                    integrity: { type: 'boolean' },
                    algorithm: { type: ['string', 'null'], enum: ['rsa-sha256', 'rsa-sha384', 'rsa-sha512', 'ecdsa-sha256', null] },
                    signerSubject: { type: ['string', 'null'] },
                    signingTime: { type: ['string', 'null'] },
                    reason: { type: ['string', 'null'] },
                    location: { type: ['string', 'null'] },
                    chainTrust: {
                        type: 'string',
                        enum: ['trusted', 'self-signed', 'unverified', 'unknown'],
                    },
                    errors: { type: 'array', items: { type: 'string' } },
                },
            },
        },
    },
} as const;

const InputSchema = z.object({
    pdfBase64: z.string().min(4),
    password: PasswordSchema.optional(),
    trustedRootsDerBase64: z.array(z.string().min(4)).max(16).optional(),
    verbosity: z.enum(['summary', 'full']).optional(),
    fields: z.array(z.string().min(1)).max(16).optional(),
});

export type ChainTrust = 'trusted' | 'self-signed' | 'unverified' | 'unknown';

export interface VerifyResult {
    readonly fieldName: string | null;
    readonly valid: boolean;
    readonly integrity: boolean;
    readonly algorithm: CmsAlgorithm | null;
    readonly signerSubject: string | null;
    readonly signingTime: string | null;
    readonly reason: string | null;
    readonly location: string | null;
    readonly chainTrust: ChainTrust;
    readonly errors: readonly string[];
}

export interface VerifyPdfResult {
    readonly signatureCount: number;
    readonly allValid: boolean;
    readonly summary: string;
    readonly signatures: readonly VerifyResult[];
}

function decodeBase64(value: string, field: string): Uint8Array {
    try {
        return new Uint8Array(Buffer.from(value, 'base64'));
    } catch {
        throw new ToolError('VALIDATION_ERROR', `${field} is not valid base64.`);
    }
}

function hashBytes(digest: CmsDigest, bytes: Uint8Array): Uint8Array {
    return new Uint8Array(createHash(digest).update(bytes).digest());
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
    return diff === 0;
}

function digestCoveredBytes(pdf: Uint8Array, byteRange: readonly [number, number, number, number]): Uint8Array {
    const [a, b, c, d] = byteRange;
    if (a + b > pdf.length || c + d > pdf.length) {
        throw new ToolError('VERIFY_FAILED', 'ByteRange exceeds PDF length');
    }
    const hash = createHash('sha256');
    hash.update(pdf.subarray(a, a + b));
    hash.update(pdf.subarray(c, c + d));
    return new Uint8Array(hash.digest());
}

function safeSubjectCN(cert: X509Certificate): string | null {
    return cert.subject.cn ?? cert.subject.o ?? null;
}

function decideChainTrust(
    cert: X509Certificate,
    trustedRoots: readonly X509Certificate[],
): { trust: ChainTrust; error: string | null } {
    if (trustedRoots.length > 0) {
        for (const root of trustedRoots) {
            try {
                if (verifyCertSignature(cert, root)) {
                    return { trust: 'trusted', error: null };
                }
            } catch {
                // try next root
            }
        }
        return { trust: 'unverified', error: 'no trusted root validates the signer certificate' };
    }
    try {
        return isSelfSigned(cert)
            ? { trust: 'self-signed', error: null }
            : { trust: 'unverified', error: null };
        /* v8 ignore next 3 */
    } catch {
        return { trust: 'unknown', error: null };
    }
}

function verifySignatureValue(
    algorithm: CmsAlgorithm,
    signerCert: X509Certificate,
    signedDataHash: Uint8Array,
    signatureValue: Uint8Array,
): { ok: boolean; error: string | null } {
    if (algorithm === 'rsa-sha256') {
        try {
            const pubKey = parseRsaPublicKey(signerCert.publicKeyBytes);
            return { ok: rsaVerifyHash(signedDataHash, signatureValue, pubKey), error: null };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { ok: false, error: `RSA verification failed: ${msg}` };
        }
    }
    // ecdsa-sha256
    try {
        // pdfnative stores EC public key as the SubjectPublicKeyInfo BIT STRING content;
        // we need the raw 0x04-prefixed uncompressed point.
        const pub = extractEcPublicPoint(signerCert);
        const { r, s } = decodeEcdsaSignature(signatureValue);
        return { ok: ecdsaVerifyHash(signedDataHash, r, s, pub), error: null };
        /* v8 ignore next 4 */
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `ECDSA verification failed: ${msg}` };
    }
}

function extractEcPublicPoint(cert: X509Certificate): { x: bigint; y: bigint } {
    const bytes = cert.publicKeyBytes;
    if (bytes[0] === 0x04 && bytes.length === 65) {
        return decodeEcPublicKey(bytes);
    }
    // Some chains include a leading 0x00 unused-bits byte from the BIT STRING wrapper.
    /* v8 ignore next 3 */
    if (bytes[0] === 0x00 && bytes[1] === 0x04 && bytes.length === 66) {
        return decodeEcPublicKey(bytes.subarray(1));
    }
    /* v8 ignore next */
    throw new ToolError('VERIFY_FAILED', `unsupported EC public key encoding (first byte 0x${bytes[0]?.toString(16)})`);
}

function ecdsaVerifyHash(
    hash: Uint8Array,
    r: bigint,
    s: bigint,
    pub: { x: bigint; y: bigint },
): boolean {
    // pdfnative exports `ecdsaVerify(message, r, s, pub)` which itself hashes the
    // message internally. Since CMS-with-signedAttrs verification needs to verify
    // an already-computed digest, we bypass by passing the hash as message and
    // letting pdfnative's internal sha256 collide — but that would double-hash.
    //
    // Workaround: encode a single-byte message whose sha256 equals `hash`. That
    // is infeasible. Instead we call the lower-level path: build a 32-byte input
    // that, after sha256, matches `hash`. Also infeasible.
    //
    // The robust path is to call the unexported `ecdsaVerifyHash` via the
    // exported `ecdsaVerify`'s computed-hash branch. Since pdfnative does not
    // re-export `ecdsaVerifyHash`, we ship a small reimplementation here using
    // the curve parameters of P-256.
    return ecdsaVerifyP256(hash, r, s, pub);
}

// P-256 curve parameters (FIPS 186-4 D.1.2.3 / SEC2)
const P256_P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const P256_A = 0xffffffff00000001000000000000000000000000fffffffffffffffffffffffcn;
const P256_GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
const P256_GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;

interface Point {
    readonly x: bigint;
    readonly y: bigint;
    readonly inf: boolean;
}
const INF: Point = { x: 0n, y: 0n, inf: true };

function mod(a: bigint, m: bigint): bigint {
    const r = a % m;
    return r < 0n ? r + m : r;
}

function modInv(a: bigint, m: bigint): bigint {
    let [g, x] = [m, 0n];
    let [g1, x1] = [mod(a, m), 1n];
    while (g1 !== 0n) {
        const q = g / g1;
        [g, g1] = [g1, g - q * g1];
        [x, x1] = [x1, x - q * x1];
    }
    /* v8 ignore next */
    if (g !== 1n) throw new ToolError('VERIFY_FAILED', 'modular inverse does not exist');
    return mod(x, m);
}

function pointDouble(p: Point): Point {
    if (p.inf) return p;
    const s = mod((3n * p.x * p.x + P256_A) * modInv(2n * p.y, P256_P), P256_P);
    const x = mod(s * s - 2n * p.x, P256_P);
    const y = mod(s * (p.x - x) - p.y, P256_P);
    return { x, y, inf: false };
}

function pointAdd(p: Point, q: Point): Point {
    if (p.inf) return q;
    if (q.inf) return p;
    if (p.x === q.x) {
        if (mod(p.y + q.y, P256_P) === 0n) return INF;
        return pointDouble(p);
    }
    const s = mod((q.y - p.y) * modInv(q.x - p.x, P256_P), P256_P);
    const x = mod(s * s - p.x - q.x, P256_P);
    const y = mod(s * (p.x - x) - p.y, P256_P);
    return { x, y, inf: false };
}

function scalarMul(k: bigint, p: Point): Point {
    let result = INF;
    let addend = p;
    let scalar = mod(k, P256_N);
    while (scalar > 0n) {
        if ((scalar & 1n) === 1n) result = pointAdd(result, addend);
        addend = pointDouble(addend);
        scalar >>= 1n;
    }
    return result;
}

function ecdsaVerifyP256(hash: Uint8Array, r: bigint, s: bigint, pub: { x: bigint; y: bigint }): boolean {
    if (r <= 0n || r >= P256_N || s <= 0n || s >= P256_N) return false;
    let z = 0n;
    for (const b of hash) z = (z << 8n) | BigInt(b);
    // P-256 nlen = 256 bits = hash length; no truncation needed.
    const w = modInv(s, P256_N);
    const u1 = mod(z * w, P256_N);
    const u2 = mod(r * w, P256_N);
    const G: Point = { x: P256_GX, y: P256_GY, inf: false };
    const Q: Point = { x: pub.x, y: pub.y, inf: false };
    const point = pointAdd(scalarMul(u1, G), scalarMul(u2, Q));
    if (point.inf) return false;
    return mod(point.x, P256_N) === mod(r, P256_N);
}

function verifyOneWidget(
    widget: SignatureWidget,
    pdf: Uint8Array,
    trustedRoots: readonly X509Certificate[],
): VerifyResult {
    const errors: string[] = [];

    if (widget.byteRange === null || widget.contentsRaw === null) {
        return {
            fieldName: widget.fieldName,
            valid: false,
            integrity: false,
            algorithm: null,
            signerSubject: null,
            signingTime: widget.signingTimeRaw,
            reason: widget.reason,
            location: widget.location,
            chainTrust: 'unknown',
            errors: ['signature widget has no /V dict or /Contents/ByteRange'],
        };
    }

    // 1) recompute PDF digest
    let pdfDigest: Uint8Array;
    try {
        pdfDigest = digestCoveredBytes(pdf, widget.byteRange);
    } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        return {
            fieldName: widget.fieldName,
            valid: false,
            integrity: false,
            algorithm: null,
            signerSubject: null,
            signingTime: widget.signingTimeRaw,
            reason: widget.reason,
            location: widget.location,
            chainTrust: 'unknown',
            errors,
        };
    }

    // 2) parse CMS
    let cms;
    try {
        cms = parseCmsSignedData(contentsToBytes(widget.contentsRaw));
    } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        return {
            fieldName: widget.fieldName,
            valid: false,
            integrity: false,
            algorithm: null,
            signerSubject: null,
            signingTime: widget.signingTimeRaw,
            reason: widget.reason,
            location: widget.location,
            chainTrust: 'unknown',
            errors,
        };
    }

    // 3) integrity: messageDigest matches PDF digest
    const integrity =
        cms.messageDigest !== null && constantTimeEqual(cms.messageDigest, pdfDigest);
    if (!integrity) {
        if (cms.messageDigest === null) errors.push('CMS has no messageDigest signed attribute');
        else errors.push('messageDigest does not match recomputed PDF hash');
    }

    // 4) parse signer cert
    let signerCert: X509Certificate;
    try {
        signerCert = parseCertificate(cms.signerCertDer);
    } catch (err) {
        errors.push(`signer cert parse failed: ${err instanceof Error ? err.message : String(err)}`);
        return {
            fieldName: widget.fieldName,
            valid: false,
            integrity,
            algorithm: cms.algorithm,
            signerSubject: null,
            signingTime: widget.signingTimeRaw,
            reason: widget.reason,
            location: widget.location,
            chainTrust: 'unknown',
            errors,
        };
    }
    const signerSubject = safeSubjectCN(signerCert);

    // 5) signature value verification
    let sigOk = false;
    if (cms.signedAttrsValueDer !== null) {
        const reencoded = reencodeSignedAttrsAsSet(cms.signedAttrsValueDer);
        const attrsHash = hashBytes(cms.digestAlgorithm, reencoded);
        const r = verifySignatureValue(cms.algorithm, signerCert, attrsHash, cms.signatureValue);
        sigOk = r.ok;
        if (r.error !== null) errors.push(r.error);
        if (!sigOk && r.error === null) errors.push('signature value does not match signedAttrs hash');
    } else {
        // No signedAttrs: verify signature directly over PDF digest.
        const r = verifySignatureValue(cms.algorithm, signerCert, pdfDigest, cms.signatureValue);
        sigOk = r.ok;
        if (r.error !== null) errors.push(r.error);
        if (!sigOk && r.error === null) errors.push('signature value does not match PDF digest');
    }

    // 6) chain trust
    const chain = decideChainTrust(signerCert, trustedRoots);
    if (chain.error !== null) errors.push(chain.error);

    const valid = integrity && sigOk && (chain.trust === 'trusted' || chain.trust === 'self-signed' || trustedRoots.length === 0);

    return {
        fieldName: widget.fieldName,
        valid,
        integrity,
        algorithm: cms.algorithm,
        signerSubject,
        signingTime: widget.signingTimeRaw,
        reason: widget.reason,
        location: widget.location,
        chainTrust: chain.trust,
        errors,
    };
}

export async function verifyPdf(rawInput: unknown): Promise<VerifyPdfResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { pdfBase64, password, trustedRootsDerBase64 } = parsed.data;

    const pdf = decodeBase64(pdfBase64, 'pdfBase64');

    let trustedRoots: X509Certificate[] = [];
    if (trustedRootsDerBase64 !== undefined && trustedRootsDerBase64.length > 0) {
        trustedRoots = trustedRootsDerBase64.map((b64, i) => {
            const der = decodeBase64(b64, `trustedRootsDerBase64[${i}]`);
            try {
                return parseCertificate(der);
            } catch (err) {
                throw new ToolError(
                    'VALIDATION_ERROR',
                    `trustedRootsDerBase64[${i}] is not a valid X.509 certificate: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        });
    }

    let reader;
    try {
        reader = openPdf(pdf, password !== undefined ? { password } : undefined);
    } catch (err) {
        mapDecryptError(err, password !== undefined);
    }

    const widgets = collectSignatureWidgets(reader);
    const signatures = widgets.map((w) => verifyOneWidget(w, pdf, trustedRoots));
    const allValid = signatures.length > 0 && signatures.every((s) => s.valid);
    const summary =
        signatures.length === 0
            ? 'No signatures found.'
            : allValid
                ? `All ${signatures.length} signature(s) valid.`
                : `${signatures.filter((s) => s.valid).length}/${signatures.length} signature(s) valid.`;

    return { signatureCount: signatures.length, allValid, summary, signatures };
}
