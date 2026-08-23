import { describe, it, expect, beforeAll } from 'vitest';
import { inspectPdf } from '../src/tools/inspect-pdf.js';
import { generateBasicPdf } from '../src/tools/generate-basic-pdf.js';
import { prepareSignaturePlaceholder } from '../src/tools/prepare-signature-placeholder.js';
import { ensureCompressionReady } from '../src/server.js';
import { ToolError } from '../src/errors.js';
import { addSignaturePlaceholder } from 'pdfnative';
import { fullLadder, signedBB } from './_ltv-fixtures.js';

beforeAll(async () => {
    delete process.env['PDFNATIVE_MCP_OUTPUT_DIR'];
    await ensureCompressionReady();
});

async function buildSamplePdf(): Promise<string> {
    const r = await generateBasicPdf({
        title: 'Sample',
        blocks: [{ type: 'paragraph', text: 'Hello world.' }],
    });
    if (r.mode !== 'base64' || r.base64 === undefined) throw new Error('expected base64 result');
    return r.base64;
}

describe('inspect_pdf', () => {
    it('reports basic structural metadata for a generated PDF', async () => {
        const pdfBase64 = await buildSamplePdf();
        const out = await inspectPdf({ pdfBase64 });
        expect(out.pageCount).toBeGreaterThanOrEqual(1);
        expect(out.encryption).toBe('none');
        expect(out.signatureCount).toBe(0);
        expect(typeof out.version).toBe('string');
        expect(out.version.startsWith('1.') || out.version.startsWith('2.')).toBe(true);
    });

    it('returns per-page sizes when pages=true', async () => {
        const pdfBase64 = await buildSamplePdf();
        const out = await inspectPdf({ pdfBase64, pages: true });
        expect(Array.isArray(out.perPage)).toBe(true);
        expect(out.perPage!.length).toBe(out.pageCount);
        expect(out.perPage![0].width).toBeGreaterThan(0);
        expect(out.perPage![0].height).toBeGreaterThan(0);
    });

    it('surfaces authored page labels via getPageLabels (pdfnative v1.5)', async () => {
        const gen = await generateBasicPdf({
            title: 'Labelled',
            pageLabels: [
                { startPage: 0, style: 'roman' },
                { startPage: 1, style: 'decimal', start: 1 },
            ],
            blocks: [
                { type: 'heading', text: 'Front', level: 1 },
                { type: 'pageBreak' },
                { type: 'heading', text: 'Body', level: 1 },
            ],
        });
        const out = await inspectPdf({ pdfBase64: gen.base64 as string });
        expect(Array.isArray(out.pageLabels)).toBe(true);
        expect(out.pageLabels!.length).toBe(2);
        expect(out.pageLabels![0].startPage).toBe(0);
        expect(out.pageLabels![0].style).toBe('roman');
        expect(out.pageLabels![1].style).toBe('decimal');
    });

    it('omits pageLabels for a document without a /PageLabels tree', async () => {
        const pdfBase64 = await buildSamplePdf();
        const out = await inspectPdf({ pdfBase64 });
        expect(out.pageLabels).toBeUndefined();
    });

    it('counts signature placeholder fields', async () => {
        const placeholder = await prepareSignaturePlaceholder({
            title: 'Needs sig',
            signerName: 'Alice',
        });
        if (placeholder.mode !== 'base64' || placeholder.base64 === undefined) throw new Error('expected base64');
        const out = await inspectPdf({ pdfBase64: placeholder.base64 });
        expect(out.signatureCount).toBe(1);
    });

    it('evaluates check assertions and returns checksPassed flag', async () => {
        const pdfBase64 = await buildSamplePdf();
        const out = await inspectPdf({ pdfBase64, check: ['encrypted', 'signed'] });
        // Generated PDF is neither encrypted nor signed → both checks fail → checksPassed false
        expect(out.checksPassed).toBe(false);
        expect(out.checks?.encrypted).toBe(false);
        expect(out.checks?.signed).toBe(false);
    });

    it('reports only the requested checks (an unrequested key must not read as a failed assertion)', async () => {
        const pdfBase64 = await buildSamplePdf();
        const out = await inspectPdf({ pdfBase64, check: ['pdfa'] });
        expect(Object.keys(out.checks!)).toEqual(['pdfa']);
        const none = await inspectPdf({ pdfBase64 });
        expect(none.checks).toBeUndefined();
        expect(none.checksPassed).toBeUndefined();
    });

    it("'signed' holds when a signed field coexists with an unsigned placeholder (multi-signature flow)", async () => {
        const signed = signedBB(Buffer.from(await buildSamplePdf(), 'base64'));
        const withExtra = addSignaturePlaceholder(signed, { fieldName: 'Second', allowMultiple: true });
        const out = await inspectPdf({ pdfBase64: Buffer.from(withExtra).toString('base64'), check: ['signed', 'placeholder'], verbosity: 'full' });
        expect(out.signatureCount).toBe(2);
        expect(out.hasSignaturePlaceholder).toBe(true);
        expect(out.checks).toEqual({ signed: true, placeholder: true });
        expect(out.checksPassed).toBe(true);
    });

    it('rejects invalid base64', async () => {
        await expect(inspectPdf({ pdfBase64: '!!!!' })).rejects.toBeInstanceOf(ToolError);
    });

    it('rejects non-PDF input', async () => {
        const garbage = Buffer.from('not a pdf at all').toString('base64');
        await expect(inspectPdf({ pdfBase64: garbage })).rejects.toBeInstanceOf(ToolError);
    });

    it('detects PDF/A claim from XMP metadata', async () => {
        const r = await generateBasicPdf({
            title: 'PDF/A Sample',
            blocks: [{ type: 'paragraph', text: 'Archival document.' }],
            pdfA: 'pdfa2b',
        });
        if (r.mode !== 'base64' || r.base64 === undefined) throw new Error('expected base64');
        const out = await inspectPdf({ pdfBase64: r.base64 });
        expect(out.pdfA).not.toBeNull();
        expect(typeof out.pdfA).toBe('string');
    });

    it('reports checksPassed=true when assertions match', async () => {
        const placeholder = await prepareSignaturePlaceholder({ title: 'Sig', signerName: 'Bob' });
        if (placeholder.mode !== 'base64' || placeholder.base64 === undefined) throw new Error('expected base64');
        const out = await inspectPdf({ pdfBase64: placeholder.base64, check: ['placeholder'] });
        expect(out.checks?.placeholder).toBe(true);
        expect(out.checksPassed).toBe(true);
        expect(out.hasSignaturePlaceholder).toBe(true);
        expect(out.signatureCount).toBe(1);
    });

    it('extracts version from PDF header', async () => {
        const pdfBase64 = await buildSamplePdf();
        const out = await inspectPdf({ pdfBase64 });
        expect(out.version).toMatch(/^\d+\.\d+$/);
    });

    it('returns info dict as plain object', async () => {
        const pdfBase64 = await buildSamplePdf();
        const out = await inspectPdf({ pdfBase64 });
        expect(typeof out.info).toBe('object');
    });

    it('evaluates pdfa check as true on a PDF/A document', async () => {
        const r = await generateBasicPdf({
            title: 'Archival',
            blocks: [{ type: 'paragraph', text: 'test' }],
            pdfA: 'pdfa2b',
        });
        if (r.mode !== 'base64' || r.base64 === undefined) throw new Error('no base64');
        const out = await inspectPdf({ pdfBase64: r.base64, check: ['pdfa'] });
        expect(out.checks?.pdfa).toBe(true);
        expect(out.checksPassed).toBe(true);
    });

    it('evaluates all three check assertions at once on an unsigned plain PDF', async () => {
        const pdfBase64 = await buildSamplePdf();
        const out = await inspectPdf({ pdfBase64, check: ['pdfa', 'signed', 'encrypted'] });
        expect(out.checks?.pdfa).toBe(false);
        expect(out.checks?.signed).toBe(false);
        expect(out.checks?.encrypted).toBe(false);
        expect(out.checksPassed).toBe(false);
    });

    it('reports attachments and hasSignaturePlaceholder=false on a PDF/A-3 with attachments', async () => {
        const { addAttachment } = await import('../src/tools/add-attachment.js');
        const r = await addAttachment({
            title: 'Factur-X',
            attachments: [
                {
                    filename: 'invoice.xml',
                    mimeType: 'application/xml',
                    dataBase64: Buffer.from('<?xml version="1.0"?><Invoice/>').toString('base64'),
                    relationship: 'Source',
                    description: 'Factur-X XML',
                },
            ],
        });
        const out = await inspectPdf({ pdfBase64: r.base64!, check: ['attachments', 'placeholder'] });
        expect(out.attachments.length).toBe(1);
        expect(out.attachments[0]!.name).toBe('invoice.xml');
        expect(out.attachments[0]!.relationship).toBe('Source');
        expect(out.attachments[0]!.description).toBe('Factur-X XML');
        expect(out.attachments[0]!.sizeBytes).toBeGreaterThan(0);
        expect(out.hasSignaturePlaceholder).toBe(false);
        expect(out.checks?.attachments).toBe(true);
        expect(out.checks?.placeholder).toBe(false);
    });

    it('reports zero attachments on a plain PDF', async () => {
        const pdfBase64 = await buildSamplePdf();
        const out = await inspectPdf({ pdfBase64 });
        expect(out.attachments.length).toBe(0);
        expect(out.hasSignaturePlaceholder).toBe(false);
    });
});

