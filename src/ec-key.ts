/**
 * ECDSA private-key DER decoder (P-256 only).
 *
 * Supports SEC1 (RFC 5915) and PKCS#8 (RFC 5208) DER encodings via Node's
 * built-in `crypto` module. Returns the 32-byte private scalar `d` as a
 * bigint, ready to feed into pdfnative's `signPdfBytes({ ecKey: { d } })`.
 *
 * Why Node `crypto` and not a hand-rolled ASN.1 walker?
 *   - pdfnative 1.2 does not export `parseEcPrivateKey`.
 *   - Node's `createPrivateKey` already parses both formats correctly.
 *   - JWK export reliably returns `d` base64url-encoded.
 *   - This keeps the v1.0.0 surface narrow and security-audit-friendly:
 *     no custom DER parsing in our code path.
 */
import { createPrivateKey } from 'node:crypto';
import { ToolError } from './errors.js';

const SUPPORTED_CURVE = 'P-256';
const PRIVATE_SCALAR_BYTES = 32;

/** Decode base64 / base64url to a Uint8Array. */
function base64urlToBytes(b64url: string): Uint8Array {
    const padded = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    return new Uint8Array(Buffer.from(padded + '='.repeat(padLen), 'base64'));
}

/**
 * Parse an ECDSA P-256 private key from DER bytes (SEC1 or PKCS#8) and
 * return the private scalar `d` as a bigint.
 *
 * @throws {ToolError} with code `EC_KEY_PARSE_FAILED` for any decode error.
 * @throws {ToolError} with code `EC_CURVE_UNSUPPORTED` when the embedded
 *         curve is not P-256.
 */
export function parseEcPrivateKeyDer(der: Uint8Array): bigint {
    let keyObject: ReturnType<typeof createPrivateKey>;
    try {
        // Try SEC1 first (more compact, matches `openssl ecparam -genkey`).
        try {
            keyObject = createPrivateKey({ key: Buffer.from(der), format: 'der', type: 'sec1' });
        } catch {
            keyObject = createPrivateKey({ key: Buffer.from(der), format: 'der', type: 'pkcs8' });
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolError('EC_KEY_PARSE_FAILED', `Failed to parse ECDSA private key DER (SEC1 / PKCS#8): ${message}`);
    }

    const jwk = keyObject.export({ format: 'jwk' }) as { kty?: string; crv?: string; d?: string };
    if (jwk.kty !== 'EC') {
        throw new ToolError('EC_KEY_PARSE_FAILED', `Expected EC private key, got kty=${String(jwk.kty)}.`);
    }
    if (jwk.crv !== SUPPORTED_CURVE) {
        throw new ToolError('EC_CURVE_UNSUPPORTED', `Only P-256 ECDSA is supported (got crv=${String(jwk.crv)}).`);
    }
    if (typeof jwk.d !== 'string' || jwk.d.length === 0) {
        throw new ToolError('EC_KEY_PARSE_FAILED', 'EC JWK is missing the private scalar `d`.');
    }

    const scalarBytes = base64urlToBytes(jwk.d);
    // Left-pad short scalars (leading zeros are sometimes stripped by JWK encoders).
    if (scalarBytes.length > PRIVATE_SCALAR_BYTES) {
        throw new ToolError('EC_KEY_PARSE_FAILED', `Private scalar is ${scalarBytes.length} bytes; expected ${PRIVATE_SCALAR_BYTES} (P-256).`);
    }
    let hex = Buffer.from(scalarBytes).toString('hex');
    if (hex.length < PRIVATE_SCALAR_BYTES * 2) {
        hex = hex.padStart(PRIVATE_SCALAR_BYTES * 2, '0');
    }
    return BigInt(`0x${hex}`);
}
