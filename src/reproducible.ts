/**
 * Operator-pinned creation instant (`PDFNATIVE_MCP_CREATION_DATE`, then
 * `SOURCE_DATE_EPOCH`) — pdfnative >= 1.8 `setDefaultCreationDate()`.
 *
 * The engine writes every date in UTC, and the trailer `/ID` is a hash of
 * title + creation date + object count, so pinning one instant makes
 * unencrypted output a pure function of its inputs — on every host, whatever
 * its time zone. A tool call pins it per document with `creationDate`; this
 * module lets the OPERATOR pin it for the whole process, which is what a
 * reproducible build, a golden-file test suite or a regulated archive wants
 * without trusting every caller to remember the argument.
 *
 * Precedence, highest first (the same order as pdfnative-cli):
 *   1. `creationDate` on the tool call          — per document, resolved by the engine
 *   2. `PDFNATIVE_MCP_CREATION_DATE`            — ISO 8601 with a time zone, as the tool input
 *   3. `SOURCE_DATE_EPOCH`                      — reproducible-builds.org: integer seconds
 *   4. the wall clock                           — the historical behaviour
 *
 * Read exactly once in `src/cli.ts`; tool arguments can never change it. An
 * unparsable value refuses to start the server (mirrors `readInflateCap`):
 * silently falling back to the wall clock would defeat the convention while
 * the operator believes the output is pinned.
 *
 * What the pin does NOT cover, because those instants or bytes have a meaning
 * of their own: `signingTime` (sign_pdf, prepare_signature_placeholder),
 * `modDate` (update_metadata) and the regenerated second `/ID` of incremental
 * writers (annotate_pdf, fill_form), RFC 3161 timestamp tokens and online
 * revocation data, encryption (fresh file key, salts and IVs), and ECDSA
 * signatures (randomised by design).
 */
import { getDefaultCreationDate, setDefaultCreationDate } from 'pdfnative';
import { z } from 'zod';

export const CREATION_DATE_ENV = 'PDFNATIVE_MCP_CREATION_DATE';
export const SOURCE_DATE_EPOCH_ENV = 'SOURCE_DATE_EPOCH';

/** The same validator as the `creationDate` tool input, so operator and caller values parse identically. */
const IsoInstant = z.string().datetime({ offset: true });

export interface PinnedCreationDate {
    readonly date: Date;
    /** The variable the instant came from — logged at boot, never the value of any other variable. */
    readonly source: typeof CREATION_DATE_ENV | typeof SOURCE_DATE_EPOCH_ENV;
}

/**
 * Parse the configured pin. `null` when neither variable is set (or both are
 * empty); throws on a value that is not what its convention requires.
 */
export function readPinnedCreationDate(env: NodeJS.ProcessEnv = process.env): PinnedCreationDate | null {
    const iso = env[CREATION_DATE_ENV];
    if (iso !== undefined && iso.trim() !== '') {
        const parsed = IsoInstant.safeParse(iso.trim());
        const date = parsed.success ? new Date(parsed.data) : null;
        if (date === null || Number.isNaN(date.getTime())) {
            throw new Error(`${CREATION_DATE_ENV} must be an ISO 8601 instant with a time zone (e.g. 2026-01-01T00:00:00Z); got "${iso}".`);
        }
        return { date, source: CREATION_DATE_ENV };
    }
    const epoch = env[SOURCE_DATE_EPOCH_ENV];
    if (epoch !== undefined && epoch.trim() !== '') {
        if (!/^\d{1,12}$/.test(epoch.trim())) {
            throw new Error(`${SOURCE_DATE_EPOCH_ENV} must be an integer number of seconds since the Unix epoch (reproducible-builds.org); got "${epoch}".`);
        }
        return { date: new Date(Number(epoch.trim()) * 1000), source: SOURCE_DATE_EPOCH_ENV };
    }
    return null;
}

/**
 * Read the environment and pin the engine's default creation instant.
 * Returns what was pinned, or `null` when nothing was (wall clock).
 */
export function applyPinnedCreationDate(env: NodeJS.ProcessEnv = process.env): PinnedCreationDate | null {
    const pin = readPinnedCreationDate(env);
    if (pin !== null) setDefaultCreationDate(pin.date);
    return pin;
}

/**
 * Cache-namespace suffix for the pin in force. It is read from the engine, not
 * kept here, so there is one source of truth: a response cached under one
 * pinned instant must never be served under another (or under none).
 */
export function creationDateCacheTag(): string {
    const pinned = getDefaultCreationDate();
    return pinned === null ? '' : `/cd=${pinned.getTime()}`;
}
