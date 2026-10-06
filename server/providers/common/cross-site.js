/**
 * Cross-site request detection for the local server.
 *
 * The server runs on the user's own machine and brokers their provider keys, so
 * a web page the user merely visits must not be able to drive it. A browser
 * will send a request to http://localhost:PORT from any site, and a WebSocket
 * handshake is not bound by the same-origin policy at all.
 *
 * Browsers say where a request came from in two headers. `Sec-Fetch-Site` is
 * sent on every request by current browsers and is authoritative when present;
 * `Origin` is the fallback for older ones and is always present on a WebSocket
 * handshake. A request carrying neither is not a browser acting for a web page
 * (curl, this repository's own scripts, the test suite) and is not what this
 * guards against.
 *
 * `same-site` is refused too: another port on localhost is another program, and
 * the app only ever calls its own origin.
 *
 * @param {Record<string, string | string[] | undefined>} headers Lower-cased request headers.
 * @returns {boolean} True when a web page from somewhere else is behind the request.
 */
export function isCrossSiteRequest(headers = {}) {
  const site = String(headers['sec-fetch-site'] || '')
    .trim()
    .toLowerCase();
  if (site) return site !== 'same-origin' && site !== 'none';

  const origin = headers.origin;
  if (origin === undefined || origin === null || origin === '') return false;
  try {
    const originHost = new URL(String(origin)).host.toLowerCase();
    return (
      originHost !==
      String(headers.host || '')
        .trim()
        .toLowerCase()
    );
  } catch {
    // `Origin: null` (sandboxed frame, file://) or garbage: never ours.
    return true;
  }
}
