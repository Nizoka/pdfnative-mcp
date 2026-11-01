/**
 * Operator font sandbox — `PDFNATIVE_MCP_FONT_DIR` (1.8.0).
 *
 * The operator points the variable at a directory of `.ttf` / `.otf` files;
 * at boot every file is parsed by the engine's own font compiler
 * (`parseFontData` from `pdfnative/tools`: metrics, cmap, widths, GSUB /
 * GPOS) and registered under `custom:<slug>`, where the slug is the file's
 * base name folded to `[a-z0-9-]`. A tool call then names a face with the
 * `font` input (the slug); an unknown slug is `FONT_NOT_FOUND` listing the
 * registered ones. The schema stays static (the catalogue never varies by
 * operator) and no tool argument ever carries a path.
 *
 * Designed like the output sandbox: read once at boot, declared in
 * `server.json`, validated before registration, and an invalid value — a
 * relative or missing directory, a file that is not a font, two files folding
 * to the same slug, more than {@link MAX_FONT_FILES} files or a file over
 * {@link MAX_FONT_FILE_BYTES} — refuses to start rather than serving with a
 * silently incomplete registry. The directory itself is never listed to a
 * client: results and errors name slugs, never paths.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { loadFontData, registerFont, type FontData, type FontEntry } from 'pdfnative';
import { parseFontData } from 'pdfnative/tools';
import { z } from 'zod';

import { ToolError } from './errors.js';

export const FONT_DIR_ENV = 'PDFNATIVE_MCP_FONT_DIR';
/** Registry key prefix: keeps operator faces apart from the bundled script codes. */
export const CUSTOM_FONT_PREFIX = 'custom:';
export const MAX_FONT_FILES = 64;
export const MAX_FONT_FILE_BYTES = 16 * 1024 * 1024;
const FONT_EXTENSIONS = new Set(['.ttf', '.otf']);

/** A slug: the file's base name folded to lower-case `[a-z0-9-]`, 1–64 characters. */
export const FONT_SLUG_PATTERN = '^[a-z0-9][a-z0-9-]{0,63}$';
const FONT_SLUG_RE = new RegExp(FONT_SLUG_PATTERN);

interface CustomFont {
    readonly slug: string;
    readonly lang: string;
    readonly fontName: string;
}

let registry: ReadonlyMap<string, CustomFont> = new Map();
/**
 * SHA-256 (first 12 hex digits) over every registered file — slug, size and
 * the digest of its bytes — or `''` when no font is registered. It joins the
 * response-cache namespace (`cacheNamespace()` in src/server.ts): a `font`
 * call is identified by its slug only, so without it a face replaced on disk
 * and a restart would keep serving PDFs rendered with the earlier bytes.
 */
let fingerprint = '';

/** Fold a file's base name to a slug: `Brand Sans-Bold.ttf` → `brand-sans-bold`. */
export function fontSlug(fileName: string): string {
    return path
        .basename(fileName, path.extname(fileName))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
}

/**
 * Read the variable, parse and register every font file, and return the
 * registered slugs in directory order. Throws a plain `Error` (a boot
 * refusal) on any invalid condition; a missing or blank variable registers
 * nothing and returns `[]`.
 */
