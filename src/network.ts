/**
 * Operator-configured network egress for PAdES long-term validation.
 *
 * pdfnative never opens a socket: RFC 3161 timestamping and OCSP / CRL
 * collection go through injected providers. This server mirrors that
 * contract at the deployment boundary — **no outbound request is ever made
 * unless the operator configures an endpoint**:
 *
 * | Variable                              | Purpose                                           |
 * |---------------------------------------|---------------------------------------------------|
 * | `PDFNATIVE_MCP_TSA_URL`               | RFC 3161 endpoint (POST application/timestamp-query) |
 * | `PDFNATIVE_MCP_TSA_AUTH`              | Optional `Authorization` header value for the TSA  |
 * | `PDFNATIVE_MCP_REVOCATION`            | `ocsp`, `crl` or `ocsp,crl` — enables collection   |
 * | `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS` | Allow-list for OCSP / CRL hosts (mandatory)        |
 * | `PDFNATIVE_MCP_NETWORK_TIMEOUT_MS`    | Per-request timeout, 1000..120000 (default 10000)  |
 *
 * Threat model: OCSP / CRL URLs come from the **AIA / CRL-distribution-point
 * extensions of untrusted certificates inside the PDF** — a classic SSRF
 * vector. They are therefore only fetched when the host matches the
 * operator allow-list, never over anything but http(s), never with embedded
 * credentials, never following redirects, and never to loopback, link-local,
 * private, unique-local, unspecified or multicast address literals unless
 * that literal is allow-listed verbatim. The TSA URL is operator-trusted
 * (the operator chose it), so loopback is permitted there.
 *
 * Providers are built per call and passed through pdfnative's per-call
 * options; the process-wide `setTimestampProvider` / `setRevocationProvider`
 * are never used, so concurrent requests share nothing. Tool arguments can
 * never supply a URL.
 */
import { isIP } from 'node:net';
import type { RevocationProvider, TimestampProvider } from 'pdfnative';

import { ToolError } from './errors.js';

export const TSA_URL_ENV = 'PDFNATIVE_MCP_TSA_URL';
export const TSA_AUTH_ENV = 'PDFNATIVE_MCP_TSA_AUTH';
export const REVOCATION_ENV = 'PDFNATIVE_MCP_REVOCATION';
export const ALLOWED_HOSTS_ENV = 'PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS';
export const TIMEOUT_ENV = 'PDFNATIVE_MCP_NETWORK_TIMEOUT_MS';

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
/** Response-size caps (bytes) — a TimeStampResp is a few KiB, a CRL can be large. */
const MAX_TSA_RESPONSE = 256 * 1024;
const MAX_OCSP_RESPONSE = 1024 * 1024;
const MAX_CRL_RESPONSE = 16 * 1024 * 1024;

type FetchLike = typeof fetch;
let fetchImpl: FetchLike = (...args) => globalThis.fetch(...args);

/** Test seam: substitute the fetch implementation (restore with `null`). */
export function __setFetchForTests(impl: FetchLike | null): void {
    fetchImpl = impl ?? ((...args) => globalThis.fetch(...args));
}

export interface TsaConfig {
    readonly url: URL;
    readonly authorization: string | null;
    readonly timeoutMs: number;
}

export interface RevocationConfig {
    readonly ocsp: boolean;
    readonly crl: boolean;
    readonly allowedHosts: readonly string[];
    readonly timeoutMs: number;
}

/* -------------------------------------------------------------------------- */
/* Environment parsing                                                        */
/* -------------------------------------------------------------------------- */

function readTimeout(): number {
    const raw = process.env[TIMEOUT_ENV];
    if (raw === undefined || raw.trim() === '') return DEFAULT_TIMEOUT_MS;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < MIN_TIMEOUT_MS || n > MAX_TIMEOUT_MS) {
        throw new ToolError('NETWORK_ERROR', `${TIMEOUT_ENV} must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} (got '${raw}').`);
    }
    return n;
}

/**
 * Parse the comma-separated allow-list. Entries are hostnames, `host:port`,
 * or `*.suffix` wildcards. Each entry is canonicalised the way the WHATWG URL
 * parser canonicalises request URLs (lower-case, IDN → punycode, IPv6 in
 * brackets, default ports dropped) so that `bücher.example.com`, `::1` or
 * `example.com:80` match what certificates actually advertise.
 *
 * The guard checks address *literals* and hostnames only — a listed hostname
 * that resolves to an internal address (DNS rebinding) is not detected.
 */
