import type { Kernel } from '@memex/kernel';
import { Hono } from 'hono';

const html = (kernel: Kernel) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Memex</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1.25rem; }
  h1 { margin: 0 0 .25rem; }
  .tag { color: #888; font-size: .9rem; }
  code { background: rgba(127,127,127,.15); padding: .1em .35em; border-radius: 4px; font-size: .92em; }
  ul { padding-left: 1.25rem; }
  li { margin: .35rem 0; }
  .modules { margin: 1.25rem 0; }
  .pill { display: inline-block; background: rgba(127,127,127,.18); padding: .15em .55em; border-radius: 999px; font-size: .82rem; margin-right: .25rem; }
  footer { margin-top: 3rem; color: #888; font-size: .85rem; }
  a { color: inherit; }
</style>
</head>
<body>
<h1>Memex</h1>
<p class="tag">Self-hostable, multi-user, AI-native personal-data kernel — v0.0.1-alpha</p>

<p>This is an API. There is no UI here. Connect an AI assistant via MCP or REST.</p>

<div class="modules">
  <strong>Modules loaded:</strong>
  ${kernel.modules
    .list()
    .map((m) => `<span class="pill">${m.module.manifest.id} — ${m.module.manifest.codename} v${m.module.manifest.version}</span>`)
    .join('')}
</div>

<h3>Useful endpoints</h3>
<ul>
  <li><code>GET /health</code> — liveness check (public)</li>
  <li><code>POST /admin/bootstrap</code> — create founder + first pairing code (bootstrap token)</li>
  <li><code>POST /api/v1/connections/pair-complete</code> — exchange a pairing code for a bearer token (public)</li>
  <li><code>GET /api/v1/me</code> — your user + connection (bearer required)</li>
  <li><code>GET /api/v1/connections</code> — list your connections (bearer required)</li>
  <li><code>POST /api/v1/connections/pair-start</code> — issue a pairing code for another assistant (bearer required)</li>
  <li><code>* /api/v1/&lt;module&gt;/...</code> — module-contributed routes (bearer required)</li>
</ul>

<h3>Pair an assistant</h3>
<pre><code>curl -X POST https://memex.dovik.dev/api/v1/connections/pair-complete \\
  -H "Content-Type: application/json" \\
  -d '{"code":"ABCD-EFGH"}'</code></pre>

<footer>
  Source: <a href="https://github.com/byt3crafter/memex_engine">github.com/byt3crafter/memex_engine</a>
</footer>
</body>
</html>
`;

export function rootRouter(kernel: Kernel): Hono {
  const r = new Hono();
  r.get('/', (c) => {
    const accept = c.req.header('accept') ?? '';
    if (accept.includes('text/html')) {
      return c.html(html(kernel));
    }
    return c.json({
      name: 'memex',
      version: '0.0.1-alpha',
      modules: kernel.modules.list().map((m) => ({
        id: m.module.manifest.id,
        codename: m.module.manifest.codename,
        version: m.module.manifest.version,
      })),
      endpoints: {
        health: 'GET /health',
        bootstrap: 'POST /admin/bootstrap',
        pair_complete: 'POST /api/v1/connections/pair-complete',
        me: 'GET /api/v1/me',
        connections: 'GET /api/v1/connections',
      },
      docs: 'https://github.com/byt3crafter/memex_engine',
    });
  });
  return r;
}
