/**
 * Synthetic ICC profiles for the corpus, the examples and the tests.
 *
 * pdfnative-mcp ships no press profile and must not: a real job uses the
 * profile of the printing condition (ISO Coated v2, GRACoL, …) supplied by
 * the printer, and most of them are licensed. These builders produce the
 * smallest profiles a validator accepts, so conformance fixtures need no
 * binary blob and no third-party licence. They characterise no device —
 * never use them for production.
 *
 *   - buildMinimalRgbIccProfile()   display (`mntr`) RGB, matrix / TRC   — PDF/A custom intent
 *   - buildSyntheticGrayProfile()   output (`prtr`) Gray, 408 bytes      — PDF/X-4, Gray intent
 *   - buildSyntheticCmykProfile()   output (`prtr`) CMYK, ~10 KB         — PDF/X-4, CMYK intent
 *
 * The Gray and CMYK builders are ports of pdfnative-cli's
 * scripts/lib/synthetic-gray-profile.ts and pdfnative's
 * scripts/lib/synthetic-cmyk-profile.ts (neither ships in an npm package).
 * All three are deterministic: the same bytes on every run.
 */

/**
 * Minimal valid RGB ICC v2 profile (custom OutputIntent entry).
 *
 * Structurally the same display-class matrix/TRC profile pdfnative emits for
 * its built-in sRGB intent (9 tags: desc, wtpt, cprt, rXYZ/gXYZ/bXYZ, rTRC/
 * gTRC/bTRC), with a distinct description so the corpus file is recognisably
 * a caller-supplied intent. veraPDF parses the ICC header and tag table
 * (ISO 19005 6.2.2 / 6.2.3), so a bare 128-byte header would not do.
 */
export function buildMinimalRgbIccProfile(description = 'Corpus RGB'): string {
    const tags: Array<[string, Buffer]> = [];
    const typeTag = (sig: string, body: Buffer): Buffer => Buffer.concat([Buffer.from(sig, 'ascii'), Buffer.alloc(4), body]);
    const s15 = (v: number): Buffer => {
        const b = Buffer.alloc(4);
        b.writeInt32BE(Math.round(v * 65536));
        return b;
    };
    const xyz = (x: number, y: number, z: number): Buffer => typeTag('XYZ ', Buffer.concat([s15(x), s15(y), s15(z)]));
    // desc: ascii count + ascii (NUL-terminated) + unicode code/count (8) +
    // scriptcode code/count (3) + 67-byte scriptcode field.
    const descBody = Buffer.alloc(4 + description.length + 1 + 8 + 3 + 67);
    descBody.writeUInt32BE(description.length + 1, 0);
    descBody.write(description, 4, 'ascii');
    tags.push(['desc', typeTag('desc', descBody)]);
    tags.push(['wtpt', xyz(0.9642, 1.0, 0.8249)]);
    tags.push(['cprt', typeTag('text', Buffer.from('No Copyright\0', 'ascii'))]);
    tags.push(['rXYZ', xyz(0.4361, 0.2225, 0.0139)]);
    tags.push(['gXYZ', xyz(0.3851, 0.7169, 0.0971)]);
    tags.push(['bXYZ', xyz(0.1431, 0.0606, 0.7141)]);
    const curv = Buffer.alloc(4 + 2); // count = 1 → single u8Fixed8 gamma value
    curv.writeUInt32BE(1, 0);
    curv.writeUInt16BE(563, 4); // gamma 2.2 as u8Fixed8
    const trc = typeTag('curv', curv);
    for (const sig of ['rTRC', 'gTRC', 'bTRC']) tags.push([sig, trc]);

    const table = Buffer.alloc(4 + tags.length * 12);
    table.writeUInt32BE(tags.length, 0);
    let offset = 128 + table.length;
    const bodies: Buffer[] = [];
    tags.forEach(([sig, body], i) => {
        const padded = Buffer.concat([body, Buffer.alloc((4 - (body.length % 4)) % 4)]);
        table.write(sig, 4 + i * 12, 'ascii');
        table.writeUInt32BE(offset, 8 + i * 12);
        table.writeUInt32BE(body.length, 12 + i * 12);
        bodies.push(padded);
        offset += padded.length;
    });
    const header = Buffer.alloc(128);
    header.writeUInt32BE(offset, 0); // profile size
    header.writeUInt8(2, 8); // version 2.1.0
    header.writeUInt8(0x10, 9);
    header.write('mntr', 12, 'ascii'); // display device class
    header.write('RGB ', 16, 'ascii'); // data colour space
    header.write('XYZ ', 20, 'ascii'); // PCS
    header.writeUInt16BE(2025, 24); // creation year
    header.writeUInt16BE(1, 26);
    header.writeUInt16BE(1, 28);
    header.write('acsp', 36, 'ascii');
    header.write('MSFT', 40, 'ascii');
    header.writeUInt32BE(63190, 68); // illuminant D50
    header.writeUInt32BE(65536, 72);
    header.writeUInt32BE(54061, 76);
    return Buffer.concat([header, table, ...bodies]).toString('base64');
}

