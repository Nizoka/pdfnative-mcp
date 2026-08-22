/**
 * Constant-time signature provider backed by Node's native `node:crypto`.
 *
 * pdfnative v1.4.0 lets callers supply a {@link CryptoProvider} (per-call, via
 * `PdfSignOptions.provider`) that produces the CMS signature value instead of
 * the bundled pure-JS RSA/ECDSA math. Routing through `node:crypto` gives a
 * native, constant-time signer (no key-dependent timing side channel) for the
 * `sign_pdf` tool.
 *
 * The provider is built **per request** and passed through the per-call option
 * — the global `setCryptoProvider()` is intentionally NOT used, so the server
 * stays stateless and concurrent signing requests never share key material.
 *
 * When a key cannot be imported by `node:crypto` (e.g. a bare P-256 scalar with
 * no public point), {@link buildNodeCryptoProvider} returns `null` and the
 * caller falls back to pdfnative's pure-JS signing path.
 */
import { createPrivateKey, sign as nodeSign, type KeyObject } from 'node:crypto';
import type { CryptoProvider, SignatureAlgorithm } from 'pdfnative';

/** Describes the private key material to import into `node:crypto`. */
export type NodeCryptoKeySpec =
    | { readonly algorithm: 'rsa-sha256' | 'rsa-sha384' | 'rsa-sha512'; readonly der: Uint8Array; readonly keyType: 'pkcs1' | 'pkcs8' }
    | { readonly algorithm: 'ecdsa-sha256'; readonly der: Uint8Array; readonly keyType: 'sec1' | 'pkcs8' };

/** Node digest name implied by a CMS signature algorithm (pdfnative ≥ 1.7 digest agility). */
export function digestForAlgorithm(algorithm: SignatureAlgorithm): 'sha256' | 'sha384' | 'sha512' {
    switch (algorithm) {
        case 'rsa-sha384':
            return 'sha384';
        case 'rsa-sha512':
            return 'sha512';
        default:
            return 'sha256';
    }
}

function importKey(der: Uint8Array, keyType: 'pkcs1' | 'sec1' | 'pkcs8'): KeyObject | null {
    try {
        return createPrivateKey({ key: Buffer.from(der), format: 'der', type: keyType });
    } catch {
        return null;
    }
}

/**
 * Builds a {@link CryptoProvider} that signs via `node:crypto`, or returns
 * `null` when the supplied key cannot be imported (so the caller can fall back
 * to the pure-JS path). For ECDSA the SEC1 and PKCS#8 encodings are both tried.
 */
export function buildNodeCryptoProvider(spec: NodeCryptoKeySpec): CryptoProvider | null {
    let key: KeyObject | null;
    if (spec.algorithm !== 'ecdsa-sha256') {
        key = importKey(spec.der, spec.keyType);
    } else {
        // Accept either SEC1 (RFC 5915) or PKCS#8 EC keys regardless of the hint.
        key = importKey(spec.der, 'sec1') ?? importKey(spec.der, 'pkcs8');
    }
    if (key === null) return null;
    const boundKey = key;

    return {
        sign(tbs: Uint8Array, algorithm: SignatureAlgorithm): Uint8Array {
            if (algorithm !== 'ecdsa-sha256') {
                // RSASSA-PKCS1-v1_5 over SHA-256/384/512(tbs) — the digest MUST match the
                // algorithm suffix, otherwise the CMS digestAlgorithms set lies about the
                // signature and every verifier rejects it.
                return new Uint8Array(nodeSign(digestForAlgorithm(algorithm), tbs, boundKey));
            }
            // ECDSA P-256 over SHA-256(tbs), DER-encoded (CMS requirement).
            return new Uint8Array(nodeSign('sha256', tbs, { key: boundKey, dsaEncoding: 'der' }));
        },
    };
}
