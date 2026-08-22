import { describe, it, expect, afterEach, beforeEach } from 'vitest';

import {
    ALLOWED_HOSTS_ENV,
    REVOCATION_ENV,
    TIMEOUT_ENV,
    TSA_AUTH_ENV,
    TSA_URL_ENV,
    __setFetchForTests,
    assertUrlAllowed,
    buildRevocationProvider,
    buildTimestampProvider,
    describeNetworkPolicy,
    getRevocationConfig,
    getTsaConfig,
    isForbiddenAddress,
    parseAllowedHosts,
    requireRevocationProvider,
    requireTimestampProvider,
} from '../src/network.js';
import { ToolError } from '../src/errors.js';

const ENV_KEYS = [TSA_URL_ENV, TSA_AUTH_ENV, REVOCATION_ENV, ALLOWED_HOSTS_ENV, TIMEOUT_ENV];

function codeOf(fn: () => unknown): string | null {
    try {
        fn();
        return null;
    } catch (err) {
        return err instanceof ToolError ? err.code : `non-ToolError:${String(err)}`;
    }
}

describe('network policy (operator-configured egress, SSRF guard)', () => {
    beforeEach(() => {
        for (const k of ENV_KEYS) delete process.env[k];
    });
    afterEach(() => {
        for (const k of ENV_KEYS) delete process.env[k];
        __setFetchForTests(null);
    });

    it('is fully offline by default: no TSA, no revocation, no provider', () => {
        expect(getTsaConfig()).toBeNull();
        expect(getRevocationConfig()).toBeNull();
        expect(buildTimestampProvider()).toBeNull();
        expect(buildRevocationProvider()).toBeNull();
        expect(codeOf(() => requireTimestampProvider())).toBe('TSA_NOT_CONFIGURED');
        expect(codeOf(() => requireRevocationProvider())).toBe('REVOCATION_NOT_CONFIGURED');
        expect(describeNetworkPolicy()).toContain('no outbound network');
    });

    it('rejects internal address literals in certificate-supplied URLs', () => {
        const policy = { trusted: false, allowedHosts: ['*.example.com', 'ocsp.example.com'] };
        for (const host of [
            'http://127.0.0.1/ocsp',
            'http://localhost/ocsp',
            'http://10.0.0.5/ocsp',
            'http://172.16.3.4/ocsp',
            'http://192.168.1.1/ocsp',
            'http://169.254.169.254/latest/meta-data',
            'http://0.0.0.0/ocsp',
            'http://[::1]/ocsp',
            'http://[fe80::1]/ocsp',
            'http://[fd00::1]/ocsp',
            'http://[::ffff:127.0.0.1]/ocsp',
            'http://2130706433/ocsp',
            'http://0x7f000001/ocsp',
            'http://0177.0.0.1/ocsp',
            'http://100.64.0.1/ocsp',
        ]) {
            expect(codeOf(() => assertUrlAllowed(new URL(host), policy)), host).toBe('NETWORK_HOST_NOT_ALLOWED');
        }
    });

    it('rejects non-http schemes, embedded credentials and non-listed hosts', () => {
        const policy = { trusted: false, allowedHosts: ['ocsp.example.com'] };
        expect(codeOf(() => assertUrlAllowed(new URL('file:///etc/passwd'), policy))).toBe('NETWORK_HOST_NOT_ALLOWED');
        expect(codeOf(() => assertUrlAllowed(new URL('ftp://ocsp.example.com/x'), policy))).toBe('NETWORK_HOST_NOT_ALLOWED');
        expect(codeOf(() => assertUrlAllowed(new URL('http://user:pw@ocsp.example.com/x'), policy))).toBe('NETWORK_HOST_NOT_ALLOWED');
        expect(codeOf(() => assertUrlAllowed(new URL('http://evil.example.net/x'), policy))).toBe('NETWORK_HOST_NOT_ALLOWED');
        expect(codeOf(() => assertUrlAllowed(new URL('http://ocsp.example.com.evil.net/x'), policy))).toBe('NETWORK_HOST_NOT_ALLOWED');
        expect(codeOf(() => assertUrlAllowed(new URL('http://ocsp.example.com/x'), { trusted: false, allowedHosts: [] }))).toBe('NETWORK_HOST_NOT_ALLOWED');
    });

    it('accepts listed hosts, wildcard suffixes, host:port entries and verbatim IP literals', () => {
        const policy = { trusted: false, allowedHosts: ['ocsp.example.com', '*.pki.example.org', 'crl.example.net:8080', '127.0.0.1:9999'] };
        expect(codeOf(() => assertUrlAllowed(new URL('http://ocsp.example.com/x'), policy))).toBeNull();
        expect(codeOf(() => assertUrlAllowed(new URL('https://OCSP.EXAMPLE.COM/x'), policy))).toBeNull();
        expect(codeOf(() => assertUrlAllowed(new URL('http://a.pki.example.org/x'), policy))).toBeNull();
        expect(codeOf(() => assertUrlAllowed(new URL('http://pki.example.org/x'), policy))).toBe('NETWORK_HOST_NOT_ALLOWED');
        expect(codeOf(() => assertUrlAllowed(new URL('http://crl.example.net:8080/x'), policy))).toBeNull();
        expect(codeOf(() => assertUrlAllowed(new URL('http://crl.example.net/x'), policy))).toBe('NETWORK_HOST_NOT_ALLOWED');
        // Loopback is reachable only when the operator listed the literal verbatim.
        expect(codeOf(() => assertUrlAllowed(new URL('http://127.0.0.1:9999/ocsp'), policy))).toBeNull();
        expect(codeOf(() => assertUrlAllowed(new URL('http://127.0.0.1:9998/ocsp'), policy))).toBe('NETWORK_HOST_NOT_ALLOWED');
    });

    it('trusted (operator) URLs skip the allow-list but still refuse odd schemes and credentials', () => {
        expect(codeOf(() => assertUrlAllowed(new URL('http://127.0.0.1:3000/tsr'), { trusted: true, allowedHosts: [] }))).toBeNull();
        expect(codeOf(() => assertUrlAllowed(new URL('file:///tsr'), { trusted: true, allowedHosts: [] }))).toBe('NETWORK_HOST_NOT_ALLOWED');
        expect(codeOf(() => assertUrlAllowed(new URL('https://u:p@tsa.example.com/tsr'), { trusted: true, allowedHosts: [] }))).toBe('NETWORK_HOST_NOT_ALLOWED');
    });

    it('isForbiddenAddress covers the reserved ranges and alternate spellings', () => {
        for (const h of ['127.0.0.1', '10.1.1.1', '172.31.255.255', '192.168.0.1', '169.254.1.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'ff02::1', '::ffff:10.0.0.1', '2130706433', '0x7f000001', '0177.0.0.1']) {
            expect(isForbiddenAddress(h), h).toBe(true);
        }
        for (const h of ['8.8.8.8', '93.184.216.34', '2606:4700::1111', 'ocsp.example.com']) {
            expect(isForbiddenAddress(h), h).toBe(false);
        }
    });

    it('parses the allow-list and rejects bare wildcards', () => {
        expect(parseAllowedHosts(' ocsp.example.com , *.pki.example.org,,')).toEqual(['ocsp.example.com', '*.pki.example.org']);
        expect(parseAllowedHosts(undefined)).toEqual([]);
        expect(codeOf(() => parseAllowedHosts('*'))).toBe('NETWORK_ERROR');
        expect(codeOf(() => parseAllowedHosts('example.com/path'))).toBe('NETWORK_ERROR');
    });

    it('validates the environment: malformed TSA URL, revocation without allow-list, bad method, bad timeout', () => {
        process.env[TSA_URL_ENV] = 'not a url';
        expect(codeOf(() => getTsaConfig())).toBe('TSA_NOT_CONFIGURED');
        process.env[TSA_URL_ENV] = 'ftp://tsa.example.com/tsr';
        expect(codeOf(() => getTsaConfig())).toBe('NETWORK_HOST_NOT_ALLOWED');
        delete process.env[TSA_URL_ENV];

        process.env[REVOCATION_ENV] = 'ocsp';
        expect(codeOf(() => getRevocationConfig())).toBe('REVOCATION_NOT_CONFIGURED');
        process.env[ALLOWED_HOSTS_ENV] = 'ocsp.example.com';
        expect(getRevocationConfig()).toMatchObject({ ocsp: true, crl: false, allowedHosts: ['ocsp.example.com'], timeoutMs: 10_000 });
        process.env[REVOCATION_ENV] = 'ldap';
        expect(codeOf(() => getRevocationConfig())).toBe('REVOCATION_NOT_CONFIGURED');
        process.env[REVOCATION_ENV] = 'ocsp,crl';
        process.env[TIMEOUT_ENV] = '5';
        expect(codeOf(() => getRevocationConfig())).toBe('NETWORK_ERROR');
        process.env[TIMEOUT_ENV] = '2500';
        expect(getRevocationConfig()).toMatchObject({ ocsp: true, crl: true, timeoutMs: 2500 });
    });

    it('TSA provider posts the DER request with the right content type and optional Authorization, never following redirects', async () => {
        process.env[TSA_URL_ENV] = 'https://tsa.example.com/tsr';
        process.env[TSA_AUTH_ENV] = 'Bearer s3cret';
        const calls: Array<{ url: string; init: RequestInit }> = [];
        __setFetchForTests(async (input, init) => {
            calls.push({ url: String(input), init: init ?? {} });
            return new Response(new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x00]), { status: 200, headers: { 'content-type': 'application/timestamp-reply' } });
        });
        const provider = requireTimestampProvider();
        const out = await provider.getTimestamp(new Uint8Array([1, 2, 3]));
        expect(Array.from(out)).toEqual([0x30, 0x03, 0x02, 0x01, 0x00]);
        expect(calls).toHaveLength(1);
        const { url, init } = calls[0]!;
        expect(url).toBe('https://tsa.example.com/tsr');
        expect(init.method).toBe('POST');
        expect(init.redirect).toBe('error');
        const headers = init.headers as Record<string, string>;
        expect(headers['content-type']).toBe('application/timestamp-query');
        expect(headers['authorization']).toBe('Bearer s3cret');
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(describeNetworkPolicy()).toContain('TSA');
        expect(describeNetworkPolicy()).not.toContain('s3cret');
    });

    it('maps HTTP failures, timeouts and oversized bodies to NETWORK_ERROR without leaking secrets', async () => {
        process.env[TSA_URL_ENV] = 'https://tsa.example.com/tsr';
        process.env[TSA_AUTH_ENV] = 'Basic dXNlcjpwYXNz';
        __setFetchForTests(async () => new Response('nope', { status: 500 }));
        let err = await requireTimestampProvider().getTimestamp(new Uint8Array(1)).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ToolError);
        expect((err as ToolError).code).toBe('NETWORK_ERROR');
        expect((err as ToolError).message).toContain('HTTP 500');
        expect((err as ToolError).message).not.toContain('dXNlcjpwYXNz');

        __setFetchForTests(async () => {
            const e = new Error('aborted');
            e.name = 'TimeoutError';
            throw e;
        });
        err = await requireTimestampProvider().getTimestamp(new Uint8Array(1)).catch((e: unknown) => e);
        expect((err as ToolError).code).toBe('NETWORK_ERROR');
        expect((err as ToolError).message).toContain('timeout');

        __setFetchForTests(async () => new Response(new Uint8Array(300 * 1024), { status: 200 }));
        err = await requireTimestampProvider().getTimestamp(new Uint8Array(1)).catch((e: unknown) => e);
        expect((err as ToolError).code).toBe('NETWORK_ERROR');
        expect((err as ToolError).message).toContain('exceeds');
    });

    it('revocation provider enforces the allow-list on certificate-supplied URLs and exposes only enabled methods', async () => {
        process.env[REVOCATION_ENV] = 'ocsp';
        process.env[ALLOWED_HOSTS_ENV] = 'ocsp.example.com';
        const seen: string[] = [];
        __setFetchForTests(async (input, init) => {
            seen.push(`${init?.method ?? 'GET'} ${String(input)}`);
            return new Response(new Uint8Array([0x30, 0x00]), { status: 200 });
        });
        const provider = requireRevocationProvider();
        expect(provider.fetchOcsp).toBeDefined();
        expect(provider.fetchCrl).toBeUndefined();
        await provider.fetchOcsp!('http://ocsp.example.com/', new Uint8Array([9]));
        expect(seen).toEqual(['POST http://ocsp.example.com/']);
        const blocked = await provider.fetchOcsp!('http://169.254.169.254/latest', new Uint8Array([9])).catch((e: unknown) => e);
        expect((blocked as ToolError).code).toBe('NETWORK_HOST_NOT_ALLOWED');
        const invalid = await provider.fetchOcsp!('not a url', new Uint8Array([9])).catch((e: unknown) => e);
        expect((invalid as ToolError).code).toBe('NETWORK_HOST_NOT_ALLOWED');
        expect(seen).toHaveLength(1);

        process.env[REVOCATION_ENV] = 'crl';
        process.env[ALLOWED_HOSTS_ENV] = '*.example.org';
        const crlProvider = requireRevocationProvider();
        expect(crlProvider.fetchOcsp).toBeUndefined();
        await crlProvider.fetchCrl!('http://crl.example.org/ca.crl');
        expect(seen[1]).toBe('GET http://crl.example.org/ca.crl');
    });
});

