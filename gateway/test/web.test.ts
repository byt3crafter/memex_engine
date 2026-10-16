import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startGateway, stopAll } from './helpers.js';
import type { TestGateway } from './helpers.js';

let gw: TestGateway;
beforeAll(async () => {
  gw = await startGateway();
});
afterAll(stopAll);

describe('web app', () => {
  it('serves the installable app with a strict content security policy', async () => {
    const page = await fetch(`${gw.url}/app/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<script type="module" src="/app/app.js">');
    const csp = page.headers.get('content-security-policy')!;
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    for (const [path, type] of [
      ['app.js', 'text/javascript'],
      ['app.css', 'text/css'],
      ['manifest.webmanifest', 'application/manifest+json'],
      ['sw.js', 'text/javascript'],
    ]) {
      const res = await fetch(`${gw.url}/app/${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain(type);
    }
    const landing = await fetch(`${gw.url}/`);
    expect(landing.status).toBe(200);
    const html = await landing.text();
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<title>Agent Gateway</title>');
    expect(html).toContain('href="/app/"');
    expect(html).not.toContain('<script');
    expect(landing.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('never renders user content as HTML', async () => {
    const js = await (await fetch(`${gw.url}/app/app.js`)).text();
    expect(js).not.toMatch(/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\(|document\.write\(/);
  });
});