export function parseAllowedHosts(raw: string | undefined): string[] {
    if (raw === undefined) return [];
    const out: string[] = [];
    for (const item of raw.split(',')) {
        const entry = item.trim().toLowerCase();
        if (entry === '') continue;
        if (entry === '*' || entry === '*.' || entry.includes('/') || /\s/.test(entry)) {
            throw new ToolError('NETWORK_ERROR', `${ALLOWED_HOSTS_ENV}: invalid entry '${item.trim()}' (bare wildcards and paths are not allowed).`);
        }
        out.push(canonicalHostEntry(entry, item.trim()));
    }
    return out;
}

/** Canonicalise one allow-list entry through the URL parser (wildcard prefix preserved). */
function canonicalHostEntry(entry: string, original: string): string {
    const wildcard = entry.startsWith('*.');
    let bare = wildcard ? entry.slice(2) : entry;
    // A bare IPv6 literal (`::1`) must be bracketed for the URL parser.
    if (!bare.startsWith('[') && isIP(bare) === 6) bare = `[${bare}]`;
    let parsed: URL;
    try {
        parsed = new URL(`http://${bare}/`);
    } catch {
        throw new ToolError('NETWORK_ERROR', `${ALLOWED_HOSTS_ENV}: invalid entry '${original}'.`);
    }
    if (parsed.username !== '' || parsed.password !== '' || parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
        throw new ToolError('NETWORK_ERROR', `${ALLOWED_HOSTS_ENV}: invalid entry '${original}' (host or host:port only).`);
    }
    if (wildcard && parsed.port !== '') {
        throw new ToolError('NETWORK_ERROR', `${ALLOWED_HOSTS_ENV}: wildcard entry '${original}' cannot carry a port.`);
    }
    // URL.host keeps an explicit non-default port and brackets IPv6 literals.
    return wildcard ? `*.${parsed.hostname}` : parsed.host;
}

/** TSA configuration from the environment, or `null` when timestamping is disabled. */
export function getTsaConfig(): TsaConfig | null {
    const raw = process.env[TSA_URL_ENV];
    if (raw === undefined || raw.trim() === '') return null;
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        throw new ToolError('TSA_NOT_CONFIGURED', `${TSA_URL_ENV} is not an absolute URL.`);
    }
    assertUrlAllowed(url, { trusted: true, allowedHosts: [] });
    const auth = process.env[TSA_AUTH_ENV];
    return {
        url,
        authorization: auth !== undefined && auth.trim() !== '' ? auth.trim() : null,
        timeoutMs: readTimeout(),
    };
}

/** Revocation configuration from the environment, or `null` when collection is disabled. */
export function getRevocationConfig(): RevocationConfig | null {
    const raw = process.env[REVOCATION_ENV];
    if (raw === undefined || raw.trim() === '') return null;
    const methods = raw
        .split(',')
        .map((m) => m.trim().toLowerCase())
        .filter((m) => m !== '');
    for (const m of methods) {
        if (m !== 'ocsp' && m !== 'crl') {
            throw new ToolError('REVOCATION_NOT_CONFIGURED', `${REVOCATION_ENV} accepts 'ocsp', 'crl' or 'ocsp,crl' (got '${raw}').`);
        }
    }
    const allowedHosts = parseAllowedHosts(process.env[ALLOWED_HOSTS_ENV]);
    if (allowedHosts.length === 0) {
        throw new ToolError(
            'REVOCATION_NOT_CONFIGURED',
            `${REVOCATION_ENV} is set but ${ALLOWED_HOSTS_ENV} is empty: OCSP/CRL URLs come from untrusted certificates and are only fetched from allow-listed hosts.`,
        );
    }
    return { ocsp: methods.includes('ocsp'), crl: methods.includes('crl'), allowedHosts, timeoutMs: readTimeout() };
}

/* -------------------------------------------------------------------------- */
/* URL policy (SSRF guard)                                                    */
/* -------------------------------------------------------------------------- */

/** True when `host` (an IP literal) must never be reached from a certificate-supplied URL. */
export function isForbiddenAddress(host: string): boolean {
    const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
    const family = isIP(bare);
    if (family === 4) return isForbiddenIpv4(bare);
    if (family === 6) return isForbiddenIpv6(bare);
    // Not a canonical literal: reject decimal / octal / hex spellings that resolve to an IP.
    return /^(0x[0-9a-f]+|\d+)$/i.test(bare) || /^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){1,3}$/i.test(bare);
}

