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
 * Document timestamps (`/Type /DocTimeStamp`, `/SubFilter /ETSI.RFC3161`) are
 * not CMS signatures over a `messageDigest` attribute but RFC 3161 tokens whose
 * TSTInfo `messageImprint` is the ByteRange digest. They are verified as such
 * (imprint match = `integrity`, token SignerInfo verified with the embedded TSA
 * certificate) and reported with `isDocTimestamp: true`.
 *
 * Inputs: `pdfBase64`, optional `trustedRootsDerBase64: string[]`, optional
 * `ltv: true` for the PAdES long-term-validation view (profile, signature
 * timestamp, embedded /DSS revocation status, B-B / B-T / B-LT / B-LTA level).
 * Output (validated against the structured outputSchema):
 *   - `signatureCount`, `signatures: VerifyResult[]`, `allValid`, `summary`
 *     (+ `dss`, `ltvLevel`, `caveats` when `ltv` is true).
 *
 * Algorithms: RSA with SHA-256/384/512, ECDSA-SHA256 (P-256).
 */
import { createHash } from 'node:crypto';

import {
    decodeEcPublicKey,
    derDecode,
    isSelfSigned,
    isSerialRevoked,
    openPdf,
    parseCertificate,
    parseCmsSignedData as parseCmsStructure,
    parseCrl,
    parseOcspResponse,
    parseRsaPublicKey,
    parseTimestampToken,
    rsaVerifyHash,
    verifyCertSignature,
    verifyTimestampImprint,
    vriKeyForContents,
    type TstInfo,
    type X509Certificate,
} from 'pdfnative';
import { z } from 'zod';

import { ToolError } from '../errors.js';
import { CERT_REMEDY, decodeDerBase64, decodePdfBase64 } from '../base64.js';
import { mapDecryptError, PASSWORD_INPUT_SCHEMA, PasswordSchema } from '../encryption.js';
import {
    decodeEcdsaSignature,
    parseCmsSignedData,
    reencodeSignedAttrsAsSet,
    type CmsAlgorithm,
    type CmsDigest,
    type ParsedCms,
} from '../cms.js';
import {
    collectSignatureWidgets,
    DSS_OUTPUT_SCHEMA,
    readDssMaterial,
    type DssMaterial,
    type DssSummary,
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
        ltv: {
            type: 'boolean',
            default: false,
            description:
                'Add the PAdES view: per signature profile, timestamp, revocation (embedded /DSS only), ltvLevel (B-B / B-T / B-LT / B-LTA); document-level dss, ltvLevel, caveats.',
        },
        verbosity: {
            type: 'string',
            enum: ['summary', 'full'],
            default: 'full',
            description:
                "Response verbosity. 'full' (default) returns the per-signature signatures[] array; 'summary' returns a token-frugal verdict { signatureCount, allValid, invalid, summary } (+ ltvLevel when ltv:true) and drops signatures[], dss and caveats.",
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
        allValid: {
            type: 'boolean',
            description: 'true when the document carries at least one signature and every entry of signatures[] — CMS signatures and /DocTimeStamp tokens alike — is valid (integrity + signature check + chain trust when trustedRootsDerBase64 is given). A tampered document timestamp fails the verdict; a sound one never does.',
        },
        summary: { type: 'string' },
        signatures: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['valid', 'integrity', 'algorithm', 'chainTrust', 'errors'],
                properties: {
                    fieldName: { type: ['string', 'null'] },
                    subFilter: {
                        type: ['string', 'null'],
                        description: '/SubFilter of the signature dictionary (adbe.pkcs7.detached, ETSI.CAdES.detached, ETSI.RFC3161, …).',
                    },
                    isDocTimestamp: {
                        type: 'boolean',
                        description: 'Present (true) only for /DocTimeStamp entries: the RFC 3161 token imprint is checked against the ByteRange digest and the token SignerInfo against the embedded TSA certificate.',
                    },
                    valid: { type: 'boolean' },
                    integrity: { type: 'boolean' },
                    algorithm: { type: ['string', 'null'], enum: ['rsa-sha256', 'rsa-sha384', 'rsa-sha512', 'ecdsa-sha256', null] },
                    signerSubject: { type: ['string', 'null'], description: 'Signer CN (TSA CN for document timestamps).' },
                    signingTime: { type: ['string', 'null'], description: '/M as stored, or the TSTInfo genTime (ISO 8601) for document timestamps.' },
                    reason: { type: ['string', 'null'] },
                    location: { type: ['string', 'null'] },
                    chainTrust: {
                        type: 'string',
                        enum: ['trusted', 'self-signed', 'unverified', 'unknown'],
                    },
                    errors: { type: 'array', items: { type: 'string' } },
                    profile: {
                        type: 'string',
                        enum: ['pkcs7', 'pades'],
                        description: "ltv only. 'pades' when the CMS carries ESS signing-certificate-v2 (RFC 5035).",
                    },
                    timestamp: {
                        type: ['object', 'null'],
                        additionalProperties: false,
                        description: 'ltv only. RFC 3161 signature timestamp (id-aa-signatureTimeStampToken) carried in the unsigned attributes.',
                        required: ['present', 'genTime', 'imprintVerified', 'tokenSignatureValid', 'tsaSubject'],
                        properties: {
                            present: { type: 'boolean' },
                            genTime: { type: ['string', 'null'], description: 'TSTInfo genTime, ISO 8601.' },
                            imprintVerified: { type: ['boolean', 'null'], description: 'Token messageImprint equals the digest of the signature value.' },
                            tokenSignatureValid: { type: ['boolean', 'null'], description: "The token's own CMS signature verifies against the TSA certificate it carries (null when it could not be evaluated). Required for B-T." },
                            tsaSubject: { type: ['string', 'null'] },
                        },
                    },
                    revocation: {
                        type: 'object',
                        additionalProperties: false,
                        description: 'ltv only. Signer revocation status read from embedded /DSS material; responder signatures are not verified.',
                        required: ['source', 'status'],
                        properties: {
                            source: { type: 'string', enum: ['ocsp', 'crl', 'none'] },
                            status: { type: 'string', enum: ['good', 'revoked', 'unknown', 'not-evaluated'] },
                        },
                    },
                    ltvLevel: {
                        type: 'string',
                        enum: ['B-B', 'B-T', 'B-LT', 'B-LTA'],
                        description: 'ltv only. PAdES baseline level reached by this signature.',
                    },
                },
            },
        },
        dss: {
            ...DSS_OUTPUT_SCHEMA,
            type: ['object', 'null'],
            description: 'ltv only. Document Security Store summary, or null when the catalog has no /DSS.',
        },
        ltvLevel: {
            type: 'string',
            enum: ['B-B', 'B-T', 'B-LT', 'B-LTA'],
            description: "ltv only. Minimum level across non-timestamp signatures ('B-B' when there are none).",
        },
        caveats: {
            type: 'array',
            items: { type: 'string' },
            description: 'ltv only. Fixed statements about what the LTV evaluation does not cover.',
        },
    },
} as const;

