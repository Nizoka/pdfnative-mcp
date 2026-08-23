/**
 * Shared base64 decoding with agent-friendly diagnostics.
 *
 * `Buffer.from(x, 'base64')` never throws — it silently skips invalid
 * characters — so the classic mistakes an LLM makes (a `data:…;base64,`
 * URI, a PEM block pasted where DER was expected, plain text) would surface
 * much later as opaque engine errors. These helpers catch them at the
 * boundary with a remedy in the message.
 */
import { ToolError } from './errors.js';

const DATA_URI_RE = /^data:[^,]*;base64,/i;

/** Decode base64 (tolerating whitespace and a `data:…;base64,` prefix). */
export function decodeBase64Field(value: string, field: string): Uint8Array {
    const stripped = value.replace(DATA_URI_RE, '').replace(/\s+/g, '');
    if (stripped.length === 0 || /[^A-Za-z0-9+/=_-]/.test(stripped)) {
        throw new ToolError('VALIDATION_ERROR', `${field} is not valid base64 (plain base64 string expected, no data: URI, no PEM armour).`);
    }
    return new Uint8Array(Buffer.from(stripped, 'base64'));
}

/**
 * Decode a base64 PDF. Only the unmistakable agent mistakes are intercepted
 * here (empty payload, PEM armour, nested `data:` URI, double-encoded
 * base64); everything else is handed to the engine, whose own parser is the
 * authority on what is and is not a PDF (`validate_pdf` deliberately reports
 * unparsable input as blocking errors rather than throwing).
 */
export function decodePdfBase64(value: string, field = 'pdfBase64'): Uint8Array {
    const bytes = decodeBase64Field(value, field);
    if (bytes.length === 0) {
        throw new ToolError('VALIDATION_ERROR', `${field} decodes to an empty buffer.`);
    }
    const head = Buffer.from(bytes.subarray(0, 10)).toString('latin1');
    const hint = head.startsWith('-----BEGIN') ? 'the value is PEM text, not a PDF' : head.startsWith('data:') ? 'the value is a nested data: URI' : head.startsWith('JVBER') ? 'the value is base64 encoded twice' : undefined;
    if (hint !== undefined) {
        throw new ToolError('PDF_PARSE_FAILED', `${field} does not decode to a PDF: ${hint}. Pass the raw PDF bytes as base64 (exactly once).`);
    }
    return bytes;
}

/**
 * Decode base64 DER (certificate / private key). PEM armour is the most
 * common mistake — name the exact openssl conversion.
 */
export function decodeDerBase64(value: string, field: string, remedy: string): Uint8Array {
    const bytes = decodeBase64Field(value, field);
    const head = Buffer.from(bytes.subarray(0, 11)).toString('latin1');
    if (head.startsWith('-----BEGIN')) {
        throw new ToolError('VALIDATION_ERROR', `${field} is PEM text; DER base64 is required. Convert with: ${remedy}`);
    }
    if (bytes.length < 2 || bytes[0] !== 0x30) {
        throw new ToolError('VALIDATION_ERROR', `${field} is not DER (expected an ASN.1 SEQUENCE). Convert with: ${remedy}`);
    }
    return bytes;
}

/** Wrap a DER parser so structural failures carry a code and the conversion remedy. */
export function parseDerOrThrow<T>(field: string, remedy: string, parse: () => T): T {
    try {
        return parse();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolError('VALIDATION_ERROR', `${field} could not be parsed (${message}). It must be DER base64 — convert with: ${remedy}`);
    }
}

export const CERT_REMEDY = 'openssl x509 -in cert.pem -outform DER | base64 -w0';
export const RSA_KEY_REMEDY = 'openssl rsa -in key.pem -outform DER -traditional | base64 -w0 (PKCS#8 DER from `openssl pkey -outform DER` is also accepted)';
export const EC_KEY_REMEDY = 'openssl pkey -in key.pem -outform DER | base64 -w0';
