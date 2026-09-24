/**
 * Seeded fuzzing helpers — deterministic by construction.
 *
 * A fuzz suite that uses `Math.random()` finds a bug once and never again.
 * Every generator here draws from mulberry32 with a fixed seed, so a failure
 * reproduces on every machine from the case number alone, and the suite has
 * the same cost on every run. No dependency: the PRNG is eight lines.
 */

/** mulberry32: a small, well-distributed 32-bit PRNG. */
export function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export interface Rng {
    readonly next: () => number;
    readonly int: (min: number, max: number) => number;
    readonly bool: (p?: number) => boolean;
    readonly pick: <T>(items: readonly T[]) => T;
    readonly some: <T>(items: readonly T[]) => T[];
    readonly float: (min: number, max: number) => number;
}

export function rng(seed: number): Rng {
    const next = prng(seed);
    const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
    return {
        next,
        int,
        bool: (p = 0.5) => next() < p,
        pick: <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T,
        some: <T>(items: readonly T[]): T[] => items.filter(() => next() < 0.5),
        float: (min, max) => min + next() * (max - min),
    };
}

/** Values that break naive validators: wrong types, extremes, prototype keys, odd strings. */
export const HOSTILE_VALUES: readonly unknown[] = [
    null, true, false, 0, -1, 1, 1.5, -0, 1e21, -1e21, Number.MAX_SAFE_INTEGER, NaN, Infinity,
    '', ' ', 'null', 'undefined', '__proto__', 'constructor', '0', '-1', '1e9', '#', '#fff', '#ffffff', '#gggggg',
    '0 0 0', '0 0 0 0', '1 1 1 1', '2 0 0 0', '0 0 0 0 0', '0,0,0,0', '1e-3 0 0 0', ' 0 0 0 0', '0 0 0 0 ',
    '\u0000', '‮', '\ud800', 'a'.repeat(300), '<script>', '../../etc/passwd', 'data:,x',
    [], [0], [0, 0, 0], [0, 0, 0, 0], [100, 100, 100, 100], [101, 0, 0, 0], [-1, 0, 0, 0], [0, 0, 0, 0, 0], ['0', '0', '0', '0'], [null, null, null, null],
    {}, { __proto__: null }, { constructor: 1 }, { length: 4 },
];

const ERROR_LINE = / failed \[([A-Z][A-Z0-9_]+)\]: /;

export interface FuzzResult {
    readonly isError?: boolean;
    readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
}

/** The ToolError code of a failed call, or null when the failure carries none (an unexpected throw). */
export function errorCodeOf(result: FuzzResult): string | null {
    const text = result.content.find((c) => c.type === 'text')?.text ?? '';
    return ERROR_LINE.exec(text)?.[1] ?? null;
}

/** Flip, truncate or overwrite bytes of a buffer, deterministically. */
export function mutate(bytes: Uint8Array, r: Rng): Uint8Array {
    const out = new Uint8Array(bytes);
    switch (r.int(0, 4)) {
        case 0: // truncate
            return out.subarray(0, r.int(0, Math.max(0, out.length - 1)));
        case 1: // flip a few bytes anywhere
            for (let i = 0; i < r.int(1, 8); i++) out[r.int(0, out.length - 1)] = r.int(0, 255);
            return out;
        case 2: // corrupt the head (headers, signatures, sizes live there)
            for (let i = 0; i < r.int(1, 6); i++) out[r.int(0, Math.min(out.length - 1, 131))] = r.int(0, 255);
            return out;
        case 3: // zero a window
            out.fill(0, r.int(0, out.length - 1), r.int(0, out.length));
            return out;
        default: { // duplicate a slice at the end
            const at = r.int(0, out.length - 1);
            return new Uint8Array([...out, ...out.subarray(at, Math.min(out.length, at + r.int(1, 64)))]);
        }
    }
}
