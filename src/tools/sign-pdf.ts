/**
 * Tool: sign_pdf
 *
 * Applies a CMS / PAdES digital signature to a PDF. Supports RSA with
 * SHA-256 / SHA-384 / SHA-512 and ECDSA P-256 with SHA-256.
 *
 * v1.0.0 ergonomics:
 *   - `autoInjectPlaceholder` (default `true`) — when the input PDF has no
 *     `/FT /Sig` widget, the tool transparently calls pdfnative's
 *     `addSignaturePlaceholder()` first so the caller can sign any PDF in a
 *     single call.
 *   - `ecPrivateKeyDerBase64` — accept SEC1 or PKCS#8 ECDSA P-256 private
 *     keys in addition to the raw 32-byte scalar (`ecPrivateScalarHex`).
 *
 * v1.3.0 security:
 *   - Constant-time signing via `node:crypto`. RSA (PKCS#1) and ECDSA P-256
 *     (SEC1 / PKCS#8) keys are routed through a native, constant-time
 *     {@link buildNodeCryptoProvider}; the pure-JS RSA/ECDSA math is used only
 *     as a fallback (e.g. a bare P-256 scalar without its public point).
 *
 * v1.6.0 (pdfnative 1.7):
 *   - Signer metadata (`signerName`, `reason`, `location`, `contactInfo`,
 *     `signingTime`) is baked into the `/Sig` dictionary **at placeholder
 *     time** via `addSignaturePlaceholder({ metadata })`. Before 1.7 the
 *     engine silently dropped these values, so they never reached the PDF;
 *     they now do whenever this tool injects the placeholder. A placeholder
 *     prepared earlier (`prepare_signature_placeholder`) keeps ITS metadata.
 *   - `profile: 'pades'` — ETSI EN 319 142-1 baseline (ESS
 *     signing-certificate-v2, `ETSI.CAdES.detached` SubFilter, no CMS
 *     signing-time). Required for the LTV ladder (`add_ltv`, `timestamp_pdf`).
 *   - `timestamp: true` — PAdES B-T: an RFC 3161 signature timestamp from the
 *     operator-configured TSA (`PDFNATIVE_MCP_TSA_URL`). Fails fast with
 *     `TSA_NOT_CONFIGURED` otherwise; no network request is made without it.
 *   - Multiple signatures: `fieldName` selects the placeholder to sign;
 *     `allowMultiple: true` adds a new named placeholder next to existing
 *     (signed) fields instead of the 1.x single-signature short-circuit.
 *   - `certChainDerBase64` embeds intermediate certificates in the CMS so
 *     `add_ltv` can complete the chain offline.
 */
import {
    addSignaturePlaceholder,
    estimateContentsSize,
    openPdf,
    parseCertificate,
    parseRsaPrivateKey,
    signPdfBytes,
    signPdfBytesWithTimestamp,
    type AddSignaturePlaceholderOptions,
    type PdfSignOptions,
    type SigDictMetadata,
    type SignatureAlgorithm,
    type X509Certificate,
} from 'pdfnative';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';
import { CERT_REMEDY, EC_KEY_REMEDY, RSA_KEY_REMEDY, decodeDerBase64, decodePdfBase64, parseDerOrThrow } from '../base64.js';
import { parseEcPrivateKeyDer } from '../ec-key.js';
import { hasSignaturePlaceholder } from '../pdf-introspection.js';
import { buildNodeCryptoProvider } from '../crypto-provider.js';
import { requireTimestampProvider } from '../network.js';

export const SIGN_PDF_NAME = 'sign_pdf';

export const SIGN_ALGORITHM_ENUM = ['rsa-sha256', 'rsa-sha384', 'rsa-sha512', 'ecdsa-sha256'] as const;
const FIELD_NAME_PATTERN = '^[A-Za-z0-9_.\\- ]{1,127}$';

