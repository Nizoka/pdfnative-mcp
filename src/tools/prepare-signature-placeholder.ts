/**
 * Tool: prepare_signature_placeholder
 *
 * Creates a PDF document with an embedded /Sig placeholder (AcroForm + Widget annotation)
 * that is ready to be signed with the `sign_pdf` tool. The produced PDF conforms to the
 * PAdES structure expected by pdfnative's signPdfBytes function.
 *
 * Workflow:
 *   1. Call prepare_signature_placeholder → outputs a .pdf with /Contents and /ByteRange placeholders
 *   2. Pass that PDF to sign_pdf together with a certificate and private key → signed PDF
 */
import { buildDocumentPDFBytes, openPdf, findStartxref, isRef, isName, isArray, isDict, isStream, type PdfValue, type PdfRef, type DocumentBlock } from 'pdfnative';
import { z } from 'zod';
import { emitPdf, type OutputResult } from '../output.js';
import { ToolError } from '../errors.js';

export const PREPARE_SIGNATURE_PLACEHOLDER_NAME = 'prepare_signature_placeholder';

export const PREPARE_SIGNATURE_PLACEHOLDER_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        title: {
            type: 'string',
            description: 'Document title. Used as the PDF metadata title and rendered at the top of page 1.',
            minLength: 1,
            maxLength: 200,
        },
        signerName: {
            type: 'string',
            maxLength: 200,
            description: 'Name of the intended signer, embedded in the /Sig dictionary.',
        },
        reason: {
            type: 'string',
            maxLength: 500,
            description: 'Reason for signing (e.g. "Approved", "I agree to the terms").',
        },
        location: {
            type: 'string',
            maxLength: 200,
            description: 'Signing location (city / country).',
        },
        contactInfo: {
            type: 'string',
            maxLength: 200,
            description: 'Contact information for the signer.',
        },
        pdfA: {
            type: 'string',
            enum: ['pdfa1b', 'pdfa2b', 'pdfa2u', 'pdfa3b'],
            description: 'Optional PDF/A conformance level (pdfnative v1.1) for the underlying document. Note: PDF/A + signatures requires PAdES-A; verify with inspect_pdf.',
        },
        blocks: {
            type: 'array',
            description: 'Optional document body blocks rendered before the signature field.',
            maxItems: 2000,
            items: {
                oneOf: [
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['type', 'text', 'level'],
                        properties: {
                            type: { const: 'heading' },
                            text: { type: 'string', minLength: 1, maxLength: 500 },
                            level: { type: 'integer', enum: [1, 2, 3] },
                        },
                    },
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['type', 'text'],
                        properties: {
                            type: { const: 'paragraph' },
                            text: { type: 'string', minLength: 1, maxLength: 50000 },
                        },
                    },
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['type'],
                        properties: {
                            type: { const: 'pageBreak' },
                        },
                    },
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['type', 'height'],
                        properties: {
                            type: { const: 'spacer' },
                            height: { type: 'number', minimum: 1, maximum: 500 },
                        },
                    },
                ],
            },
        },
        outputMode: {
            type: 'string',
            enum: ['base64', 'file'],
            default: 'base64',
            description:
                "Either 'base64' (returns the PDF inline) or 'file' (writes to a sandboxed path inside PDFNATIVE_MPC_OUTPUT_DIR).",
        },
        outputPath: {
            type: 'string',
            description: "Required when outputMode='file'. Relative path inside the sandbox; must end with .pdf.",
        },
    },
    required: ['title'],
} as const;

const BlockSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('heading'), text: z.string().min(1).max(500), level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
    z.object({ type: z.literal('paragraph'), text: z.string().min(1).max(50000) }),
    z.object({ type: z.literal('pageBreak') }),
    z.object({ type: z.literal('spacer'), height: z.number().min(1).max(500) }),
]);

const InputSchema = z.object({
    title: z.string().min(1).max(200),
    signerName: z.string().max(200).optional(),
    reason: z.string().max(500).optional(),
    location: z.string().max(200).optional(),
    contactInfo: z.string().max(200).optional(),
    pdfA: z.enum(['pdfa1b', 'pdfa2b', 'pdfa2u', 'pdfa3b']).optional(),
    blocks: z.array(BlockSchema).max(2000).optional(),
    outputMode: z.enum(['base64', 'file']).default('base64'),
    outputPath: z.string().optional(),
});

/** Escape a PDF string literal (parenthesis form). */
function escapePdfLiteral(s: string): string {
    return s.replace(/[\\()]/g, (c) => '\\' + c);
}