// ── Output (prtr) profiles ───────────────────────────────────────────

/** Growable big-endian byte writer. */
class Bytes {
    private readonly parts: number[] = [];
    get length(): number { return this.parts.length; }
    u8(v: number): this { this.parts.push(v & 0xFF); return this; }
    u16(v: number): this { return this.u8(v >> 8).u8(v); }
    u32(v: number): this { return this.u8(v >>> 24).u8(v >>> 16).u8(v >>> 8).u8(v); }
    s15f16(v: number): this { return this.u32(Math.round(v * 65536) >>> 0); }
    sig(s: string): this { for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i)); return this; }
    zeros(n: number): this { for (let i = 0; i < n; i++) this.u8(0); return this; }
    ascii(s: string): this { for (const ch of s) this.u8(ch.charCodeAt(0)); return this; }
    bytes(b: readonly number[]): this { for (const v of b) this.u8(v); return this; }
    pad4(): this { while (this.parts.length % 4) this.u8(0); return this; }
    toArray(): number[] { return this.parts; }
}

const D50 = [0.9642, 1.0, 0.8249] as const;
const COPYRIGHT = 'No copyright, use freely';
export const GRAY_PROFILE_DESCRIPTION = 'pdfnative synthetic Gray (samples only, not a press condition)';
export const CMYK_PROFILE_DESCRIPTION = 'pdfnative synthetic CMYK (samples only, not a press condition)';

/** ICC v2 textDescriptionType: ASCII, then empty Unicode and ScriptCode records. */
function textDescription(text: string): number[] {
    return new Bytes().sig('desc').zeros(4).u32(text.length + 1).ascii(text).u8(0)
        .u32(0).u32(0).u16(0).u8(0).zeros(67).toArray();
}

/** ICC v4 multiLocalizedUnicodeType with one en-US record (UTF-16BE). */
function multiLocalized(text: string): number[] {
    const w = new Bytes().sig('mluc').zeros(4).u32(1).u32(12).ascii('enUS').u32(text.length * 2).u32(28);
    for (const ch of text) w.u16(ch.charCodeAt(0));
    return w.toArray();
}

/** Header + tag table + tag data, with every tag 4-byte aligned. */
function assembleProfile(version: number, dataSpace: string, pcs: string, tags: ReadonlyArray<readonly [string, number[]]>): Uint8Array {
    const tableSize = 4 + tags.length * 12;
    const base = 128 + tableSize;
    const table = new Bytes().u32(tags.length);
    const data = new Bytes();
    for (const [sig, body] of tags) {
        data.pad4();
        table.sig(sig).u32(base + data.length).u32(body.length);
        data.bytes(body);
    }
    data.pad4();
    const header = new Bytes()
        .u32(base + data.length).zeros(4).u32(version).sig('prtr').sig(dataSpace).sig(pcs)
        .u16(2026).u16(1).u16(1).u16(0).u16(0).u16(0)
        .sig('acsp').zeros(4).u32(0).zeros(4).zeros(4).zeros(8).u32(0)
        .s15f16(D50[0]).s15f16(D50[1]).s15f16(D50[2])
        .zeros(4).zeros(44);
    return new Uint8Array([...header.toArray(), ...table.toArray(), ...data.toArray()]);
}

export interface GrayProfileOptions {
    /** ICC major version: 2 (v2.1, the default) or 4 (v4.2 — the PDF/A-1 canary: ISO 19005-1 §6.2.2 refuses it). */
    readonly version?: 2 | 4;
}

/**
 * Synthetic Gray output profile (`prtr`, `GRAY` data, XYZ connection space)
 * carrying the four tags a monochrome output profile requires: `desc`, `cprt`,
 * `wtpt` and the gray tone curve `kTRC` (gamma 2.2). 408 bytes for v2.
 *
 * It is the only way to exercise a Gray OutputIntent (`/N 1`) and the
 * `PDFX_DEVICE_CMYK` diagnostic (CMYK content under a non-CMYK PDF/X intent).
 */
export function buildSyntheticGrayProfile(opts: GrayProfileOptions = {}): Uint8Array {
    const v4 = opts.version === 4;
    return assembleProfile(v4 ? 0x04200000 : 0x02100000, 'GRAY', 'XYZ ', [
        ['desc', v4 ? multiLocalized(GRAY_PROFILE_DESCRIPTION) : textDescription(GRAY_PROFILE_DESCRIPTION)],
        ['cprt', v4 ? multiLocalized(COPYRIGHT) : new Bytes().sig('text').zeros(4).ascii(COPYRIGHT).u8(0).toArray()],
        ['wtpt', new Bytes().sig('XYZ ').zeros(4).s15f16(D50[0]).s15f16(D50[1]).s15f16(D50[2]).toArray()],
        // curveType with one entry: a u8Fixed8 gamma (2.2 → 0x0233).
        ['kTRC', new Bytes().sig('curv').zeros(4).u32(1).u16(0x0233).toArray()],
    ]);
}