describe('inspect_pdf signatures / DSS / print-production (v1.6)', () => {
    const DEFAULT_KEYS = [
        'version',
        'pageCount',
        'encryption',
        'pdfA',
        'signatureCount',
        'hasSignaturePlaceholder',
        'attachments',
        'info',
    ];

    async function samplePdfBytes(): Promise<Uint8Array> {
        return new Uint8Array(Buffer.from(await buildSamplePdf(), 'base64'));
    }

    it('default output of a plain document carries no new keys', async () => {
        const pdfBase64 = await buildSamplePdf();
        const out = await inspectPdf({ pdfBase64 });
        expect(Object.keys(out)).toEqual(DEFAULT_KEYS);
        const withPages = await inspectPdf({ pdfBase64, pages: true });
        expect(Object.keys(withPages.perPage![0]!)).toEqual(['index', 'width', 'height']);
    });

    it('lists signatures[] on a PAdES B-B document when signatures=true', async () => {
        const bb = signedBB(await samplePdfBytes());
        const out = await inspectPdf({ pdfBase64: Buffer.from(bb).toString('base64'), signatures: true });
        expect(out.signatures).toHaveLength(1);
        const sig = out.signatures![0]!;
        expect(sig.subFilter).toBe('ETSI.CAdES.detached');
        expect(sig.isDocTimestamp).toBe(false);
        expect(sig.isPlaceholder).toBe(false);
        expect(sig.byteRange).toHaveLength(4);
        expect(sig.byteRange[0]).toBe(0);
        expect(sig.contentsLength).toBeGreaterThan(0);
        expect(sig.vriKey).toMatch(/^[0-9A-F]{40}$/);
        expect(out.dss).toBeUndefined();
        expect(out.docTimestampCount).toBeUndefined();
        // Not requested → key absent.
        const plain = await inspectPdf({ pdfBase64: Buffer.from(bb).toString('base64') });
        expect(plain.signatures).toBeUndefined();
    });

    it('reports a placeholder signature with vriKey=null', async () => {
        const placeholder = await prepareSignaturePlaceholder({ title: 'Sig', signerName: 'Bob' });
        const out = await inspectPdf({ pdfBase64: placeholder.base64!, signatures: true });
        expect(out.signatures![0]!.isPlaceholder).toBe(true);
        expect(out.signatures![0]!.vriKey).toBeNull();
    });

    it('surfaces dss, docTimestampCount and isDocTimestamp on a B-LTA document', async () => {
        const { blta } = await fullLadder(await samplePdfBytes());
        const pdfBase64 = Buffer.from(blta).toString('base64');
        const out = await inspectPdf({ pdfBase64, signatures: true, check: ['dss', 'docTimestamp'] });
        expect(out.dss).toBeDefined();
        expect(out.dss!.certs).toBeGreaterThan(0);
        expect(out.dss!.ocsps + out.dss!.crls).toBeGreaterThan(0);
        expect(out.dss!.vriKeys.length).toBeGreaterThan(0);
        expect(out.docTimestampCount).toBe(1);
        const ts = out.signatures!.find((s) => s.isDocTimestamp);
        expect(ts).toBeDefined();
        expect(ts!.subFilter).toBe('ETSI.RFC3161');
        expect(ts!.isPlaceholder).toBe(false);
        const sig = out.signatures!.find((s) => !s.isDocTimestamp)!;
        expect(out.dss!.vriKeys).toContain(sig.vriKey);
        expect(out.checks?.dss).toBe(true);
        expect(out.checks?.docTimestamp).toBe(true);
        expect(out.checksPassed).toBe(true);
    });

    it('fails the dss / docTimestamp / trapped checks on a plain document', async () => {
        const pdfBase64 = await buildSamplePdf();
        const out = await inspectPdf({ pdfBase64, check: ['dss', 'docTimestamp', 'trapped'] });
        expect(out.checks?.dss).toBe(false);
        expect(out.checks?.docTimestamp).toBe(false);
        expect(out.checks?.trapped).toBe(false);
        expect(out.checksPassed).toBe(false);
        expect(out.trapped).toBeUndefined();
    });

    it('surfaces /Info /Trapped when authored', async () => {
        const r = await generateBasicPdf({
            title: 'Trapped',
            blocks: [{ type: 'paragraph', text: 'print' }],
            metadata: { trapped: 'True' },
        });
        const out = await inspectPdf({ pdfBase64: r.base64!, check: ['trapped'] });
        expect(out.trapped).toBe('True');
        expect(out.checks?.trapped).toBe(true);
        expect(out.checksPassed).toBe(true);
    });

    it('surfaces page boxes and UserUnit under pages=true only when present', async () => {
        const r = await generateBasicPdf({
            title: 'Bleed',
            blocks: [{ type: 'paragraph', text: 'print' }],
            print: { bleed: 8.5, userUnit: 2 },
        });
        const out = await inspectPdf({ pdfBase64: r.base64!, pages: true });
        const page = out.perPage![0]!;
        expect(page.userUnit).toBe(2);
        expect(page.trimBox).toHaveLength(4);
        expect(page.bleedBox).toHaveLength(4);
        // TrimBox is the MediaBox inset by the bleed.
        expect(page.trimBox![0]).toBeCloseTo(8.5);
        expect(page.trimBox![2]).toBeCloseTo(page.width - 8.5);
        expect(page.artBox).toBeUndefined();
        // Default output (without pages) is unchanged.
        const plain = await inspectPdf({ pdfBase64: r.base64! });
        expect(Object.keys(plain)).toEqual(DEFAULT_KEYS);
    });
});

