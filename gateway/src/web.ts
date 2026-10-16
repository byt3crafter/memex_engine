import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Context, Hono } from 'hono';
import { SKILL_DIR, SKILL_NAME, skillFiles } from './skills.js';

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

  // The agent-gateway skill, readable by any agent: "read <gateway>/skills/agent-gateway/SKILL.md".
  const files = new Set(skillFiles());
  app.get(`/skills/${SKILL_NAME}/*`, (c) => {
    const path = c.req.path.slice(`/skills/${SKILL_NAME}/`.length) || 'SKILL.md';
    if (!files.has(path)) return c.json({ error: 'not_found' }, 404);
    return c.body(readFileSync(SKILL_DIR + path, 'utf8'), 200, {
      'content-type': 'text/markdown; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': '*',
    });
  });

  // Marketing page. landing.html is a body fragment (it is also published standalone).
  const LANDING_CSP = [
    "default-src 'none'",
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; ');
  app.get('/', (c) =>
    c.html(
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
        '<link rel="icon" href="/app/icon.svg" type="image/svg+xml">' +
        read('landing.html').toString('utf8') +
        '</html>',
      200,
      {
        'content-security-policy': LANDING_CSP,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'same-origin',
        'cache-control': 'public, max-age=300',
      },
    ),
  );
  app.get('/app', (c) => c.redirect('/app/'));
  app.get('/app/', serve('index.html'));
  for (const name of Object.keys(FILES)) app.get(`/app/${name}`, serve(name));
}
