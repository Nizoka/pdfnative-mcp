/**
 * Shared fixtures for the page-tree tool tests (merge / split / extract).
 * Builds real multi-page PDFs (and an encrypted one) entirely in-process.
 */
import { buildDocumentPDFBytes, type DocumentBlock } from 'pdfnative';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';

/** Build an N-page PDF (one heading per page) and return it as base64. */
export async function makePdfBase64(pages: number, label = 'Doc'): Promise<string> {
    const blocks: Array<{ type: string; text?: string; level?: number }> = [];
    for (let i = 0; i < pages; i++) {
        if (i > 0) blocks.push({ type: 'pageBreak' });
        blocks.push({ type: 'heading', text: `${label} — page ${i + 1}`, level: 1 });
    }
    const result = await generateBasicPdf({ title: label, blocks });
    return result.base64 as string;
}

/** Build an encrypted (owner-password) PDF and return it as base64. */
export function makeEncryptedPdfBase64(): string {
    const blocks: DocumentBlock[] = [{ type: 'paragraph', text: 'secret' }];
    const bytes = buildDocumentPDFBytes(
        { title: 'Secret', blocks },
        { encryption: { ownerPassword: 'owner-secret' } },
    );
    return Buffer.from(bytes).toString('base64');
}