describe('network policy — review hardening (v1.6.0)', () => {
    beforeEach(() => {
        for (const k of ENV_KEYS) delete process.env[k];
    });
    afterEach(() => {
        for (const k of ENV_KEYS) delete process.env[k];
        __setFetchForTests(null);
    });

    it('enforces the size cap while streaming an unsized (chunked) body', async () => {
        process.env[TSA_URL_ENV] = 'https://tsa.example.com/tsr';
        let produced = 0;
        __setFetchForTests(async () => {
            const chunk = new Uint8Array(64 * 1024);
            const stream = new ReadableStream<Uint8Array>({
                pull(controller) {
                    produced += chunk.byteLength;
                    controller.enqueue(chunk);
                    if (produced > 64 * 1024 * 1024) controller.close();
                },
            });
            return new Response(stream, { status: 200 }); // no content-length
        });
        const err = await requireTimestampProvider().getTimestamp(new Uint8Array(1)).catch((e: unknown) => e);
        expect((err as ToolError).code).toBe('NETWORK_ERROR');
        expect((err as ToolError).message).toContain('exceeds');
        // Stopped right after crossing 256 KiB, not after the full 64 MiB.
        expect(produced).toBeLessThan(2 * 1024 * 1024);
    });

    it('maps a body read failure (e.g. timeout mid-stream) to NETWORK_ERROR', async () => {
        process.env[TSA_URL_ENV] = 'https://tsa.example.com/tsr';
        __setFetchForTests(async () => {
            const stream = new ReadableStream<Uint8Array>({
                pull() {
                    const e = new Error('aborted');
                    e.name = 'TimeoutError';
                    throw e;
                },
            });
            return new Response(stream, { status: 200 });
        });
        const err = await requireTimestampProvider().getTimestamp(new Uint8Array(1)).catch((e: unknown) => e);
        expect((err as ToolError).code).toBe('NETWORK_ERROR');
        expect((err as ToolError).message).toContain('timeout');
    });

    it('canonicalises allow-list entries: IDN → punycode, default ports dropped, IPv6 bracketed, explicit ports kept', () => {
        expect(parseAllowedHosts('bücher.example.com, EXAMPLE.com:80, ::1, [::1]:8443, ocsp.example.org:8080, *.Pki.Example.net')).toEqual([
            'xn--bcher-kva.example.com',
            'example.com',
            '[::1]',
            '[::1]:8443',
            'ocsp.example.org:8080',
            '*.pki.example.net',
        ]);
        const policy = { trusted: false, allowedHosts: parseAllowedHosts('bücher.example.com, example.com:80, ::1, ocsp.example.org:8080') };
        expect(codeOf(() => assertUrlAllowed(new URL('http://bücher.example.com/ocsp'), policy))).toBeNull();
        expect(codeOf(() => assertUrlAllowed(new URL('http://xn--bcher-kva.example.com/ocsp'), policy))).toBeNull();
        expect(codeOf(() => assertUrlAllowed(new URL('http://example.com/ocsp'), policy))).toBeNull();
        expect(codeOf(() => assertUrlAllowed(new URL('http://example.com:8080/ocsp'), policy))).toBeNull(); // port-less entry matches any port
        expect(codeOf(() => assertUrlAllowed(new URL('http://[::1]/ocsp'), policy))).toBeNull(); // verbatim loopback literal
        expect(codeOf(() => assertUrlAllowed(new URL('http://ocsp.example.org:8080/x'), policy))).toBeNull();
        expect(codeOf(() => assertUrlAllowed(new URL('http://ocsp.example.org/x'), policy))).toBe('NETWORK_HOST_NOT_ALLOWED'); // entry pinned a port
        expect(codeOf(() => parseAllowedHosts('*.example.com:8080'))).toBe('NETWORK_ERROR');
        expect(codeOf(() => parseAllowedHosts('user@example.com'))).toBe('NETWORK_ERROR');
    });
});