// sRGB primaries adapted to D50 (the ICC sRGB profile's colorants).
const RGB_TO_XYZ = [
    [0.4360, 0.3851, 0.1431],
    [0.2225, 0.7169, 0.0606],
    [0.0139, 0.0971, 0.7141],
] as const;
const XYZ_TO_RGB = [
    [3.1339, -1.6169, -0.4906],
    [-0.9788, 1.9161, 0.0335],
    [0.0719, -0.2290, 1.4052],
] as const;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const labF = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const labFInv = (t: number): number => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
const dot = (row: readonly [number, number, number], v: readonly number[]): number => row[0] * (v[0] ?? 0) + row[1] * (v[1] ?? 0) + row[2] * (v[2] ?? 0);

function cmykToLab(c: number, m: number, y: number, k: number): [number, number, number] {
    const rgb = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)].map(toLinear);
    const xyz = RGB_TO_XYZ.map((row) => dot(row, rgb));
    const fx = labF((xyz[0] ?? 0) / D50[0]);
    const fy = labF((xyz[1] ?? 0) / D50[1]);
    const fz = labF((xyz[2] ?? 0) / D50[2]);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToCmyk(L: number, a: number, b: number): [number, number, number, number] {
    const fy = (L + 16) / 116;
    const xyz = [labFInv(fy + a / 500) * D50[0], labFInv(fy) * D50[1], labFInv(fy - b / 200) * D50[2]];
    const rgb = XYZ_TO_RGB.map((row) => clamp01(toGamma(clamp01(dot(row, xyz)))));
    const [r = 0, g = 0, bl = 0] = rgb;
    const k = 1 - Math.max(r, g, bl);
    if (k >= 1) return [0, 0, 0, 1];
    return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - bl - k) / (1 - k), k];
}

/** lut8Type Lab encoding: L 0–100 → 0–255, a/b −128–127 → 0–255. */
const encodeLab = ([L, a, b]: readonly [number, number, number]): number[] => [
    Math.round(clamp01(L / 100) * 255),
    Math.round(Math.max(-128, Math.min(127, a)) + 128),
    Math.round(Math.max(-128, Math.min(127, b)) + 128),
];
const decodeLab = (bytes: readonly number[]): [number, number, number] => [((bytes[0] ?? 0) * 100) / 255, (bytes[1] ?? 0) - 128, (bytes[2] ?? 0) - 128];

/** A lut8Type tag: identity curves and matrix around a sampled CLUT. */
function lut8(inCh: number, outCh: number, grid: number, sample: (inputs: number[]) => number[]): number[] {
    const w = new Bytes().sig('mft1').zeros(4).u8(inCh).u8(outCh).u8(grid).u8(0);
    for (const v of [1, 0, 0, 0, 1, 0, 0, 0, 1]) w.s15f16(v);
    for (let c = 0; c < inCh; c++) for (let i = 0; i < 256; i++) w.u8(i);
    // CLUT: the first input channel varies slowest.
    const total = grid ** inCh;
    for (let n = 0; n < total; n++) {
        const inputs: number[] = [];
        let rest = n;
        for (let c = inCh - 1; c >= 0; c--) {
            inputs[c] = Math.round(((rest % grid) * 255) / (grid - 1));
            rest = Math.floor(rest / grid);
        }
        w.bytes(sample(inputs));
    }
    for (let c = 0; c < outCh; c++) for (let i = 0; i < 256; i++) w.u8(i);
    return w.toArray();
}

/**
 * Synthetic CMYK output profile (`prtr`, CMYK data, Lab connection space),
 * structurally complete — `desc`, `cprt`, `wtpt` and the `A2B0`, `B2A0` and
 * `gamt` lookup tables an output profile requires — so validators accept it.
 * Its transform is the naive device conversion (CMYK ↔ sRGB ↔ CIELAB / D50).
 */
export function buildSyntheticCmykProfile(): Uint8Array {
    const unit = (v: number | undefined): number => (v ?? 0) / 255;
    return assembleProfile(0x02100000, 'CMYK', 'Lab ', [
        ['desc', textDescription(CMYK_PROFILE_DESCRIPTION)],
        ['cprt', new Bytes().sig('text').zeros(4).ascii(COPYRIGHT).u8(0).toArray()],
        ['wtpt', new Bytes().sig('XYZ ').zeros(4).s15f16(D50[0]).s15f16(D50[1]).s15f16(D50[2]).toArray()],
        ['A2B0', lut8(4, 3, 5, ([c, m, y, k]) => encodeLab(cmykToLab(unit(c), unit(m), unit(y), unit(k))))],
        ['B2A0', lut8(3, 4, 9, (lab) => labToCmyk(...decodeLab(lab)).map((v) => Math.round(clamp01(v) * 255)))],
        ['gamt', lut8(3, 1, 2, () => [0])],
    ]);
}

/** Base64 of a profile, as the `outputIntent.iccProfileBase64` input takes it. */
export function iccBase64(profile: Uint8Array): string {
    return Buffer.from(profile).toString('base64');
}
