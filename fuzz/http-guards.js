/**
 * pdfnative-mcp — fuzz target: the HTTP guards
 * ============================================
 * `guardLoopback` (src/http.ts) answers 403 to any Host / Origin that is not
 * a loopback authority on the server's own port, and `guardBearer`
 * (src/auth.ts) answers 401 to anything but the operator's token, in
 * constant time. The input bytes are split into a Host, an Origin and an
 * Authorization header value (NUL-separated) and handed to the guards as a
 * `Request`, so the fuzzer explores the header parsers the SDK and the
 * server run before any MCP handler.
 *
 * Contract: a `Response` or `undefined` is a result; an exception escaping a
 * guard is a bug — a thrown header parser would turn into a 500 for a client
 * that should have been told 403 — and is rethrown. Invariant: a Host whose
 * host name is not loopback never passes, and a credential that is not the
 * operator's token never passes.
 *
 * The oracles read the headers the way the guards do, on the value `Headers`
 * stores (leading / trailing HTTP whitespace stripped): the SDK takes the host
 * name of `new URL('http://' + host)`, whose parser also drops trailing C0
 * controls and spaces — `127.0.0.1:8\x01` is `127.0.0.1` (a control byte in
 * a header never reaches the guards over the wire; llhttp refuses it) — and
 * the bearer scheme is case-insensitive with any run of whitespace after it
 * (RFC 7235 §2.1). An oracle stricter than the parser it checks reports a
 * parser difference, not a guard that let a stranger in: ClusterFuzzLite
 * found exactly that on the first pull request run (both inputs are seeds).
 *
 * @module fuzz/http-guards
 */

import { guardBearer, guardLoopback } from '../dist/fuzz-surface.js';

const TOKEN = 'fuzz-token-0123456789abcdef';

/**
 * What the loopback guard may let through: an authority whose host name, read
 * the way the SDK reads it (`new URL('http://' + host).hostname`), is loopback.
 * @param {string} host The Host header as stored. @returns {boolean}
 */
function isLoopbackAuthority(host) {
    let hostname;
    try {
        hostname = new URL(`http://${host}`).hostname;
    } catch {
        return false;
    }
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

/**
 * What the bearer guard may let through: the credential after a `Bearer`
 * scheme, and only when it is the operator's token, byte for byte.
 * @param {string} authorization The Authorization header as stored. @returns {boolean}
 */
function isOperatorCredential(authorization) {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
    return match !== null && match[1] === TOKEN;
}

/** @param {Buffer} data Bytes chosen by the fuzzer. */
export function fuzz(data) {
    const [host = '', origin = '', authorization = ''] = data.toString('latin1').split('\0');
    const headers = new Headers();
    const set = (name, value) => {
        try {
            if (value !== '') headers.set(name, value);
        } catch {
            // Not a valid header value (NUL, CR, LF): the SDK's own parser
            // refuses it before our guards; nothing to fuzz here.
        }
    };
    set('host', host);
    set('origin', origin);
    set('authorization', authorization);
    const request = new Request('http://127.0.0.1:8765/mcp', { method: 'POST', headers });

    const storedHost = request.headers.get('host');
    const loopback = guardLoopback(request);
    if (loopback === undefined && storedHost !== null && !isLoopbackAuthority(storedHost)) {
        throw new Error(`loopback guard passed a foreign Host: ${JSON.stringify(storedHost)}`);
    }
    const storedAuthorization = request.headers.get('authorization') ?? '';
    const bearer = guardBearer(request, TOKEN);
    if (bearer === undefined && !isOperatorCredential(storedAuthorization)) {
        throw new Error(`bearer guard passed a wrong credential: ${JSON.stringify(storedAuthorization)}`);
    }
}
