/**
 * Tool: sign_pdf
 *
 * Applies a PAdES-style digital signature to a PDF. Supports RSA-SHA256 and
 * ECDSA-SHA256 (P-256).
 *
 * v1.0.0 ergonomics:
 *   - `autoInjectPlaceholder` (default `true`) — when the input PDF has no
 *     `/FT /Sig` widget, the tool transparently calls pdfnative's
 *     `addSignaturePlaceholder()` first so the caller can sign any PDF in a
 *     single call. Closes the v0.4 roadmap "sign any PDF in one call" item.
 *   - `ecPrivateKeyDerBase64` — accept SEC1 or PKCS#8 ECDSA P-256 private
 *     keys in addition to the raw 32-byte scalar (`ecPrivateScalarHex`).
 *     Closes the v0.4 deferral.
 *   - Signer metadata (`signerName`, `reason`, `location`, `contactInfo`,
 *     `signingTime`) is written into the `/Sig` dictionary at signing time
 *     (this matches PAdES Baseline behaviour and pdfnative v1.2 semantics).
 */
import {
    addSignaturePlaceholder,
    openPdf,
    parseCertificate,
    parseRsaPrivateKey,
    signPdfBytes,
    type PdfSignOptions,
} from 'pdfnative';
import { z } from 'zod';
import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';
import { parseEcPrivateKeyDer } from '../ec-key.js';
import { hasSignaturePlaceholder } from '../pdf-introspection.js';

export const SIGN_PDF_NAME = 'sign_pdf';

export const SIGN_PDF_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        pdfBase64: {
            type: 'string',
            description: 'Base64-encoded PDF bytes. When the PDF already contains a /Sig placeholder it is signed in place; otherwise the placeholder is auto-injected (set autoInjectPlaceholder=false to opt out).',
            minLength: 4,
        },
        algorithm: {
            type: 'string',
            enum: ['rsa-sha256', 'ecdsa-sha256'],
            description: 'Signature algorithm. ECDSA only supports P-256 in v1.0.0.',
        },
        certDerBase64: {
            type: 'string',
            description: 'Base64 of the signer X.509 certificate in DER form.',
            minLength: 4,
        },
        rsaKeyPkcs1DerBase64: {
            type: 'string',
            description: 'Base64 of the RSA private key in PKCS#1 RSAPrivateKey DER. Required when algorithm=rsa-sha256.',
        },
        ecPrivateScalarHex: {
            type: 'string',
            description: 'Hex-encoded P-256 private scalar `d` (64 hex chars). Mutually exclusive with ecPrivateKeyDerBase64; either is accepted for ECDSA.',
            pattern: '^[0-9a-fA-F]{64}$',
        },
        ecPrivateKeyDerBase64: {
            type: 'string',
            description: 'Base64 of an ECDSA P-256 private key in SEC1 (RFC 5915) or PKCS#8 (RFC 5208) DER form. Mutually exclusive with ecPrivateScalarHex.',
            minLength: 4,
        },
        autoInjectPlaceholder: {
            type: 'boolean',
            default: true,
            description: 'When true (default) and the input PDF has no /Sig widget, pdfnative.addSignaturePlaceholder is called before signing — enabling single-call signing of any PDF.',
        },
        signerName: { type: 'string', maxLength: 200 },
        reason: { type: 'string', maxLength: 500 },
        location: { type: 'string', maxLength: 200 },
        contactInfo: { type: 'string', maxLength: 200 },
        signingTime: {
            type: 'string',
            format: 'date-time',
            description: 'ISO-8601 timestamp. Defaults to now.',
        },
        outputMode: { type: 'string', enum: ['base64', 'file'], default: 'base64' },
        outputPath: { type: 'string' },
    },
    required: ['pdfBase64', 'algorithm', 'certDerBase64'],
} as const;

