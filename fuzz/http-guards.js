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
 * that should have been told 403 — and is rethrown. Invariant: a Host that is
 * not loopback never passes, and a token that is not the operator's never
 * passes.
 *
 * @module fuzz/http-guards
 */

import { guardBearer, guardLoopback } from '../dist/fuzz-surface.js';

const TOKEN = 'fuzz-token-0123456789abcdef';

/**
 * What the guard may let through: an authority whose host part, read the way
 * a URL parser reads it (an empty port is still that host), is loopback.
 * @param {string} host @returns {boolean}
 */
function isLoopbackAuthority(host) {
    let hostname;
    try {
        hostname = new URL(`http://${host}/`).hostname;
    } catch {
        return false;
    }
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

/** @param {Buffer} data Bytes chosen by the fuzzer. */
export function fuzz(data) {
    const [host = '', origin = '', authorization = ''] = data.toString('latin1').split('\0');
    const headers = new Headers();
    const set = (name, value) => {
        try {
            if (value !== '') headers.set(name, value);
        } catch {
            // Not a valid header value (control characters): the SDK's own
            // parser refuses it before our guards; nothing to fuzz here.
        }
    };
    set('host', host);
    set('origin', origin);
    set('authorization', authorization);
    const request = new Request('http://127.0.0.1:8765/mcp', { method: 'POST', headers });

    const loopback = guardLoopback(request);
    if (loopback === undefined && host !== '' && !isLoopbackAuthority(host)) {
        throw new Error(`loopback guard passed a foreign Host: ${JSON.stringify(host)}`);
    }
    const bearer = guardBearer(request, TOKEN);
    if (bearer === undefined && authorization !== `Bearer ${TOKEN}`) {
        throw new Error(`bearer guard passed a wrong credential: ${JSON.stringify(authorization)}`);
    }
}