/** Format a date in PDF date string format D:YYYYMMDDHHmmssZ. */
function pdfDateString(d: Date): string {
    const p = (n: number): string => String(n).padStart(2, '0');
    return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Build a raw /Sig dictionary string with a zeroed /Contents placeholder and /ByteRange placeholder. */
function buildSigDictRaw(opts: {
    name?: string;
    reason?: string;
    location?: string;
    contactInfo?: string;
}): string {
    const DEFAULT_CONTENTS_SIZE = 16384;
    const BYTERANGE_PLACEHOLDER = '/ByteRange [0 0000000000 0000000000 0000000000]';
    const hexLen = DEFAULT_CONTENTS_SIZE * 2;
    const parts: string[] = [
        '<< /Type /Sig',
        '/Filter /Adobe.PPKLite',
        '/SubFilter /adbe.pkcs7.detached',
        `/Contents <${'0'.repeat(hexLen)}>`,
        BYTERANGE_PLACEHOLDER,
    ];
    if (opts.name) parts.push(`/Name (${escapePdfLiteral(opts.name)})`);
    if (opts.reason) parts.push(`/Reason (${escapePdfLiteral(opts.reason)})`);
    if (opts.location) parts.push(`/Location (${escapePdfLiteral(opts.location)})`);
    if (opts.contactInfo) parts.push(`/ContactInfo (${escapePdfLiteral(opts.contactInfo)})`);
    parts.push(`/M (${pdfDateString(new Date())})`);
    parts.push('>>');
    return parts.join('\n');
}

/**
 * Minimal PDF value serializer for reconstructing modified catalog/page objects.
 * Handles all PdfValue variants that appear in standard document structures.
 */
function serializePdfValue(val: PdfValue): string {
    if (val === null) return 'null';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'number') {
        return Number.isInteger(val) ? String(val) : val.toFixed(4).replace(/\.?0+$/, '');
    }
    if (typeof val === 'string') {
        return `(${val.replace(/[\\()]/g, (c) => '\\' + c)})`;
    }
    if (isName(val)) return `/${val.value}`;
    if (isRef(val)) return `${val.num} ${val.gen} R`;
    if (isArray(val)) return `[${val.map(serializePdfValue).join(' ')}]`;
    if (isDict(val)) {
        let s = '<<';
        for (const [k, v] of val) s += ` /${k} ${serializePdfValue(v)}`;
        return s + ' >>';
    }
    /* v8 ignore start - streams and unknown values are never passed in normal traversal; defensive only. */
    if (isStream(val)) {
        let s = '<<';
        for (const [k, v] of val.dict) s += ` /${k} ${serializePdfValue(v)}`;
        return s + ' >>';
    }
    return 'null';
    /* v8 ignore stop */
}

/**
 * Build an incremental xref section string.
 */
function buildXref(entries: Map<number, number>): string {
    const sorted = [...entries.keys()].sort((a, b) => a - b);
    if (sorted.length === 0) return 'xref\n0 0\n';
    let result = 'xref\n';
    let i = 0;
    while (i < sorted.length) {
        const start = sorted[i];
        let end = start;
        while (i + 1 < sorted.length && sorted[i + 1] === end + 1) {
            i++;
            end = sorted[i];
        }
        const count = end - start + 1;
        result += `${start} ${count}\n`;
        for (let num = start; num <= end; num++) {
            const off = entries.get(num) ?? 0;
            result += `${String(off).padStart(10, '0')} 00000 n \n`;
        }
        i++;
    }
    return result;
}

