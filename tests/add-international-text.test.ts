import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerFontMock = vi.fn();
const loadFontDataMock = vi.fn();
const buildDocumentPDFBytesMock = vi.fn(() => new Uint8Array([0x25, 0x50, 0x44, 0x46]));

vi.mock('pdfnative', () => ({
    registerFont: registerFontMock,
    loadFontData: loadFontDataMock,
    buildDocumentPDFBytes: buildDocumentPDFBytesMock,
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
        ).rejects.toThrow('Invalid arguments');
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
});