const InputSchema = z
    .object({
        pdfBase64: z.string().min(4),
        algorithm: z.enum(['rsa-sha256', 'ecdsa-sha256']),
        certDerBase64: z.string().min(4),
        rsaKeyPkcs1DerBase64: z.string().optional(),
        ecPrivateScalarHex: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
        ecPrivateKeyDerBase64: z.string().min(4).optional(),
        autoInjectPlaceholder: z.boolean().default(true),
        signerName: z.string().max(200).optional(),
        reason: z.string().max(500).optional(),
        location: z.string().max(200).optional(),
        contactInfo: z.string().max(200).optional(),
        signingTime: z.string().datetime().optional(),
        outputMode: z.enum(['base64', 'file']).default('base64'),
        outputPath: z.string().optional(),
    })
    .superRefine((val, ctx) => {
        if (val.algorithm === 'rsa-sha256' && val.rsaKeyPkcs1DerBase64 === undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'rsaKeyPkcs1DerBase64 is required when algorithm=rsa-sha256.',
            });
        }
        if (val.algorithm === 'ecdsa-sha256') {
            const haveScalar = val.ecPrivateScalarHex !== undefined;
            const haveDer = val.ecPrivateKeyDerBase64 !== undefined;
            if (!haveScalar && !haveDer) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'ecPrivateScalarHex or ecPrivateKeyDerBase64 is required when algorithm=ecdsa-sha256.',
                });
            }
            if (haveScalar && haveDer) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'ecPrivateScalarHex and ecPrivateKeyDerBase64 are mutually exclusive.',
                });
            }
        }
    });

function decodeBase64(value: string, field: string): Uint8Array {
    /* v8 ignore next 3 */
    try {
        return new Uint8Array(Buffer.from(value, 'base64'));
    } catch {
        throw new ToolError('VALIDATION_ERROR', `${field} is not valid base64.`);
    }
}

function hexToBigInt(hex: string): bigint {
    return BigInt(`0x${hex}`);
}

function ensurePlaceholder(pdfBytes: Uint8Array, autoInject: boolean): Uint8Array {
    let already: boolean;
    try {
        const reader = openPdf(pdfBytes);
        already = hasSignaturePlaceholder(reader);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolError('PDF_PARSE_FAILED', `Failed to inspect PDF for existing placeholder: ${message}`);
    }
    if (already) return pdfBytes;
    if (!autoInject) {
        throw new ToolError(
            'MISSING_PLACEHOLDER',
            "Input PDF has no /Sig placeholder and autoInjectPlaceholder=false. Either set autoInjectPlaceholder=true or call prepare_signature_placeholder first.",
        );
    }
    try {
        return addSignaturePlaceholder(pdfBytes);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolError('PLACEHOLDER_FAILED', `Failed to auto-inject signature placeholder: ${message}`);
    }
}

export async function signPdf(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const input = parsed.data;

    const rawPdfBytes = decodeBase64(input.pdfBase64, 'pdfBase64');
    const certDer = decodeBase64(input.certDerBase64, 'certDerBase64');
    const pdfBytes = ensurePlaceholder(rawPdfBytes, input.autoInjectPlaceholder);

    const signerCert = parseCertificate(certDer);

    const baseOptions: PdfSignOptions = {
        signerCert,
        algorithm: input.algorithm,
        ...(input.signerName !== undefined ? { name: input.signerName } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.contactInfo !== undefined ? { contactInfo: input.contactInfo } : {}),
        signingTime: input.signingTime !== undefined ? new Date(input.signingTime) : new Date(),
    };

    let options: PdfSignOptions;
    if (input.algorithm === 'rsa-sha256') {
        const rsaDer = decodeBase64(input.rsaKeyPkcs1DerBase64 as string, 'rsaKeyPkcs1DerBase64');
        const rsaKey = parseRsaPrivateKey(rsaDer);
        options = { ...baseOptions, rsaKey };
    } else {
        let d: bigint;
        if (input.ecPrivateScalarHex !== undefined) {
            d = hexToBigInt(input.ecPrivateScalarHex);
        } else {
            const ecDer = decodeBase64(input.ecPrivateKeyDerBase64 as string, 'ecPrivateKeyDerBase64');
            d = parseEcPrivateKeyDer(ecDer);
        }
        options = { ...baseOptions, ecKey: { d } };
    }

    let signedBytes: Uint8Array;
    /* v8 ignore start - signPdfBytes only throws on malformed inputs already caught upstream. */
    try {
        signedBytes = signPdfBytes(pdfBytes, options);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolError('SIGNING_FAILED', `Failed to sign PDF: ${message}`);
    }
    /* v8 ignore stop */

    return emitPdf(signedBytes, {
        mode: input.outputMode,
        ...(input.outputPath !== undefined ? { outputPath: input.outputPath } : {}),
    });
}