export const SIGN_PDF_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        pdfBase64: {
            type: 'string',
            description: 'Base64-encoded PDF bytes. When the PDF already contains an unsigned /Sig placeholder it is signed in place; otherwise the placeholder is auto-injected (set autoInjectPlaceholder=false to opt out).',
            minLength: 4,
        },
        algorithm: {
            type: 'string',
            enum: [...SIGN_ALGORITHM_ENUM],
            description: "Signature algorithm. 'rsa-sha384' / 'rsa-sha512' (pdfnative 1.7) upgrade the whole CMS digest chain. ECDSA only supports P-256 with SHA-256.",
        },
        certDerBase64: {
            type: 'string',
            description: 'Base64 of the signer X.509 certificate in DER form. Convert from PEM with: openssl x509 -in cert.pem -outform DER | base64 -w0',
            minLength: 4,
        },
        certChainDerBase64: {
            type: 'array',
            maxItems: 8,
            items: { type: 'string', minLength: 4 },
            description: 'Optional intermediate CA certificates (DER base64) embedded in the CMS so verifiers and add_ltv can build the chain without fetching caIssuers.',
        },
        rsaKeyPkcs1DerBase64: {
            type: 'string',
            description: 'Base64 of the RSA private key in PKCS#1 RSAPrivateKey DER (NOT PKCS#8, NOT PEM). Required for the rsa-* algorithms. Convert from PEM with: openssl rsa -in key.pem -outform DER -traditional | base64 -w0  (the -traditional flag forces PKCS#1).',
        },
        ecPrivateScalarHex: {
            type: 'string',
            description: 'Hex-encoded P-256 private scalar `d` (exactly 64 lowercase or uppercase hex chars, no 0x prefix). Mutually exclusive with ecPrivateKeyDerBase64; either is accepted for ECDSA.',
            pattern: '^[0-9a-fA-F]{64}$',
        },
        ecPrivateKeyDerBase64: {
            type: 'string',
            description: 'Base64 of an ECDSA P-256 private key in SEC1 (RFC 5915) or PKCS#8 (RFC 5208) DER form. Convert from PEM with: openssl pkey -in key.pem -outform DER | base64 -w0  Mutually exclusive with ecPrivateScalarHex.',
            minLength: 4,
        },
        autoInjectPlaceholder: {
            type: 'boolean',
            default: true,
            description: 'When true (default) and the input PDF has no /Sig widget, pdfnative.addSignaturePlaceholder is called before signing — enabling single-call signing of any PDF.',
        },
        profile: {
            type: 'string',
            enum: ['pkcs7', 'pades'],
            default: 'pkcs7',
            description: "CMS profile. 'pkcs7' (default, adbe.pkcs7.detached, legacy-compatible) or 'pades' (ETSI EN 319 142-1 baseline: ESS signing-certificate-v2 attribute, ETSI.CAdES.detached SubFilter when the placeholder is injected here). Use 'pades' when you plan to add a timestamp, add_ltv or timestamp_pdf.",
        },
        timestamp: {
            type: 'boolean',
            default: false,
            description: 'PAdES B-T: request an RFC 3161 signature timestamp from the operator-configured TSA (PDFNATIVE_MCP_TSA_URL). Fails with TSA_NOT_CONFIGURED when no TSA is configured — the server never contacts the network otherwise.',
        },
        fieldName: {
            type: 'string',
            pattern: FIELD_NAME_PATTERN,
            description: 'Name of the signature field to sign (required when several unsigned placeholders exist) and of the placeholder injected by this call.',
        },
        allowMultiple: {
            type: 'boolean',
            default: false,
            description: 'Add a NEW signature next to existing (already signed) fields instead of signing the first placeholder. Requires fieldName. Each signature is an incremental revision; earlier signatures stay valid.',
        },
        signerName: { type: 'string', maxLength: 200, description: '/Sig /Name — baked into the placeholder when this call injects it.' },
        reason: { type: 'string', maxLength: 500, description: '/Sig /Reason — baked into the placeholder when this call injects it.' },
        location: { type: 'string', maxLength: 200, description: '/Sig /Location — baked into the placeholder when this call injects it.' },
        contactInfo: { type: 'string', maxLength: 200, description: '/Sig /ContactInfo — baked into the placeholder when this call injects it.' },
        signingTime: {
            type: 'string',
            format: 'date-time',
            description: 'ISO-8601 signing instant. Written to /Sig /M only when THIS call injects the placeholder (a placeholder prepared earlier keeps its own /M) and to the CMS signing-time attribute under the pkcs7 profile. Defaults to now. Not a trusted time — use timestamp=true for that.',
        },
        outputMode: { type: 'string', enum: ['base64', 'file'], default: 'base64' },
        outputPath: { type: 'string' },
    },
    required: ['pdfBase64', 'algorithm', 'certDerBase64'],
} as const;