export async function prepareSignaturePlaceholder(rawInput: unknown): Promise<OutputResult> {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw new ToolError('VALIDATION_ERROR', `Invalid arguments: ${parsed.error.message}`);
    }
    const { title, signerName, reason, location, contactInfo, blocks, pdfA, outputMode, outputPath } = parsed.data;

    // --- Build base document ---
    const contentBlocks: DocumentBlock[] = (blocks ?? []).map((b): DocumentBlock => {
        switch (b.type) {
            case 'heading': return { type: 'heading', text: b.text, level: b.level };
            case 'paragraph': return { type: 'paragraph', text: b.text };
            case 'pageBreak': return { type: 'pageBreak' };
            case 'spacer': return { type: 'spacer', height: b.height };
        }
    });

    // Always have at least one content block
    if (contentBlocks.length === 0) {
        contentBlocks.push({ type: 'paragraph', text: 'This document contains a digital signature field.' });
    }

    const baseBytes = buildDocumentPDFBytes(
        { title, blocks: contentBlocks },
        pdfA !== undefined ? { tagged: pdfA } : {},
    );

    // --- Parse structure ---
    const reader = openPdf(baseBytes);
    const trailer = reader.trailer;

    const rootRef = trailer.get('Root') as PdfRef;
    const catalogObjNum = rootRef.num;

    // Navigate to first page object number
    const catalog = reader.getCatalog();
    const pagesTreeVal = reader.resolveValue(catalog.get('Pages') as PdfValue);
    // pdfnative always emits a proper /Pages tree for its own documents; these guards are safety nets.
    /* v8 ignore next 3 */
    if (!isDict(pagesTreeVal)) {
        throw new ToolError('INTERNAL_ERROR', 'Cannot locate /Pages tree in generated PDF.');
    }
    const kidsRaw = pagesTreeVal.get('Kids');
    const kidsVal = kidsRaw !== undefined ? kidsRaw : null;
    /* v8 ignore next 3 */
    if (!isArray(kidsVal) || kidsVal.length === 0) {
        throw new ToolError('INTERNAL_ERROR', 'Cannot locate page objects in generated PDF.');
    }
    const page0Ref = kidsVal[0] as PdfRef;
    const pageObjNum = page0Ref.num;

    const prevXrefOffset = findStartxref(baseBytes);
    const trailerSize = trailer.get('Size') as number; // next available object number

    // Allocate new object numbers
    const sigObjNum = trailerSize;       // e.g. 8
    const widgetObjNum = trailerSize + 1; // e.g. 9
    const newTrailerSize = trailerSize + 2;

    // --- Sig dict (raw PDF text) ---
    const sigDictStr = buildSigDictRaw({
        ...(signerName !== undefined ? { name: signerName } : {}),
        ...(reason !== undefined ? { reason } : {}),
        ...(location !== undefined ? { location } : {}),
        ...(contactInfo !== undefined ? { contactInfo } : {}),
    });

    // --- Incremental update assembly ---
    // Offsets are measured in bytes from the start of the file.
    // All content here is ASCII/Latin-1 so string.length === byte length.
    let baseOffset = baseBytes.length;
    const xrefEntries = new Map<number, number>();
    const parts: string[] = [];

    // Separator newline between base PDF and incremental update
    parts.push('\n');
    baseOffset += 1;

    // Object sigObjNum: the sig dict (raw embedded as indirect object)
    const sigObjParts = [`${sigObjNum} 0 obj\n`, sigDictStr, '\nendobj\n\n'];
    const sigObjStr = sigObjParts.join('');
    xrefEntries.set(sigObjNum, baseOffset);
    parts.push(sigObjStr);
    baseOffset += sigObjStr.length;

    // Object widgetObjNum: form widget annotation (invisible, type /Sig)
    // F=132: Print(4) + Hidden(2) = 6, but for sig annotations use F=132 (Print=4, ReadOnly=64, Hidden bit off)
    // Actually F=4 = Print only, invisible on screen is achieved via Rect [0 0 0 0]
    const widgetStr = `${widgetObjNum} 0 obj\n<< /Type /Annot /Subtype /Widget /FT /Sig /Rect [0 0 0 0] /P ${pageObjNum} 0 R /T (Signature1) /V ${sigObjNum} 0 R /F 4 >>\nendobj\n\n`;
    xrefEntries.set(widgetObjNum, baseOffset);
    parts.push(widgetStr);
    baseOffset += widgetStr.length;

    // Updated catalog: add /AcroForm
    const updatedCatalog = new Map(catalog);
    const acroFormDict = new Map<string, PdfValue>();
    acroFormDict.set('Fields', [{ type: 'ref' as const, num: widgetObjNum, gen: 0 }]);
    acroFormDict.set('SigFlags', 3);
    updatedCatalog.set('AcroForm', acroFormDict);
    const catalogObjStr = `${catalogObjNum} 0 obj\n${serializePdfValue(updatedCatalog)}\nendobj\n\n`;
    xrefEntries.set(catalogObjNum, baseOffset);
    parts.push(catalogObjStr);
    baseOffset += catalogObjStr.length;

    // Updated page 0: add /Annots
    const page0 = reader.getPage(0);
    const updatedPage = new Map(page0);
    updatedPage.set('Annots', [{ type: 'ref' as const, num: widgetObjNum, gen: 0 }]);
    const pageObjStr = `${pageObjNum} 0 obj\n${serializePdfValue(updatedPage)}\nendobj\n\n`;
    xrefEntries.set(pageObjNum, baseOffset);
    parts.push(pageObjStr);
    baseOffset += pageObjStr.length;

    // Xref table
    const xrefStr = buildXref(xrefEntries);
    const xrefOffset = baseOffset;
    parts.push(xrefStr);
    baseOffset += xrefStr.length;

    // Trailer
    const trailerParts: string[] = [`trailer\n<< /Size ${newTrailerSize} /Root ${catalogObjNum} 0 R`];
    const infoRef = trailer.get('Info');
    if (infoRef !== undefined) trailerParts.push(` /Info ${serializePdfValue(infoRef as PdfValue)}`);
    const idVal = trailer.get('ID');
    if (idVal !== undefined) trailerParts.push(` /ID ${serializePdfValue(idVal as PdfValue)}`);
    trailerParts.push(` /Prev ${prevXrefOffset} >>\n`);
    const trailerStr = trailerParts.join('');
    parts.push(trailerStr);

    parts.push(`startxref\n${xrefOffset}\n%%EOF\n`);

    // Combine base PDF bytes + incremental update
    const updateStr = parts.join('');
    const updateBytes = Buffer.from(updateStr, 'latin1');
    const combined = new Uint8Array(baseBytes.length + updateBytes.length);
    combined.set(baseBytes, 0);
    combined.set(updateBytes, baseBytes.length);

    return emitPdf(combined, { mode: outputMode, ...(outputPath !== undefined ? { outputPath } : {}) });
}