const InputSchema = z.strictObject({
    pdfBase64: z.string().min(4),
    password: PasswordSchema.optional(),
    trustedRootsDerBase64: z.array(z.string().min(4)).max(16).optional(),
    ltv: z.boolean().default(false),
    verbosity: z.enum(['summary', 'full']).optional(),
    fields: z.array(z.string().min(1)).max(16).optional(),
});

export type ChainTrust = 'trusted' | 'self-signed' | 'unverified' | 'unknown';
export type LtvLevel = 'B-B' | 'B-T' | 'B-LT' | 'B-LTA';

export interface TimestampInfo {
    readonly present: boolean;
    readonly genTime: string | null;
    /** TSTInfo messageImprint equals the digest of the signature value. */
    readonly imprintVerified: boolean | null;
    /** The token's own CMS signature verifies against the embedded TSA certificate (null = not evaluable). */
    readonly tokenSignatureValid: boolean | null;
    readonly tsaSubject: string | null;
}

export interface RevocationInfo {
    readonly source: 'ocsp' | 'crl' | 'none';
    readonly status: 'good' | 'revoked' | 'unknown' | 'not-evaluated';
}

export interface VerifyResult {
    readonly fieldName: string | null;
    readonly subFilter: string | null;
    /** Present (true) only for /DocTimeStamp entries. */
    readonly isDocTimestamp?: true;
    readonly valid: boolean;
    readonly integrity: boolean;
    readonly algorithm: CmsAlgorithm | null;
    readonly signerSubject: string | null;
    readonly signingTime: string | null;
    readonly reason: string | null;
    readonly location: string | null;
    readonly chainTrust: ChainTrust;
    readonly errors: readonly string[];
    /** ltv only (non-timestamp signatures). */
    readonly profile?: 'pkcs7' | 'pades';
    readonly timestamp?: TimestampInfo | null;
    readonly revocation?: RevocationInfo;
    readonly ltvLevel?: LtvLevel;
}

