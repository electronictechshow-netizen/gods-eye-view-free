import { isCrossSiteRequest } from './cross-site.js';

/**
 * Refuse API requests that another website is making through the user's
 * browser. Install FIRST, so it runs before any provider middleware.
 *
 * The app only ever talks to its own origin, so nothing legitimate is lost; the
 * cost-bearing and key-brokering proxies (voice, HUD summary, FIRMS, traffic,
 * places) and the debug-log writer simply stop answering a page that is not
 * the app.
 */
export function crossSiteGuardPlugin() {
  const install = (server) => {
    server.middlewares.use('/api', (req, res, next) => {
      if (!isCrossSiteRequest(req.headers)) {
        next();
        return;
      }
      res.writeHead(403, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(
        JSON.stringify({
          error: 'Cross-site requests to this server are refused',
        }),
      );
    });
  };
  return {
    name: 'cross-site-guard',
    configureServer: install,
    configurePreviewServer: install,
  };
}
