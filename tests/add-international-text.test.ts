import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerFontMock = vi.fn();
const loadFontDataMock = vi.fn();
const buildDocumentPDFBytesMock = vi.fn((_params?: unknown, _layout?: unknown) => new Uint8Array([0x25, 0x50, 0x44, 0x46]));

vi.mock('pdfnative', () => ({
    registerFont: registerFontMock,
    loadFontData: loadFontDataMock,
    buildDocumentPDFBytes: buildDocumentPDFBytesMock,
    PDF_A_CONFORMANCE_TARGETS: ['pdfa1b', 'pdfa2b', 'pdfa2u', 'pdfa3b'] as const,
}));

describe('add_international_text tool', () => {
    beforeEach(() => {
        vi.resetModules();
        registerFontMock.mockClear();
        loadFontDataMock.mockReset();
        buildDocumentPDFBytesMock.mockClear();
        loadFontDataMock.mockResolvedValue({
            fontName: 'NotoMock',
            metrics: {},
            cmap: {},
            defaultWidth: 500,
            widths: {},
            pdfWidthArray: '',
            ttfBase64: '',
            gsub: {},
        });
    });

    it('generates a base64 PDF for a supported language', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');

        const result = await addInternationalText({
            title: 'Arabic sample',
            lang: 'ar',
            paragraphs: ['مرحبا'],
        });

        expect(result.mode).toBe('base64');
        expect(typeof result.base64).toBe('string');
        expect(registerFontMock).toHaveBeenCalledTimes(1);
        expect(loadFontDataMock).toHaveBeenCalledWith('ar');
        expect(buildDocumentPDFBytesMock).toHaveBeenCalledTimes(1);
    });

    it('registers the same language only once across repeated calls', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');

        await addInternationalText({ title: 'A', lang: 'ar', paragraphs: ['one'] });
        await addInternationalText({ title: 'B', lang: 'ar', paragraphs: ['two'] });

        expect(registerFontMock).toHaveBeenCalledTimes(1);
        expect(loadFontDataMock).toHaveBeenCalledTimes(2);
    });

    it('returns FONT_LOAD_FAILED when font data cannot be loaded', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');
        loadFontDataMock.mockResolvedValue(null);

        await expect(
            addInternationalText({
                title: 'Missing font',
                lang: 'ar',
                paragraphs: ['x'],
            }),
        ).rejects.toThrow("Failed to load font data for lang 'ar'.");
    });

    it('validates unsupported language at schema boundary', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');

        await expect(
            addInternationalText({
                title: 'Bad lang',
                lang: 'zz',
                paragraphs: ['x'],
            }),
        ).rejects.toThrow("Unsupported lang 'zz'");
    });

    it('registers a lazily-loadable font loader callback', async () => {
        let loader: (() => Promise<unknown>) | null = null;
        registerFontMock.mockImplementation((_lang: string, fn: () => Promise<unknown>) => {
            loader = fn;
        });

        const { addInternationalText } = await import('../src/tools/add-international-text.js');
        await addInternationalText({ title: 'Loader', lang: 'ar', paragraphs: ['x'] });

        expect(loader).not.toBeNull();
        const loaded = await loader!();
        expect(typeof loaded).toBe('object');
    });

    it('accepts an array of lang codes and registers each once', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');
        await addInternationalText({ title: 'Multi', lang: ['ar', 'he'], paragraphs: ['x'] });
        expect(registerFontMock).toHaveBeenCalledTimes(2);
        expect(loadFontDataMock).toHaveBeenCalledWith('ar');
        expect(loadFontDataMock).toHaveBeenCalledWith('he');
    });

    it('accepts a comma-separated lang string', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');
        await addInternationalText({ title: 'Comma', lang: 'ar,he', paragraphs: ['x'] });
        expect(loadFontDataMock).toHaveBeenCalledTimes(2);
    });

    it('deduplicates repeated lang codes', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');
        await addInternationalText({ title: 'Dedup', lang: ['ar', 'ar'], paragraphs: ['x'] });
        expect(loadFontDataMock).toHaveBeenCalledTimes(1);
    });

    it('auto-pushes latin when pdfA is set and latin is not already in langs', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');
        await addInternationalText({ title: 'PdfA', lang: 'ar', pdfA: 'pdfa2b', paragraphs: ['x'] });
        // ar + auto-latin = 2 font loads
        expect(loadFontDataMock).toHaveBeenCalledTimes(2);
        expect(loadFontDataMock).toHaveBeenCalledWith('latin');
    });

    it('does not push latin twice when latin is already in langs with pdfA', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');
        await addInternationalText({ title: 'NoDouble', lang: ['ar', 'latin'], pdfA: 'pdfa2b', paragraphs: ['x'] });
        // ar + latin, no extra latin push
        expect(loadFontDataMock).toHaveBeenCalledTimes(2);
    });

    it.each(['te', 'si', 'bo', 'km', 'my', 'am'])(
        'supports the pdfnative 1.3.0 script %s',
        async (code) => {
            const { addInternationalText } = await import('../src/tools/add-international-text.js');
            const result = await addInternationalText({ title: `Script ${code}`, lang: code, paragraphs: ['x'] });
            expect(result.mode).toBe('base64');
            expect(registerFontMock).toHaveBeenCalledTimes(1);
            expect(loadFontDataMock).toHaveBeenCalledWith(code);
        },
    );

    it('supports COLRv1 colour emoji via the emoji lang code', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');
        await addInternationalText({ title: 'Emoji', lang: ['latin', 'emoji'], paragraphs: ['hi 😀'] });
        expect(loadFontDataMock).toHaveBeenCalledWith('emoji');
    });

    it('NFC-normalises input by passing normalize:"NFC" to the builder', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');
        await addInternationalText({ title: 'NFC', lang: 'ar', paragraphs: ['x'] });
        const layout = buildDocumentPDFBytesMock.mock.calls[0]?.[1] as { normalize?: string } | undefined;
        expect(layout?.normalize).toBe('NFC');
    });

    it('combines NFC normalisation with the PDF/A tagged option', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');
        await addInternationalText({ title: 'NFC+A', lang: 'ar', pdfA: 'pdfa2u', paragraphs: ['x'] });
        const layout = buildDocumentPDFBytesMock.mock.calls[0]?.[1] as { normalize?: string; tagged?: string } | undefined;
        expect(layout?.normalize).toBe('NFC');
        expect(layout?.tagged).toBe('pdfa2u');
    });

    it('honours an explicit normalize override', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');
        await addInternationalText({ title: 'NFD', lang: 'ar', normalize: 'NFD', paragraphs: ['x'] });
        const layout = buildDocumentPDFBytesMock.mock.calls[0]?.[1] as { normalize?: string } | undefined;
        expect(layout?.normalize).toBe('NFD');
    });

    it('rejects an unsupported normalize form with VALIDATION_ERROR', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');
        await expect(
            addInternationalText({ title: 'bad', lang: 'ar', normalize: 'NFG', paragraphs: ['x'] }),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('auto-splits paragraphs on embedded newlines before building', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');
        await addInternationalText({ title: 'Lines', lang: 'latin', paragraphs: ['a\nb\nc'] });
        const params = buildDocumentPDFBytesMock.mock.calls[0]?.[0] as { blocks: unknown[] };
        expect(params.blocks).toHaveLength(3);
    });

    it('rejects paragraphs that sanitise to zero blocks', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');
        await expect(
            addInternationalText({ title: 'Empty', lang: 'latin', paragraphs: ['\n\n'] }),
        ).rejects.toThrow("paragraphs must contain at least one non-empty line");
    });
});