function isForbiddenIpv4(ip: string): boolean {
    const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
    const [a, b] = parts as [number, number, number, number];
    if (a === 0) return true; // unspecified / "this" network
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT shared space
    if (a >= 224) return true; // multicast / reserved / broadcast
    return false;
}

function isForbiddenIpv6(ip: string): boolean {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fe80:') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('ff')) return true; // multicast
    // IPv4-mapped / compatible (::ffff:a.b.c.d or ::ffff:xxxx:xxxx) — reject outright.
    if (lower.startsWith('::ffff:') || lower.startsWith('::')) return true;
    return false;
}

function hostMatchesAllowList(url: URL, allowed: readonly string[]): boolean {
    const h = url.hostname.toLowerCase(); // IPv6 without brackets, IDN as punycode
    const bracketed = url.host.startsWith('[') ? url.host.split(']')[0] + ']' : h; // hostname as it appears in URL.host
    for (const entry of allowed) {
        if (entry.startsWith('*.')) {
            const suffix = entry.slice(1); // ".example.com"
            if (h.endsWith(suffix) && h.length > suffix.length) return true;
            continue;
        }
        // Entry without a port matches any port; entry with a port must match URL.host exactly.
        if (entry === bracketed || entry === url.host) return true;
    }
    return false;
}

/**
 * Enforce the egress policy on a URL. `trusted` marks an operator-supplied
 * URL (the TSA): scheme + credential checks only. Certificate-supplied URLs
 * (OCSP / CRL) must additionally match the allow-list and avoid internal
 * address literals.
 */
export function assertUrlAllowed(url: URL, policy: { trusted: boolean; allowedHosts: readonly string[] }): void {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new ToolError('NETWORK_HOST_NOT_ALLOWED', `Only http(s) URLs are allowed (got '${url.protocol}').`);
    }
    if (url.username !== '' || url.password !== '') {
        throw new ToolError('NETWORK_HOST_NOT_ALLOWED', 'URLs with embedded credentials are not allowed.');
    }
    if (policy.trusted) return;
    const hostname = url.hostname.toLowerCase();
    const listed = hostMatchesAllowList(url, policy.allowedHosts);
    if (!listed) {
        throw new ToolError('NETWORK_HOST_NOT_ALLOWED', `Host '${url.host}' is not in ${ALLOWED_HOSTS_ENV}.`);
    }
    // An IP literal must be listed verbatim (not via a wildcard) to reach an internal range.
    const bracketed = url.host.startsWith('[') ? url.host.split(']')[0] + ']' : hostname;
    const verbatim = policy.allowedHosts.some((e) => e === bracketed || e === url.host);
    if (!verbatim && isForbiddenAddress(hostname)) {
        throw new ToolError('NETWORK_HOST_NOT_ALLOWED', `Host '${url.host}' is a loopback / link-local / private address and is not allow-listed verbatim.`);
    }
}

/* -------------------------------------------------------------------------- */
/* Fetch wrapper                                                              */
/* -------------------------------------------------------------------------- */

async function fetchBytes(
    url: URL,
    init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: Uint8Array },
    timeoutMs: number,
    maxBytes: number,
    what: string,
): Promise<Uint8Array> {
    let response: Response;
    try {
        response = await fetchImpl(url, {
            method: init.method,
            headers: init.headers,
            ...(init.body !== undefined ? { body: init.body } : {}),
            redirect: 'error',
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (err) {
        throw new ToolError('NETWORK_ERROR', `${what}: request to ${url.host} failed (${describeFetchError(err)}).`);
    }
    if (!response.ok) {
        throw new ToolError('NETWORK_ERROR', `${what}: ${url.host} answered HTTP ${response.status}.`);
    }
    const declared = response.headers.get('content-length');
    if (declared !== null && Number.parseInt(declared, 10) > maxBytes) {
        throw new ToolError('NETWORK_ERROR', `${what}: response from ${url.host} exceeds ${maxBytes} bytes.`);
    }
    return readBodyCapped(response, maxBytes, url.host, what);
}

/**
 * Read a response body while enforcing the size cap *as bytes arrive*, so an
 * unsized (chunked) response from a misbehaving host cannot make the server
 * buffer more than `maxBytes` before being rejected.
 */
async function readBodyCapped(response: Response, maxBytes: number, host: string, what: string): Promise<Uint8Array> {
    const body = response.body;
    if (body === null) return new Uint8Array(0);
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel().catch(() => undefined);
                throw new ToolError('NETWORK_ERROR', `${what}: response from ${host} exceeds ${maxBytes} bytes.`);
            }
            chunks.push(value);
        }
    } catch (err) {
        if (err instanceof ToolError) throw err;
        throw new ToolError('NETWORK_ERROR', `${what}: reading the response from ${host} failed (${describeFetchError(err)}).`);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.byteLength;
    }
    return out;
}

