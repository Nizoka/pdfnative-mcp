/**
 * Tool: sign_pdf
 *
 * Applies a PAdES-style digital signature to a PDF that already contains a
 * `/Sig` placeholder (built by pdfnative's `buildSigDict` or an equivalent
 * tool). Supports RSA-SHA256 and ECDSA-SHA256 (P-256).
 *
 * For convenience this tool is a faithful wrapper around `pdfnative.signPdfBytes`
 * — preparing the cert and private key bytes in DER form is the caller's
 * responsibility (typically done once and stored as base64 secrets).
 */
import {
    parseCertificate,
    parseRsaPrivateKey,
    signPdfBytes,
    type PdfSignOptions,
} from 'pdfnative';
import { z } from 'zod';
import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';

export const SIGN_PDF_NAME = 'sign_pdf';

export const SIGN_PDF_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        pdfBase64: {
            type: 'string',
            description: 'Base64-encoded PDF bytes that already contain a /Sig placeholder reserving room for the CMS contents.',
            minLength: 4,
        },
        algorithm: {
            type: 'string',
            enum: ['rsa-sha256', 'ecdsa-sha256'],
            description: 'Signature algorithm. For ECDSA only P-256 is supported in v0.1.0.',
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
            description: 'Hex-encoded P-256 private scalar `d` (64 hex chars). Required when algorithm=ecdsa-sha256.',
            pattern: '^[0-9a-fA-F]{64}$',
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
        if (val.algorithm === 'ecdsa-sha256' && val.ecPrivateScalarHex === undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'ecPrivateScalarHex is required when algorithm=ecdsa-sha256.',
            });
        }
    });

function decodeBase64(value: string, field: string): Uint8Array {
    try {
        return new Uint8Array(Buffer.from(value, 'base64'));
    } catch {
        throw new ToolError('VALIDATION_ERROR', `${field} is not valid base64.`);
    }
}

function hexToBigInt(hex: string): bigint {
    return BigInt(`0x${hex}`);
}

export async function signPdf(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const input = parsed.data;

    const pdfBytes = decodeBase64(input.pdfBase64, 'pdfBase64');
    const certDer = decodeBase64(input.certDerBase64, 'certDerBase64');

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
        const d = hexToBigInt(input.ecPrivateScalarHex as string);
        options = { ...baseOptions, ecKey: { d } };
    }

    let signedBytes: Uint8Array;
    try {
        signedBytes = signPdfBytes(pdfBytes, options);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolError('SIGNING_FAILED', `Failed to sign PDF: ${message}`);
    }

    return emitPdf(signedBytes, {
        mode: input.outputMode,
        ...(input.outputPath !== undefined ? { outputPath: input.outputPath } : {}),
    });
}
