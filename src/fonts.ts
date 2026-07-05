/**
 * Shared helpers for loading pdfnative's bundled Noto font-data modules from
 * disk and registering them with pdfnative's font system.
 *
 * The font data modules ship under `pdfnative/fonts/*.js`. We resolve them via
 * the package entrypoint and a filesystem path (rather than a bare subpath
 * import) so the loader is robust across bundlers and ESM subpath-resolution
 * quirks, matching the approach used since v0.3.0.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Resolve pdfnative's bundled fonts directory. Walks up from the resolved
 * package entrypoint (`dist/index.*`) to the package root, then into `fonts/`.
 */
export function getFontsDir(): string {
    const requireFn = createRequire(import.meta.url);
    const entryPath = requireFn.resolve('pdfnative');
    return path.resolve(path.dirname(entryPath), '..', 'fonts');
}

/** Lazily import a Noto font data module from disk and unwrap a `default` export if present. */
export async function importFontModule(fontFile: string): Promise<unknown> {
    const fileUrl = pathToFileURL(path.join(getFontsDir(), fontFile)).href;
    const mod = (await import(fileUrl)) as Record<string, unknown>;
    return 'default' in mod ? mod['default'] : mod;
}