const InputSchema = z
    .object({
        pdfBase64: z.string().min(4),
        algorithm: z.enum(SIGN_ALGORITHM_ENUM),
        certDerBase64: z.string().min(4),
        certChainDerBase64: z.array(z.string().min(4)).max(8).optional(),
        rsaKeyPkcs1DerBase64: z.string().optional(),
        ecPrivateScalarHex: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
        ecPrivateKeyDerBase64: z.string().min(4).optional(),
        autoInjectPlaceholder: z.boolean().default(true),
        profile: z.enum(['pkcs7', 'pades']).default('pkcs7'),
        timestamp: z.boolean().default(false),
        fieldName: z.string().regex(new RegExp(FIELD_NAME_PATTERN)).optional(),
        allowMultiple: z.boolean().default(false),
        signerName: z.string().max(200).optional(),
        reason: z.string().max(500).optional(),
        location: z.string().max(200).optional(),
        contactInfo: z.string().max(200).optional(),
        signingTime: z.string().datetime({ offset: true }).optional(),
        outputMode: z.enum(['base64', 'file']).default('base64'),
        outputPath: z.string().optional(),
    })
    .superRefine((val, ctx) => {
        if (val.algorithm !== 'ecdsa-sha256' && val.rsaKeyPkcs1DerBase64 === undefined) {
            ctx.addIssue({
                code: 'custom',
                message: `rsaKeyPkcs1DerBase64 is required when algorithm=${val.algorithm}.`,
            });
        }
        if (val.algorithm === 'ecdsa-sha256') {
            const haveScalar = val.ecPrivateScalarHex !== undefined;
            const haveDer = val.ecPrivateKeyDerBase64 !== undefined;
            if (!haveScalar && !haveDer) {
                ctx.addIssue({
                    code: 'custom',
                    message: 'ecPrivateScalarHex or ecPrivateKeyDerBase64 is required when algorithm=ecdsa-sha256.',
                });
            }
            if (haveScalar && haveDer) {
                ctx.addIssue({
                    code: 'custom',
                    message: 'ecPrivateScalarHex and ecPrivateKeyDerBase64 are mutually exclusive.',
                });
            }
        }
        if (val.allowMultiple && val.fieldName === undefined) {
            ctx.addIssue({ code: 'custom', message: 'fieldName is required when allowMultiple=true.' });
        }
    });

function decodeBase64(value: string, field: string): Uint8Array {
    return decodePdfBase64(value, field);
}

function hexToBigInt(hex: string): bigint {
    return BigInt(`0x${hex}`);
}

interface PlaceholderPlan {
    readonly autoInject: boolean;
    readonly allowMultiple: boolean;
    readonly fieldName: string | undefined;
    readonly metadata: SigDictMetadata;
    readonly placeholderBytes: number;
}

/**
 * Make sure the document carries an unsigned placeholder for this signature.
 *  - no signature field at all → inject one (unless autoInject=false);
 *  - `allowMultiple` → inject a new named placeholder (idempotent per name);
 *  - otherwise keep the 1.x behaviour: an existing field is signed in place.
 */
function ensurePlaceholder(pdfBytes: Uint8Array, plan: PlaceholderPlan): Uint8Array {
    let already: boolean;
    try {
        const reader = openPdf(pdfBytes);
        already = hasSignaturePlaceholder(reader);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolError('PDF_PARSE_FAILED', `Failed to inspect PDF for existing placeholder: ${message}`);
    }
    if (already && !plan.allowMultiple) return pdfBytes;
    if (!already && !plan.autoInject) {
        throw new ToolError(
            'MISSING_PLACEHOLDER',
            "Input PDF has no /Sig placeholder and autoInjectPlaceholder=false. Either set autoInjectPlaceholder=true or call prepare_signature_placeholder first.",
        );
    }
    const options: AddSignaturePlaceholderOptions = {
        placeholderBytes: plan.placeholderBytes,
        metadata: plan.metadata,
        ...(plan.fieldName !== undefined ? { fieldName: plan.fieldName } : {}),
        ...(plan.allowMultiple ? { allowMultiple: true } : {}),
    };
    try {
        return addSignaturePlaceholder(pdfBytes, options);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolError('PLACEHOLDER_FAILED', `Failed to auto-inject signature placeholder: ${message}`);
    }
}

/** Map pdfnative's signing-time throws onto stable tool error codes. */
function mapSigningError(err: unknown): ToolError {
    if (err instanceof ToolError) return err;
    const message = err instanceof Error ? err.message : String(err);
    if (/pass options\.fieldName to select one/.test(message)) {
        return new ToolError('PLACEHOLDER_AMBIGUOUS', `Several unsigned signature placeholders are present — pass fieldName. ${message}`);
    }
    if (/no unsigned signature field named/.test(message)) {
        return new ToolError('SIGNATURE_FIELD_NOT_FOUND', message);
    }
    // Exact engine phrases (pdfnative signPdfBytesWithTimestamp / rfc3161) — kept narrow so
    // unrelated errors mentioning "timestamp" keep their own codes.
    if (/TSA rejected the request|TSA token message imprint|TSA token nonce mismatch|^RFC 3161:/.test(message)) {
        return new ToolError('TSA_REJECTED', `The timestamp authority's response was rejected: ${message}`);
    }
    return new ToolError('SIGNING_FAILED', `Failed to sign PDF: ${message}`);
}

