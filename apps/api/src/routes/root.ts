import type { Kernel } from '@memex/kernel';
import { Hono } from 'hono';

const TELEGRAM_BOT = 'MemexEngineBot';
const TELEGRAM_LINK = `https://t.me/${TELEGRAM_BOT}`;

const html = (kernel: Kernel) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Memex — Personal-data kernel for AI assistants</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.55 ui-sans-serif, system-ui, sans-serif; max-width: 44rem; margin: 3rem auto; padding: 0 1.25rem; }
  h1 { margin: 0 0 .25rem; font-size: 2.1rem; letter-spacing: -0.02em; }
  h3 { margin-top: 2rem; }
  .tag { color: #888; font-size: .92rem; }
  code { background: rgba(127,127,127,.15); padding: .1em .35em; border-radius: 4px; font-size: .92em; }
  pre code { padding: 1rem; display: block; overflow-x: auto; }
  ul { padding-left: 1.25rem; }
  li { margin: .35rem 0; }
  .pill { display: inline-block; background: rgba(127,127,127,.18); padding: .15em .55em; border-radius: 999px; font-size: .82rem; margin-right: .35rem; margin-bottom: .25rem; }
  footer { margin-top: 3rem; color: #888; font-size: .85rem; }
  a { color: #4a8fea; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .cta {
    display: block;
    background: linear-gradient(135deg, #229ED9 0%, #1d8acf 100%);
    color: white !important;
    padding: 1.1rem 1.5rem;
    border-radius: 12px;
    text-decoration: none;
    font-weight: 600;
    font-size: 1.05rem;
    margin: 1.5rem 0;
    text-align: center;
    box-shadow: 0 4px 12px rgba(34,158,217,.25);
    transition: transform .12s ease;
  }
  .cta:hover { transform: translateY(-1px); text-decoration: none; }
  .cta-sub { display: block; font-weight: 400; font-size: .85rem; opacity: .9; margin-top: .25rem; }
  .how { background: rgba(127,127,127,.08); padding: 1rem 1.25rem; border-radius: 10px; margin: 1.5rem 0; }
  .how p { margin: .4rem 0; }
  .num { display: inline-block; width: 1.5rem; font-weight: 600; color: #229ED9; }
</style>
</head>
<body>

<h1>Memex</h1>
<p class="tag">AI-native personal-data kernel. Your AI assistant's long-term memory.</p>

<a class="cta" href="${TELEGRAM_LINK}">
  💬 Sign up via Telegram
  <span class="cta-sub">@${TELEGRAM_BOT} — get your token, then plug into any AI assistant</span>
</a>

<div class="how">
  <p><span class="num">1.</span> Open the Telegram bot, hit <code>/start</code></p>
  <p><span class="num">2.</span> Get your Memex bearer token + a config snippet for your assistant</p>
  <p><span class="num">3.</span> Paste it into Claude Desktop, OpenClaw, Cursor, or any MCP/HTTP client</p>
  <p><span class="num">4.</span> Your assistant now has your pantry, meals, recipes, patterns, and more.</p>
</div>

<h3>Modules loaded</h3>
<div>
  ${kernel.modules
    .list()
    .map((m) => `<span class="pill">${m.module.manifest.id} — ${m.module.manifest.codename} v${m.module.manifest.version}</span>`)
    .join('')}
</div>

<h3>API endpoints (for power users)</h3>
<ul>
  <li><code>GET /health</code> — liveness check</li>
  <li><code>POST /api/v1/connections/pair-complete</code> — exchange a pairing code for a bearer token</li>
  <li><code>GET /api/v1/me</code> — your user + connection (bearer required)</li>
  <li><code>GET /api/v1/connections</code> — list your connections (bearer required)</li>
  <li><code>* /api/v1/&lt;module&gt;/…</code> — module-contributed routes (bearer required)</li>
</ul>

<h3>Pair an assistant from a code</h3>
<pre><code>curl -X POST https://memex.dovik.dev/api/v1/connections/pair-complete \\
  -H "Content-Type: application/json" \\
  -d '{"code":"ABCD-EFGH"}'</code></pre>

<footer>
  Open source: <a href="https://github.com/byt3crafter/memex_engine">github.com/byt3crafter/memex_engine</a> · MIT licensed · Self-host friendly
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
      tagline: "AI-native personal-data kernel. Your AI assistant's long-term memory.",
      signup: {
        telegram: TELEGRAM_LINK,
      },
      modules: kernel.modules.list().map((m) => ({
        id: m.module.manifest.id,
        codename: m.module.manifest.codename,
        version: m.module.manifest.version,
      })),
      endpoints: {
        health: 'GET /health',
        pair_complete: 'POST /api/v1/connections/pair-complete',
        me: 'GET /api/v1/me',
        connections: 'GET /api/v1/connections',
      },
      docs: 'https://github.com/byt3crafter/memex_engine',
    });
  });
  return r;
}
