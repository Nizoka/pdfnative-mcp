/**
 * Shared fixtures for the encryption / decryption tests (v1.5.0).
 *
 * pdfnative v1.6.0 can WRITE encrypted PDFs (Standard Security Handler), so we
 * build real AES-128 / AES-256 encrypted documents entirely in-process — no
 * checked-in binary fixtures. This unblocks the roadmap's "encrypted-PDF
 * round-trip fixtures" item.
 */
import { buildDocumentPDFBytes, type DocumentBlock } from 'pdfnative';

export interface EncryptedFixtureOptions {
    /** User (open) password. Omit for an owner-only document (empty user password → opens transparently). */
    readonly userPassword?: string;
    /** Owner password (required by pdfnative). */
    readonly ownerPassword?: string;
    /** Content cipher. Default 'aes128'. */
    readonly algorithm?: 'aes128' | 'aes256';
    /** Body text. */
    readonly text?: string;
}

/** Build an encrypted PDF and return its bytes. */
export function makeEncryptedPdfBytes(opts: EncryptedFixtureOptions = {}): Uint8Array {
    const blocks: DocumentBlock[] = [
        { type: 'heading', text: 'Confidential', level: 1 },
        { type: 'paragraph', text: opts.text ?? 'This document is protected by the PDF Standard Security Handler.' },
    ];
    return buildDocumentPDFBytes(
        { title: 'Confidential', blocks },
        {
            encryption: {
                ownerPassword: opts.ownerPassword ?? 'owner-secret',
                ...(opts.userPassword !== undefined ? { userPassword: opts.userPassword } : {}),
                ...(opts.algorithm !== undefined ? { algorithm: opts.algorithm } : {}),
            },
        },
    );
}

/** Build an encrypted PDF and return it as base64. */
export function makeEncryptedPdfBase64(opts: EncryptedFixtureOptions = {}): string {
    return Buffer.from(makeEncryptedPdfBytes(opts)).toString('base64');
}