export async function signPdf(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const input = parsed.data;

    // Fail fast before any signing work when a timestamp is requested without a TSA.
    const timestampProvider = input.timestamp ? requireTimestampProvider() : null;

    const rawPdfBytes = decodeBase64(input.pdfBase64, 'pdfBase64');
    const certDer = decodeDerBase64(input.certDerBase64, 'certDerBase64', CERT_REMEDY);
    const chainDer = (input.certChainDerBase64 ?? []).map((c, i) => decodeDerBase64(c, `certChainDerBase64[${i}]`, CERT_REMEDY));

    const signerCert = parseDerOrThrow('certDerBase64', CERT_REMEDY, () => parseCertificate(certDer));
    let certChain: X509Certificate[] | undefined;
    if (chainDer.length > 0) {
        try {
            certChain = chainDer.map((der) => parseCertificate(der));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new ToolError('VALIDATION_ERROR', `certChainDerBase64 contains an unparsable certificate: ${message}`);
        }
    }

    const signingTime = input.signingTime !== undefined ? new Date(input.signingTime) : new Date();
    const metadata: SigDictMetadata = {
        ...(input.signerName !== undefined ? { name: input.signerName } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.contactInfo !== undefined ? { contactInfo: input.contactInfo } : {}),
        signingTime,
        subFilter: input.profile === 'pades' ? 'ETSI.CAdES.detached' : 'adbe.pkcs7.detached',
    };

    const algorithm: SignatureAlgorithm = input.algorithm;
    const pdfBytes = ensurePlaceholder(rawPdfBytes, {
        autoInject: input.autoInjectPlaceholder,
        allowMultiple: input.allowMultiple,
        fieldName: input.fieldName,
        metadata,
        placeholderBytes: estimateContentsSize([certDer.length, ...chainDer.map((c) => c.length)], algorithm, { timestamp: input.timestamp }),
    });

    const baseOptions: PdfSignOptions = {
        signerCert,
        algorithm,
        profile: input.profile,
        ...(certChain !== undefined ? { certChain } : {}),
        ...(input.fieldName !== undefined ? { fieldName: input.fieldName } : {}),
        ...(input.signerName !== undefined ? { name: input.signerName } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.contactInfo !== undefined ? { contactInfo: input.contactInfo } : {}),
        signingTime,
    };

    let options: PdfSignOptions;
    if (algorithm !== 'ecdsa-sha256') {
        const rsaDer = decodeDerBase64(input.rsaKeyPkcs1DerBase64 as string, 'rsaKeyPkcs1DerBase64', RSA_KEY_REMEDY);
        // Prefer the native constant-time signer; fall back to pdfnative's pure-JS path.
        const provider = buildNodeCryptoProvider({ algorithm, der: rsaDer, keyType: 'pkcs1' });
        if (provider !== null) {
            options = { ...baseOptions, provider };
        } else {
            const rsaKey = parseDerOrThrow('rsaKeyPkcs1DerBase64', RSA_KEY_REMEDY, () => parseRsaPrivateKey(rsaDer));
            options = { ...baseOptions, rsaKey };
        }
    } else if (input.ecPrivateKeyDerBase64 !== undefined) {
        const ecDer = decodeDerBase64(input.ecPrivateKeyDerBase64, 'ecPrivateKeyDerBase64', EC_KEY_REMEDY);
        const provider = buildNodeCryptoProvider({ algorithm: 'ecdsa-sha256', der: ecDer, keyType: 'sec1' });
        if (provider !== null) {
            options = { ...baseOptions, provider };
        } else {
            const d = parseDerOrThrow('ecPrivateKeyDerBase64', EC_KEY_REMEDY, () => parseEcPrivateKeyDer(ecDer));
            options = { ...baseOptions, ecKey: { d } };
        }
    } else {
        // Raw P-256 scalar: node:crypto cannot import it without the public point,
        // so use pdfnative's pure-JS ECDSA path.
        const d = hexToBigInt(input.ecPrivateScalarHex as string);
        options = { ...baseOptions, ecKey: { d } };
    }

    let signedBytes: Uint8Array;
    try {
        if (timestampProvider !== null) {
            // Random nonce: pdfnative verifies the TSA echoes it (replay protection).
            const timestampNonce = BigInt(`0x${randomBytes(8).toString('hex')}`);
            signedBytes = await signPdfBytesWithTimestamp(pdfBytes, { ...options, timestampProvider, timestampNonce });
        } else {
            signedBytes = signPdfBytes(pdfBytes, options);
        }
    } catch (err) {
        throw mapSigningError(err);
    }

    return emitPdf(signedBytes, {
        mode: input.outputMode,
        ...(input.outputPath !== undefined ? { outputPath: input.outputPath } : {}),
    });
}