export interface VerifyPdfResult {
    readonly signatureCount: number;
    readonly allValid: boolean;
    readonly summary: string;
    readonly signatures: readonly VerifyResult[];
    /** ltv only. */
    readonly dss?: DssSummary | null;
    readonly ltvLevel?: LtvLevel;
    readonly caveats?: readonly string[];
}

const LTV_CAVEATS: readonly string[] = [
    'revocation status is read from embedded /DSS material only (OCSP matched by serial, CRL by issuer + serial); responder and CRL signatures are not verified, and chain validity at signing time is not evaluated',
    "timestamp tokens are checked for imprint consistency and for their own CMS signature against the TSA certificate they carry; TSA certificate trust is not evaluated unless trustedRootsDerBase64 includes its root",
    'ltvLevel is a structural classification (verified timestamp, /VRI entry, relevant revocation material, covering document timestamp) — not a full ETSI EN 319 102-1 validation',
];

const LTV_ORDER: readonly LtvLevel[] = ['B-B', 'B-T', 'B-LT', 'B-LTA'];

/** OID content bytes of the SHA-2 digest identifiers (2.16.840.1.101.3.4.2.{1,2,3}). */
const OID_BYTES_SHA256 = Uint8Array.of(0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01);
const OID_BYTES_SHA384 = Uint8Array.of(0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x02);
const OID_BYTES_SHA512 = Uint8Array.of(0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x03);

