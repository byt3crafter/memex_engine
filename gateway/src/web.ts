import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Context, Hono } from 'hono';

/**
 * The web and phone app: a dependency-free installable PWA in ../web, served at /app.
 * It talks to the same REST API with a session cookie.
 */

const WEB_DIR = fileURLToPath(new URL('../web/', import.meta.url));

const FILES: Record<string, string> = {
  'index.html': 'text/html; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'app.css': 'text/css; charset=utf-8',
  'manifest.webmanifest': 'application/manifest+json',
  'sw.js': 'text/javascript; charset=utf-8',
  'icon.svg': 'image/svg+xml',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  // Inline style attributes only (never user content); scripts stay locked down.
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

export function mountWebApp(app: Hono<any>): void {
  const cache = new Map<string, Buffer>();
  const read = (name: string) => {
    // Re-read in development so edits show up without a restart.
    if (process.env.NODE_ENV === 'production' && cache.has(name)) return cache.get(name)!;
    const buf = readFileSync(WEB_DIR + name);
    cache.set(name, buf);
    return buf;
  };
  const serve = (name: string) => (c: Context) =>
    c.body(new Uint8Array(read(name)), 200, {
      'content-type': FILES[name]!,
      'content-security-policy': CSP,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      'cache-control':
        name === 'sw.js' || name === 'index.html' ? 'no-cache' : 'public, max-age=300',
      ...(name === 'sw.js' ? { 'service-worker-allowed': '/app/' } : {}),
    });

  app.get('/', (c) => c.redirect('/app/'));
  app.get('/app', (c) => c.redirect('/app/'));
  app.get('/app/', serve('index.html'));
  for (const name of Object.keys(FILES)) app.get(`/app/${name}`, serve(name));
}