export function loadCustomFonts(env: NodeJS.ProcessEnv = process.env): readonly string[] {
    const raw = env[FONT_DIR_ENV];
    if (raw === undefined || raw.trim() === '') {
        registry = new Map();
        fingerprint = '';
        return [];
    }
    const dir = raw.trim();
    if (!path.isAbsolute(dir)) throw new Error(`${FONT_DIR_ENV} must be an absolute path; got "${dir}".`);
    let entries: string[];
    try {
        if (!statSync(dir).isDirectory()) throw new Error('not a directory');
        entries = readdirSync(dir);
    } catch (err) {
        throw new Error(`${FONT_DIR_ENV} must name an existing, readable directory: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Sorted by slug (not by raw name) so the registration order is the same on every file system.
    const files = entries
        .filter((name) => FONT_EXTENSIONS.has(path.extname(name).toLowerCase()))
        .map((name) => ({ name, slug: fontSlug(name) }))
        .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : a.name < b.name ? -1 : 1));
    if (files.length === 0) throw new Error(`${FONT_DIR_ENV} holds no .ttf / .otf file.`);
    if (files.length > MAX_FONT_FILES) throw new Error(`${FONT_DIR_ENV} holds ${files.length} font files; at most ${MAX_FONT_FILES} are registered.`);

    // Every file is checked and parsed before the first registration: the engine registry is
    // process-global, so a refusal on a later file must leave nothing of the earlier ones behind.
    const parsed: Array<{ font: CustomFont; data: FontData }> = [];
    const taken = new Set<string>();
    const digest = createHash('sha256');
    for (const { name: file, slug } of files) {
        if (!FONT_SLUG_RE.test(slug)) throw new Error(`${FONT_DIR_ENV}: "${file}" folds to an empty or invalid slug — rename it to letters, digits and dashes.`);
        if (taken.has(slug)) throw new Error(`${FONT_DIR_ENV}: "${file}" folds to the slug "${slug}" already taken by another file — rename one of them.`);
        const full = path.join(dir, file);
        const size = statSync(full).size;
        if (size > MAX_FONT_FILE_BYTES) throw new Error(`${FONT_DIR_ENV}: "${file}" is ${size} bytes, over the ${MAX_FONT_FILE_BYTES}-byte limit.`);
        const bytes = readFileSync(full);
        digest.update(`${slug}\0${bytes.length}\0${createHash('sha256').update(bytes).digest('hex')}\n`);
        let data: FontData;
        try {
            data = parseFontData(new Uint8Array(bytes)) as unknown as FontData;
        } catch (err) {
            throw new Error(`${FONT_DIR_ENV}: "${file}" is not a TrueType / OpenType font the engine can parse: ${err instanceof Error ? err.message : String(err)}`);
        }
        taken.add(slug);
        parsed.push({ font: { slug, lang: `${CUSTOM_FONT_PREFIX}${slug}`, fontName: data.fontName }, data });
    }
    const next = new Map<string, CustomFont>();
    for (const { font, data } of parsed) {
        registerFont(font.lang, () => Promise.resolve(data));
        next.set(font.slug, font);
    }
    registry = next;
    fingerprint = digest.digest('hex').slice(0, 12);
    return [...next.keys()];
}

/** The registered slugs, in registration order. */
export function customFontSlugs(): readonly string[] {
    return [...registry.keys()];
}

/**
 * The response-cache namespace segment of the font sandbox: `''` without
 * operator fonts, `/fonts:<12 hex>` otherwise (see {@link fingerprint}).
 */
export function customFontCacheTag(): string {
    return fingerprint === '' ? '' : `/fonts:${fingerprint}`;
}

/**
 * The registry key (`custom:<slug>`) of a face named by the `font` input, or
 * `FONT_NOT_FOUND` naming what the operator did register.
 */
export function resolveCustomFont(slug: string): string {
    const found = registry.get(slug);
    if (found !== undefined) return found.lang;
    const available = customFontSlugs();
    throw new ToolError(
        'FONT_NOT_FOUND',
        available.length === 0
            ? `font '${slug}' is unknown: the operator registered no custom font (${FONT_DIR_ENV} is unset).`
            : `font '${slug}' is unknown. Registered custom fonts: ${available.join(', ')}.`,
    );
}

/**
 * The primary `FontEntry` for a document tool's `font` input (`/F3`), or `[]`
 * when the input is absent so the build call stays byte-identical.
 */
export async function customFontEntry(slug: string | undefined, fontRef = '/F3'): Promise<FontEntry[]> {
    if (slug === undefined) return [];
    const lang = resolveCustomFont(slug);
    const fontData = await loadFontData(lang);
    /* v8 ignore next 3 -- registered at boot from a parsed file; the loader cannot miss */
    if (fontData === null) {
        throw new ToolError('FONT_LOAD_FAILED', `Failed to load the custom font '${slug}'.`);
    }
    return [{ fontData, fontRef, lang }];
}

/** Test-only: forget every registered face (the engine registry keeps its loaders). */
export function __resetCustomFonts(): void {
    registry = new Map();
    fingerprint = '';
}

/** JSON Schema fragment — spread into a tool's `properties`. */
export const FONT_INPUT_PROPERTY = {
    font: {
        type: 'string',
        pattern: FONT_SLUG_PATTERN,
        maxLength: 64,
        description:
            "Operator-registered custom font (the slug of a .ttf / .otf file in PDFNATIVE_MCP_FONT_DIR, e.g. 'brand-sans'): drawn first, with the bundled faces as fallbacks. Unknown slug → FONT_NOT_FOUND listing the registered ones; always embedded, so valid under PDF/A.",
    },
} as const;

/** Zod counterpart of {@link FONT_INPUT_PROPERTY}. */
export const FontInputShape = {
    font: z.string().regex(FONT_SLUG_RE).max(64).optional(),
} as const;