describe('add_international_text print + diagnostics inputs (v1.6.0)', () => {
    beforeEach(() => {
        vi.resetModules();
        registerFontMock.mockClear();
        loadFontDataMock.mockReset();
        buildDocumentPDFBytesMock.mockClear();
        loadFontDataMock.mockResolvedValue({ fontName: 'NotoMock', metrics: {}, cmap: {}, defaultWidth: 500, widths: {}, pdfWidthArray: '', ttfBase64: '', gsub: {} });
    });

    it('strict + pdfA succeeds (fonts are always embedded) and forwards strict + a diagnostics sink', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');
        const result = await addInternationalText({ title: 'T', lang: 'ar', paragraphs: ['مرحبا'], pdfA: 'pdfa2b', strict: true, includeDiagnostics: true });
        expect(result.diagnostics).toEqual([]);
        const layout = buildDocumentPDFBytesMock.mock.calls[0]?.[1] as Record<string, unknown>;
        expect(layout['strict']).toBe(true);
        expect(layout['tagged']).toBe('pdfa2b');
        expect(typeof layout['onDiagnostic']).toBe('function');
    });

    it('does not expose embedFonts (fonts are already embedded)', async () => {
        const { addInternationalText, ADD_INTERNATIONAL_TEXT_INPUT_SCHEMA } = await import('../src/tools/add-international-text.js');
        const keys = Object.keys(ADD_INTERNATIONAL_TEXT_INPUT_SCHEMA.properties);
        expect(keys).not.toContain('embedFonts');
        expect(keys).toEqual(expect.arrayContaining(['print', 'outputIntent', 'metadata', 'strict', 'includeDiagnostics']));
        // Unknown keys are rejected at the boundary (Zod strict ⇔ additionalProperties:false), so a
        // typo or a copy-pasted option from another tool never goes silently ignored.
        await expect(addInternationalText({ title: 'T', lang: 'ar', paragraphs: ['x'], embedFonts: true })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        expect(loadFontDataMock).not.toHaveBeenCalled();
    });

    it('forwards print options and document metadata to the engine', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');
        await addInternationalText({ title: 'T', lang: 'ar', paragraphs: ['x'], print: { bleed: 8.5, marks: true }, metadata: { author: 'A', trapped: 'True' } });
        const [params, layout] = buildDocumentPDFBytesMock.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
        expect(layout['print']).toEqual({ bleed: 8.5, marks: true });
        expect(params['metadata']).toEqual({ author: 'A', trapped: 'True' });
    });

    it('rejects userUnit under pdfa1b before touching the engine', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');
        await expect(
            addInternationalText({ title: 'T', lang: 'ar', paragraphs: ['x'], pdfA: 'pdfa1b', print: { userUnit: 2 } }),
        ).rejects.toMatchObject({ code: 'PDF_A_COMPLIANCE_VIOLATION' });
        expect(buildDocumentPDFBytesMock).not.toHaveBeenCalled();
    });

    it('keeps the default engine call free of print / metadata keys', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');
        await addInternationalText({ title: 'T', lang: 'ar', paragraphs: ['x'] });
        const [params, layout] = buildDocumentPDFBytesMock.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
        expect(Object.keys(params)).toEqual(['title', 'blocks', 'fontEntries']);
        expect(Object.keys(layout).sort()).toEqual(['normalize', 'onDiagnostic']);
    });

    it('maps an engine PDF/A throw to PDF_A_COMPLIANCE_VIOLATION', async () => {
        const { addInternationalText } = await import('../src/tools/add-international-text.js');
        buildDocumentPDFBytesMock.mockImplementationOnce(() => {
            throw new Error('pdfnative: tagged document violates PDF/A conformance');
        });
        await expect(addInternationalText({ title: 'T', lang: 'ar', paragraphs: ['x'], pdfA: 'pdfa2b', strict: true })).rejects.toMatchObject({
            code: 'PDF_A_COMPLIANCE_VIOLATION',
        });
    });
});