function decodeBase64(value: string, field: string): Uint8Array {
    return field === 'pdfBase64' ? decodePdfBase64(value, field) : decodeDerBase64(value, field, CERT_REMEDY);
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

function assertByteRange(pdf: Uint8Array, byteRange: readonly [number, number, number, number]): void {
    const [a, b, c, d] = byteRange;
    if (a + b > pdf.length || c + d > pdf.length) {
        throw new ToolError('VERIFY_FAILED', 'ByteRange exceeds PDF length');
    }
}

function digestCoveredBytes(pdf: Uint8Array, byteRange: readonly [number, number, number, number], digest: CmsDigest = 'sha256'): Uint8Array {
    assertByteRange(pdf, byteRange);
    const [a, b, c, d] = byteRange;
    const hash = createHash(digest);
    hash.update(pdf.subarray(a, a + b));
    hash.update(pdf.subarray(c, c + d));
    return new Uint8Array(hash.digest());
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

/** Map a TSTInfo hashAlgorithm OID to a Node digest name (SHA-256 fallback). */
function digestFromOidBytes(oid: Uint8Array): CmsDigest {
    if (bytesEqual(oid, OID_BYTES_SHA384)) return 'sha384';
    if (bytesEqual(oid, OID_BYTES_SHA512)) return 'sha512';
    if (bytesEqual(oid, OID_BYTES_SHA256)) return 'sha256';
    /* v8 ignore next */
    return 'sha256';
}

function bigIntFromBytes(bytes: Uint8Array): bigint {
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    return n;
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function safeSubjectCN(cert: X509Certificate): string | null {
    return cert.subject.cn ?? cert.subject.o ?? null;
}

function signedBy(cert: X509Certificate, issuer: X509Certificate): boolean {
    try {
        return verifyCertSignature(cert, issuer);
    } catch {
        return false;
    }
}

/**
 * Chain trust: the signer must be issued (directly, or through one or more
 * intermediates carried in the CMS `certificates` field) by one of the
 * supplied roots. Validity periods and revocation are not evaluated here.
 */
function decideChainTrust(
    cert: X509Certificate,
    trustedRoots: readonly X509Certificate[],
    intermediatesDer: readonly Uint8Array[] = [],
): { trust: ChainTrust; error: string | null } {
    if (trustedRoots.length > 0) {
        const intermediates: X509Certificate[] = [];
        for (const der of intermediatesDer) {
            try {
                const c = parseCertificate(der);
                if (!bytesEqual(c.raw, cert.raw)) intermediates.push(c);
            } catch {
                // ignore unparsable extra certificates
            }
        }
        // Breadth-first walk from the signer up through the carried intermediates (bounded).
        let frontier: X509Certificate[] = [cert];
        const seen = new Set<X509Certificate>([cert]);
        for (let depth = 0; depth <= intermediates.length && frontier.length > 0; depth++) {
            for (const node of frontier) {
                if (trustedRoots.some((root) => signedBy(node, root))) {
                    return { trust: 'trusted', error: null };
                }
            }
            const next: X509Certificate[] = [];
            for (const node of frontier) {
                for (const inter of intermediates) {
                    if (!seen.has(inter) && signedBy(node, inter)) {
                        seen.add(inter);
                        next.push(inter);
                    }
                }
            }
            frontier = next;
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
    if (algorithm !== 'ecdsa-sha256') {
        try {
            const pubKey = parseRsaPublicKey(signerCert.publicKeyBytes);
            const digest: CmsDigest = algorithm === 'rsa-sha384' ? 'sha384' : algorithm === 'rsa-sha512' ? 'sha512' : 'sha256';
            return { ok: rsaVerifyHash(signedDataHash, signatureValue, pubKey, digest), error: null };
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


// ── Per-widget verification ───────────────────────────────────────────

/** Shared skeleton for every VerifyResult of a widget (field metadata + flags). */
function baseResult(
    widget: SignatureWidget,
    overrides: Partial<VerifyResult> & { readonly errors: readonly string[] },
): VerifyResult {
    return {
        fieldName: widget.fieldName,
        subFilter: widget.subFilter,
        ...(widget.isDocTimestamp ? { isDocTimestamp: true as const } : {}),
        valid: false,
        integrity: false,
        algorithm: null,
        signerSubject: null,
        signingTime: widget.signingTimeRaw,
        reason: widget.reason,
        location: widget.location,
        chainTrust: 'unknown',
        ...overrides,
    };
}

/** Internal per-widget outcome: the public result plus what the LTV pass needs. */
interface WidgetVerification {
    readonly widget: SignatureWidget;
    readonly result: VerifyResult;
    readonly cms: ParsedCms | null;
    readonly signerCert: X509Certificate | null;
    /** End offset of the revision this signature covers (`ByteRange[2] + ByteRange[3]`). */
    readonly revisionEnd: number;
}

function revisionEndOf(widget: SignatureWidget): number {
    return widget.byteRange === null ? 0 : widget.byteRange[2] + widget.byteRange[3];
}

/**
 * Verify the CMS SignedData of an RFC 3161 token against the TSA certificate it
 * embeds: `messageDigest` must equal the digest of the TSTInfo (eContent) and the
 * signature value must verify over the re-encoded signed attributes.
 * `ok: null` means the check could not be performed (no embedded TSA certificate
 * or an unsupported token structure) — the imprint check stands on its own.
 */
function verifyTokenSignature(tokenDer: Uint8Array): {
    readonly ok: boolean | null;
    readonly error: string | null;
    readonly tsaCert: X509Certificate | null;
    readonly certificatesDer: readonly Uint8Array[];
} {
    let cms: ParsedCms;
    let eContent: Uint8Array | undefined;
    try {
        cms = parseCmsSignedData(tokenDer);
        eContent = parseCmsStructure(tokenDer).eContent;
    } catch (err) {
        return { ok: null, error: `timestamp token signature not evaluated: ${errorMessage(err)}`, tsaCert: null, certificatesDer: [] };
    }
    let tsaCert: X509Certificate;
    try {
        tsaCert = parseCertificate(cms.signerCertDer);
        /* v8 ignore next 3 */
    } catch (err) {
        return { ok: null, error: `timestamp token signature not evaluated: TSA cert parse failed: ${errorMessage(err)}`, tsaCert: null, certificatesDer: [] };
    }
    const certificatesDer = cms.certificatesDer;
    /* v8 ignore next 3 */
    if (eContent === undefined || cms.signedAttrsValueDer === null || cms.messageDigest === null) {
        return { ok: false, error: 'timestamp token lacks TSTInfo content or signed attributes', tsaCert, certificatesDer };
    }
    if (!constantTimeEqual(cms.messageDigest, hashBytes(cms.digestAlgorithm, eContent))) {
        return { ok: false, error: 'timestamp token messageDigest does not match its TSTInfo', tsaCert, certificatesDer };
    }
    const attrsHash = hashBytes(cms.digestAlgorithm, reencodeSignedAttrsAsSet(cms.signedAttrsValueDer));
    const r = verifySignatureValue(cms.algorithm, tsaCert, attrsHash, cms.signatureValue);
    /* v8 ignore next */
    if (r.error !== null) return { ok: false, error: r.error, tsaCert, certificatesDer };
    return { ok: r.ok, error: r.ok ? null : 'timestamp token signature value does not match signedAttrs hash', tsaCert, certificatesDer };
}

/**
 * A `/DocTimeStamp` widget carries an RFC 3161 TimeStampToken, not a CMS
 * signature with a `messageDigest` attribute: its TSTInfo `messageImprint` is
 * the digest of the ByteRange, computed with the token's own hash algorithm.
 */
function verifyDocTimestamp(
    widget: SignatureWidget,
    pdf: Uint8Array,
    trustedRoots: readonly X509Certificate[],
): WidgetVerification {
    const revisionEnd = revisionEndOf(widget);
    const errors: string[] = [];
    if (widget.byteRange === null || widget.contentsRaw === null) {
        return {
            widget,
            cms: null,
            signerCert: null,
            revisionEnd,
            result: baseResult(widget, { errors: ['signature widget has no /V dict or /Contents/ByteRange'] }),
        };
    }
    let tst: TstInfo;
    try {
        assertByteRange(pdf, widget.byteRange);
        tst = parseTimestampToken(widget.contentsBytes);
    } catch (err) {
        errors.push(errorMessage(err));
        return { widget, cms: null, signerCert: null, revisionEnd, result: baseResult(widget, { errors }) };
    }
    const digest = digestFromOidBytes(tst.hashAlgorithmOid);
    const pdfDigest = digestCoveredBytes(pdf, widget.byteRange, digest);
    const integrity = verifyTimestampImprint(tst, pdfDigest);
    if (!integrity) errors.push('timestamp messageImprint does not match recomputed PDF hash');

    const token = verifyTokenSignature(widget.contentsBytes);
    if (token.error !== null) errors.push(token.error);
    let chainTrust: ChainTrust = 'unknown';
    if (token.tsaCert !== null) {
        const chain = decideChainTrust(token.tsaCert, trustedRoots, token.certificatesDer);
        chainTrust = chain.trust;
        if (chain.error !== null) errors.push(chain.error);
    }
    const trustOk = chainTrust === 'trusted' || chainTrust === 'self-signed' || trustedRoots.length === 0;
    const valid = integrity && token.ok === true && trustOk;

    return {
        widget,
        cms: null,
        signerCert: token.tsaCert,
        revisionEnd,
        result: baseResult(widget, {
            valid,
            integrity,
            signerSubject: token.tsaCert === null ? null : safeSubjectCN(token.tsaCert),
            signingTime: tst.genTime.toISOString(),
            chainTrust,
            errors,
        }),
    };
}

function verifyOneWidget(
    widget: SignatureWidget,
    pdf: Uint8Array,
    trustedRoots: readonly X509Certificate[],
): WidgetVerification {
    if (widget.isDocTimestamp) return verifyDocTimestamp(widget, pdf, trustedRoots);

    const revisionEnd = revisionEndOf(widget);
    const errors: string[] = [];
    const fail = (cms: ParsedCms | null, signerCert: X509Certificate | null, overrides: Partial<VerifyResult>): WidgetVerification => ({
        widget,
        cms,
        signerCert,
        revisionEnd,
        result: baseResult(widget, { ...overrides, errors }),
    });

    if (widget.byteRange === null || widget.contentsRaw === null) {
        errors.push('signature widget has no /V dict or /Contents/ByteRange');
        return fail(null, null, {});
    }

    // 1) validate the ByteRange (the digest itself is computed once the CMS
    //    names its digest algorithm — SHA-256/384/512 agility since pdfnative 1.7)
    try {
        assertByteRange(pdf, widget.byteRange);
    } catch (err) {
        errors.push(errorMessage(err));
        return fail(null, null, {});
    }

    // 2) parse CMS
    let cms: ParsedCms;
    try {
        cms = parseCmsSignedData(widget.contentsBytes);
    } catch (err) {
        errors.push(errorMessage(err));
        return fail(null, null, {});
    }

    // 3) integrity: messageDigest matches PDF digest
    const pdfDigest = digestCoveredBytes(pdf, widget.byteRange, cms.digestAlgorithm);
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
        errors.push(`signer cert parse failed: ${errorMessage(err)}`);
        return fail(cms, null, { integrity, algorithm: cms.algorithm });
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
    const chain = decideChainTrust(signerCert, trustedRoots, cms.certificatesDer);
    if (chain.error !== null) errors.push(chain.error);

    const valid = integrity && sigOk && (chain.trust === 'trusted' || chain.trust === 'self-signed' || trustedRoots.length === 0);

    return {
        widget,
        cms,
        signerCert,
        revisionEnd,
        result: baseResult(widget, {
            valid,
            integrity,
            algorithm: cms.algorithm,
            signerSubject,
            chainTrust: chain.trust,
            errors,
        }),
    };
}

// ── LTV (opt-in) ──────────────────────────────────────────────────────

/** Evaluate the PAdES signature timestamp (id-aa-signatureTimeStampToken) of a CMS. */
function evaluateSignatureTimestamp(cms: ParsedCms): TimestampInfo {
    if (cms.signatureTimestampTokenDer === null) {
        return { present: false, genTime: null, imprintVerified: null, tokenSignatureValid: null, tsaSubject: null };
    }
    let tst: TstInfo;
    try {
        tst = parseTimestampToken(cms.signatureTimestampTokenDer);
    } catch {
        return { present: true, genTime: null, imprintVerified: false, tokenSignatureValid: null, tsaSubject: null };
    }
    // RFC 3161 / ETSI EN 319 122-1: the imprint is the digest of the SignerInfo signature value.
    const imprint = hashBytes(digestFromOidBytes(tst.hashAlgorithmOid), cms.signatureValue);
    const imprintVerified = verifyTimestampImprint(tst, imprint);
    // The token lives in the UNSIGNED attributes, so it is not covered by the
    // signer's signature: its own CMS signature must verify, otherwise anyone
    // could replace or backdate it.
    const token = verifyTokenSignature(cms.signatureTimestampTokenDer);
    const tsaSubject = token.tsaCert !== null ? safeSubjectCN(token.tsaCert) : null;
    return { present: true, genTime: tst.genTime.toISOString(), imprintVerified, tokenSignatureValid: token.ok, tsaSubject };
}

/**
 * Serial number of the CertID in the first SingleResponse of an OCSPResponse
 * (pdfnative's `parseOcspResponse` surfaces the status of that response but
 * not which certificate it is about).
 */
function ocspFirstSerial(der: Uint8Array): bigint | null {
    try {
        const root = derDecode(der); // OCSPResponse
        const octet = root.children[1]?.children[0]?.children[1]; // [0] → ResponseBytes → response OCTET STRING
        if (octet === undefined || octet.tag !== 0x04) return null;
        const basic = derDecode(octet.value); // BasicOCSPResponse
        const tbs = basic.children[0];
        const responses = tbs?.children.find((c) => c.tag === 0x30);
        const serialNode = responses?.children[0]?.children[0]?.children[3];
        if (serialNode === undefined || serialNode.tag !== 0x02) return null;
        return bigIntFromBytes(serialNode.value);
        /* v8 ignore next 3 */
    } catch {
        return null;
    }
}

/** Signer revocation status from embedded /DSS material only (responder signatures are not verified). */
function evaluateRevocation(signerCert: X509Certificate, dss: DssMaterial | null): RevocationInfo {
    if (dss === null) return { source: 'none', status: 'not-evaluated' };
    const serial = signerCert.serialNumber;
    for (const der of dss.ocspDer) {
        let parsed;
        try {
            parsed = parseOcspResponse(der);
            /* v8 ignore next 3 */
        } catch {
            continue;
        }
        if (parsed.responseStatus !== 0) continue;
        if (ocspFirstSerial(der) !== serial) continue;
        return { source: 'ocsp', status: parsed.certStatus ?? 'unknown' };
    }
    let crlGood = false;
    for (const der of dss.crlDer) {
        let crl;
        try {
            crl = parseCrl(der);
            /* v8 ignore next 3 */
        } catch {
            continue;
        }
        // Only a CRL issued by the signer's CA can speak about the signer's serial.
        if (!bytesEqual(crl.issuerRaw, signerCert.issuer.raw)) continue;
        if (isSerialRevoked(crl, serial)) return { source: 'crl', status: 'revoked' };
        crlGood = true;
    }
    if (crlGood) return { source: 'crl', status: 'good' };
    return { source: 'none', status: 'unknown' };
}

function minLevel(levels: readonly LtvLevel[]): LtvLevel {
    if (levels.length === 0) return 'B-B';
    let min = LTV_ORDER.length - 1;
    for (const level of levels) min = Math.min(min, LTV_ORDER.indexOf(level));
    return LTV_ORDER[min]!;
}

/** Decorate every non-timestamp signature with its LTV view and compute the document level. */
function applyLtv(
    verifications: readonly WidgetVerification[],
    dss: DssMaterial | null,
): { signatures: VerifyResult[]; ltvLevel: LtvLevel } {
    const docTimestamps = verifications.filter((v) => v.widget.isDocTimestamp);
    const levels: LtvLevel[] = [];
    const signatures = verifications.map((v): VerifyResult => {
        if (v.widget.isDocTimestamp) return v.result;
        if (v.cms === null || v.signerCert === null) {
            levels.push('B-B');
            return {
                ...v.result,
                profile: 'pkcs7',
                timestamp: null,
                revocation: { source: 'none', status: 'not-evaluated' },
                ltvLevel: 'B-B',
            };
        }
        const timestamp = evaluateSignatureTimestamp(v.cms);
        const revocation = evaluateRevocation(v.signerCert, dss);
        const vriKey = vriKeyForContents(v.widget.contentsBytes);
        const hasT = timestamp.present && timestamp.imprintVerified === true && timestamp.tokenSignatureValid === true;
        // B-LT: a verified timestamp, a /VRI entry for this very signature, and
        // revocation material that actually speaks about the signer (good or
        // revoked) — unrelated or missing material does not count.
        const hasLT =
            hasT &&
            dss !== null &&
            dss.vriKeys.includes(vriKey) &&
            (revocation.status === 'good' || revocation.status === 'revoked');
        const hasLTA = hasLT && docTimestamps.some((t) => t.result.valid && t.revisionEnd > v.revisionEnd);
        const ltvLevel: LtvLevel = hasLTA ? 'B-LTA' : hasLT ? 'B-LT' : hasT ? 'B-T' : 'B-B';
        levels.push(ltvLevel);
        const revoked = revocation.status === 'revoked';
        return {
            ...v.result,
            ...(revoked
                ? {
                      valid: false,
                      errors: [...v.result.errors, 'signer certificate is reported REVOKED by the embedded revocation material'],
                  }
                : {}),
            profile: v.cms.hasEssSigningCertV2 ? 'pades' : 'pkcs7',
            timestamp,
            revocation,
            ltvLevel,
        };
    });
    return { signatures, ltvLevel: minLevel(levels) };
}

// ── Handler ───────────────────────────────────────────────────────────

export async function verifyPdf(rawInput: unknown): Promise<VerifyPdfResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { pdfBase64, password, trustedRootsDerBase64, ltv } = parsed.data;

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
                    `trustedRootsDerBase64[${i}] is not a valid X.509 certificate: ${errorMessage(err)}`,
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
    const verifications = widgets.map((w) => verifyOneWidget(w, pdf, trustedRoots));
    let signatures: VerifyResult[] = verifications.map((v) => v.result);
    const verdict = (sigs: readonly VerifyResult[]): { allValid: boolean; summary: string } => {
        const allValid = sigs.length > 0 && sigs.every((s) => s.valid);
        const summary =
            sigs.length === 0
                ? 'No signatures found.'
                : allValid
                    ? `All ${sigs.length} signature(s) valid.`
                    : `${sigs.filter((s) => s.valid).length}/${sigs.length} signature(s) valid.`;
        return { allValid, summary };
    };

    if (!ltv) {
        const { allValid, summary } = verdict(signatures);
        return { signatureCount: signatures.length, allValid, summary, signatures };
    }

    const dss = readDssMaterial(reader);
    const ltvView = applyLtv(verifications, dss);
    signatures = ltvView.signatures;
    const { allValid, summary } = verdict(signatures);
    const dssSummary: DssSummary | null =
        dss === null ? null : { certs: dss.certs, ocsps: dss.ocsps, crls: dss.crls, vriKeys: dss.vriKeys };
    return {
        signatureCount: signatures.length,
        allValid,
        summary,
        signatures,
        dss: dssSummary,
        ltvLevel: ltvView.ltvLevel,
        caveats: [...LTV_CAVEATS],
    };
}