describe('inspect_pdf classifyEncryption', () => {
    it('classifies /V=1 and /V=2 as RC4', async () => {
        const { classifyEncryption } = await import('../src/tools/inspect-pdf.js');
        expect(classifyEncryption(1, 40)).toBe('rc4');
        expect(classifyEncryption(2, 128)).toBe('rc4');
    });

    it('classifies /V=4 with default length as aes-128', async () => {
        const { classifyEncryption } = await import('../src/tools/inspect-pdf.js');
        expect(classifyEncryption(4, undefined)).toBe('aes-128');
        expect(classifyEncryption(4, 128)).toBe('aes-128');
    });

    it('classifies /V=4 with length>=256 as aes-256', async () => {
        const { classifyEncryption } = await import('../src/tools/inspect-pdf.js');
        expect(classifyEncryption(4, 256)).toBe('aes-256');
    });

    it('classifies /V=5 as aes-256', async () => {
        const { classifyEncryption } = await import('../src/tools/inspect-pdf.js');
        expect(classifyEncryption(5, 256)).toBe('aes-256');
    });

    it('falls back to unknown for unrecognised /V values', async () => {
        const { classifyEncryption } = await import('../src/tools/inspect-pdf.js');
        expect(classifyEncryption(99, 0)).toBe('unknown');
        expect(classifyEncryption('not-a-number', 0)).toBe('unknown');
    });
});