/** Never echo header values (the TSA Authorization secret) — only the error class / name. */
function describeFetchError(err: unknown): string {
    if (err instanceof Error) {
        if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timeout';
        const cause = (err as { cause?: { code?: string } }).cause;
        return cause?.code ?? err.name;
    }
    return 'unknown error';
}

/* -------------------------------------------------------------------------- */
/* Providers                                                                  */
/* -------------------------------------------------------------------------- */

/** A pdfnative `TimestampProvider` bound to the configured TSA, or `null` when none is configured. */
export function buildTimestampProvider(config: TsaConfig | null = getTsaConfig()): TimestampProvider | null {
    if (config === null) return null;
    const { url, authorization, timeoutMs } = config;
    return {
        getTimestamp: (request: Uint8Array) =>
            fetchBytes(
                url,
                {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/timestamp-query',
                        accept: 'application/timestamp-reply',
                        ...(authorization !== null ? { authorization } : {}),
                    },
                    body: request,
                },
                timeoutMs,
                MAX_TSA_RESPONSE,
                'TSA',
            ),
    };
}

/** Resolve the TSA provider or fail with `TSA_NOT_CONFIGURED` (before any signing work). */
export function requireTimestampProvider(): TimestampProvider {
    const provider = buildTimestampProvider();
    if (provider === null) {
        throw new ToolError(
            'TSA_NOT_CONFIGURED',
            `Timestamping needs an RFC 3161 authority: set ${TSA_URL_ENV} (and optionally ${TSA_AUTH_ENV}) on the server. No network request is made otherwise.`,
        );
    }
    return provider;
}

/** A pdfnative `RevocationProvider` enforcing the allow-list, or `null` when revocation collection is disabled. */
export function buildRevocationProvider(config: RevocationConfig | null = getRevocationConfig()): RevocationProvider | null {
    if (config === null) return null;
    const policy = { trusted: false, allowedHosts: config.allowedHosts };
    const parse = (raw: string): URL => {
        let url: URL;
        try {
            url = new URL(raw);
        } catch {
            throw new ToolError('NETWORK_HOST_NOT_ALLOWED', `Certificate advertises an invalid URL.`);
        }
        assertUrlAllowed(url, policy);
        return url;
    };
    return {
        ...(config.ocsp
            ? {
                  fetchOcsp: async (rawUrl: string, request: Uint8Array) =>
                      fetchBytes(
                          parse(rawUrl),
                          { method: 'POST', headers: { 'content-type': 'application/ocsp-request', accept: 'application/ocsp-response' }, body: request },
                          config.timeoutMs,
                          MAX_OCSP_RESPONSE,
                          'OCSP',
                      ),
              }
            : {}),
        ...(config.crl
            ? {
                  fetchCrl: async (rawUrl: string) =>
                      fetchBytes(parse(rawUrl), { method: 'GET', headers: { accept: 'application/pkix-crl' } }, config.timeoutMs, MAX_CRL_RESPONSE, 'CRL'),
              }
            : {}),
    };
}

/** Resolve the revocation provider or fail with `REVOCATION_NOT_CONFIGURED` (before any work). */
export function requireRevocationProvider(): RevocationProvider {
    const provider = buildRevocationProvider();
    if (provider === null) {
        throw new ToolError(
            'REVOCATION_NOT_CONFIGURED',
            `Online revocation collection needs ${REVOCATION_ENV} ('ocsp', 'crl' or 'ocsp,crl') and ${ALLOWED_HOSTS_ENV} on the server. Use mode='offline' with caller-supplied material instead. No network request is made otherwise.`,
        );
    }
    return provider;
}

/** Human-readable egress summary for the server instructions / diagnostics (never includes secrets). */
export function describeNetworkPolicy(): string {
    const tsa = process.env[TSA_URL_ENV];
    const rev = process.env[REVOCATION_ENV];
    if ((tsa === undefined || tsa.trim() === '') && (rev === undefined || rev.trim() === '')) {
        return 'no outbound network (no TSA / revocation endpoint configured)';
    }
    const parts: string[] = [];
    if (tsa !== undefined && tsa.trim() !== '') parts.push('RFC 3161 TSA configured');
    if (rev !== undefined && rev.trim() !== '') parts.push(`revocation collection: ${rev.trim()}`);
    return parts.join('; ');
}