describe('inspect_pdf annotations (opt-in, pdfnative v1.5 getAnnotations)', () => {
    async function annotatedPdf(): Promise<string> {
        const { annotatePdf } = await import('../src/tools/annotate-pdf.js');
        const { makePdfBase64 } = await import('./_pagetree-fixtures.js');
        const src = await makePdfBase64(2, 'Annots');
        const r = await annotatePdf({
            pdfBase64: src,
            annotations: [
                { page: 0, type: 'highlight', rect: [72, 700, 300, 720], color: '#ffe600', contents: 'x'.repeat(250), quadPoints: [72, 720, 300, 720, 72, 700, 300, 700] },
                { page: 1, type: 'text', rect: [520, 700, 540, 720], contents: 'note', title: 'Alice' },
                { page: 1, type: 'square', rect: [72, 500, 300, 560], color: '#cc0000' },
            ],
        });
        return r.base64 as string;
    }

    it('default output carries no annotations / annotationCount keys', async () => {
        const pdfBase64 = await annotatedPdf();
        const out = await inspectPdf({ pdfBase64 });
        expect('annotations' in out).toBe(false);
        expect('annotationCount' in out).toBe(false);
        expect(JSON.stringify(out)).not.toContain('annotation');
    });

    it('annotations:true lists every annotation with page, subtype, rect and optional fields', async () => {
        const pdfBase64 = await annotatedPdf();
        const out = await inspectPdf({ pdfBase64, annotations: true });
        expect(out.annotationCount).toBe(3);
        expect(out.annotations).toHaveLength(3);
        const [hl, note, sq] = out.annotations!;
        expect(hl).toMatchObject({ page: 0, subtype: 'Highlight', rect: [72, 700, 300, 720] });
        expect(hl.contents).toHaveLength(200); // truncated from 250
        expect(hl.quadPoints).toHaveLength(8);
        expect(hl.color).toHaveLength(3);
        expect(note).toMatchObject({ page: 1, subtype: 'Text', contents: 'note', title: 'Alice' });
        expect(sq).toMatchObject({ page: 1, subtype: 'Square' });
        expect(sq.color).toHaveLength(3);
        expect(sq.color![0]).toBeCloseTo(0.8, 2);
        expect('url' in sq).toBe(false);
        expect('quadPoints' in sq).toBe(false);
        // Every emitted key is declared in the output schema (projectable, no required list).
        const { INSPECT_PDF_OUTPUT_SCHEMA } = await import('../src/tools/inspect-pdf.js');
        const declared = Object.keys(INSPECT_PDF_OUTPUT_SCHEMA.properties.annotations.items.properties);
        for (const a of out.annotations!) for (const k of Object.keys(a)) expect(declared).toContain(k);
        expect('required' in INSPECT_PDF_OUTPUT_SCHEMA.properties.annotations.items).toBe(false);
    });

    it('annotations:true on a document without /Annots returns an empty array and count 0', async () => {
        const pdfBase64 = await buildSamplePdf();
        const out = await inspectPdf({ pdfBase64, annotations: true });
        expect(out.annotations).toEqual([]);
        expect(out.annotationCount).toBe(0);
    });

    it("check:['annotations'] asserts presence without emitting the array", async () => {
        const annotated = await annotatedPdf();
        const plain = await buildSamplePdf();
        const yes = await inspectPdf({ pdfBase64: annotated, check: ['annotations'] });
        expect(yes.checks).toEqual({ annotations: true });
        expect(yes.checksPassed).toBe(true);
        expect(yes.annotations).toBeUndefined();
        const no = await inspectPdf({ pdfBase64: plain, check: ['annotations'] });
        expect(no.checksPassed).toBe(false);
    });

    it('works on an encrypted source opened with its password (Widget annotations)', async () => {
        // annotate_pdf refuses encrypted sources and encrypt_pdf rebuilds the page tree
        // (dropping /Annots), so build an encrypted AcroForm directly: widgets are annotations.
        const { buildDocumentPDFBytes } = await import('pdfnative');
        const bytes = buildDocumentPDFBytes(
            { title: 'Enc form', blocks: [{ type: 'formField', fieldType: 'text', name: 'who', label: 'Who' }] },
            { encryption: { ownerPassword: 'owner-pw', userPassword: 'user-pw' } },
        );
        const pdfBase64 = Buffer.from(bytes).toString('base64');
        await expect(inspectPdf({ pdfBase64, annotations: true })).rejects.toMatchObject({ code: 'PASSWORD_REQUIRED' });
        const out = await inspectPdf({ pdfBase64, password: 'user-pw', annotations: true });
        expect(out.encryption).not.toBe('none');
        expect(out.annotationCount).toBe(1);
        expect(out.annotations![0]).toMatchObject({ page: 0, subtype: 'Widget' });
        expect(out.annotations![0].rect).toHaveLength(4);
    });

    it('rejects a non-boolean annotations flag', async () => {
        const pdfBase64 = await buildSamplePdf();
        await expect(inspectPdf({ pdfBase64, annotations: 'yes' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});
