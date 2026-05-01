import type { Kernel } from '@memex/kernel';
import { Hono } from 'hono';

const TELEGRAM_BOT = 'memex_engineBot';
const TELEGRAM_LINK = `https://t.me/${TELEGRAM_BOT}`;
const REPO_URL = 'https://github.com/byt3crafter/memex_engine';

const ESC = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface RenderableManifest {
  id: string;
  codename: string;
  version: string;
  description: string;
  domain: string;
  icon?: string;
  tagline?: string;
  features?: string[];
  category?: string;
  homepage?: string;
}

function moduleCard(m: RenderableManifest): string {
  const icon = m.icon ?? '🧩';
  const category = m.category ?? m.domain;
  const tagline = m.tagline ?? m.description;
  const features = (m.features ?? []).slice(0, 5);
  const featureBullets = features.length
    ? `<ul class="features">${features.map((f) => `<li>${ESC(f)}</li>`).join('')}</ul>`
    : '';
  const homepageLink = m.homepage
    ? `<a class="card-link" href="${ESC(m.homepage)}" target="_blank" rel="noopener">Open ↗</a>`
    : '';
  return `<article class="card">
    <header class="card-head">
      <div class="icon">${icon}</div>
      <div class="title">
        <h3>${ESC(m.codename)}</h3>
        <span class="meta"><code>${ESC(m.id)}</code> · v${ESC(m.version)}</span>
      </div>
      <span class="pill">${ESC(category)}</span>
    </header>
    <p class="tagline">${ESC(tagline)}</p>
    ${featureBullets}
    <footer class="card-foot">
      <span class="installed">✓ Installed</span>
      ${homepageLink}
    </footer>
  </article>`;
}

const html = (kernel: Kernel) => {
  const manifests: RenderableManifest[] = kernel.modules
    .list()
    .map((m) => m.module.manifest as RenderableManifest);
  const cardsHtml = manifests.length
    ? manifests.map(moduleCard).join('')
    : '<p class="empty">No modules loaded.</p>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Memex — AI-native personal-data kernel</title>
<meta name="description" content="Self-hostable, multi-user, AI-native personal-data kernel. Pluggable modules. Connect any AI assistant via MCP or REST.">
<style>
  :root {
    color-scheme: light dark;
    --bg: #fafafa;
    --fg: #1a1a1a;
    --muted: #6b6b6b;
    --card-bg: #ffffff;
    --card-border: rgba(0,0,0,.08);
    --card-shadow: 0 1px 3px rgba(0,0,0,.04), 0 1px 2px rgba(0,0,0,.02);
    --accent: #229ED9;
    --pill-bg: rgba(34,158,217,.1);
    --pill-fg: #1d6b95;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0e0e10;
      --fg: #e8e8e8;
      --muted: #999;
      --card-bg: #1a1a1c;
      --card-border: rgba(255,255,255,.06);
      --card-shadow: 0 2px 8px rgba(0,0,0,.4);
      --pill-bg: rgba(34,158,217,.18);
      --pill-fg: #6ec0e8;
    }
  }
  * { box-sizing: border-box; }
  body {
    font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, sans-serif;
    background: var(--bg);
    color: var(--fg);
    margin: 0;
  }
  main { max-width: 56rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
  h1 { font-size: 2.5rem; letter-spacing: -0.025em; margin: 0 0 .5rem; font-weight: 700; }
  h2 { font-size: 1.5rem; margin: 2.5rem 0 .25rem; font-weight: 700; }
  h3 { margin: 0; font-size: 1.15rem; font-weight: 600; }
  .tag { color: var(--muted); font-size: 1.05rem; margin: 0 0 1.75rem; }
  .section-tag { color: var(--muted); font-size: .95rem; margin: 0 0 1rem; }

  code {
    background: rgba(127,127,127,.15);
    padding: .12em .4em;
    border-radius: 4px;
    font-size: .92em;
    font-family: ui-monospace, SF Mono, Menlo, monospace;
  }
  pre code { padding: 1rem; display: block; overflow-x: auto; line-height: 1.5; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  .cta {
    display: flex;
    align-items: center;
    gap: .9rem;
    background: linear-gradient(135deg, #229ED9 0%, #1d8acf 100%);
    color: white !important;
    padding: 1.1rem 1.5rem;
    border-radius: 14px;
    text-decoration: none;
    font-weight: 600;
    margin: 1.5rem 0 .5rem;
    box-shadow: 0 6px 18px rgba(34,158,217,.25);
    transition: transform .12s ease, box-shadow .12s ease;
  }
  .cta:hover {
    transform: translateY(-1px);
    text-decoration: none;
    box-shadow: 0 8px 24px rgba(34,158,217,.35);
  }
  .cta-icon { font-size: 1.6rem; }
  .cta-body { display: flex; flex-direction: column; line-height: 1.3; }
  .cta-title { font-size: 1.05rem; }
  .cta-sub { font-weight: 400; font-size: .85rem; opacity: .92; }

  .how {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    box-shadow: var(--card-shadow);
    border-radius: 12px;
    padding: 1.25rem 1.5rem;
    margin: 1.5rem 0 0;
  }
  .how p { margin: .55rem 0; display: flex; align-items: baseline; gap: .65rem; }
  .num {
    display: inline-flex;
    width: 1.6rem; height: 1.6rem;
    align-items: center; justify-content: center;
    background: var(--accent);
    color: white;
    border-radius: 999px;
    font-weight: 700;
    font-size: .82rem;
    flex-shrink: 0;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
    gap: 1rem;
    margin-top: 1rem;
  }
  .card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 14px;
    padding: 1.25rem;
    box-shadow: var(--card-shadow);
    display: flex;
    flex-direction: column;
    transition: transform .12s ease, box-shadow .12s ease;
  }
  .card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 14px rgba(0,0,0,.08);
  }
  .card-head {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: .85rem;
    align-items: center;
    margin-bottom: .75rem;
  }
  .icon {
    font-size: 2.2rem;
    line-height: 1;
    width: 3rem; height: 3rem;
    display: flex; align-items: center; justify-content: center;
    background: rgba(127,127,127,.08);
    border-radius: 12px;
    flex-shrink: 0;
  }
  .title .meta { color: var(--muted); font-size: .82rem; }
  .pill {
    background: var(--pill-bg);
    color: var(--pill-fg);
    padding: .2em .65em;
    border-radius: 999px;
    font-size: .76rem;
    font-weight: 500;
    white-space: nowrap;
  }
  .tagline { color: var(--fg); margin: 0 0 .85rem; font-size: .94rem; line-height: 1.5; }
  .features { margin: 0 0 .85rem; padding-left: 1.1rem; }
  .features li { font-size: .87rem; color: var(--fg); margin: .25rem 0; }
  .card-foot {
    margin-top: auto;
    padding-top: .75rem;
    border-top: 1px solid var(--card-border);
    display: flex; justify-content: space-between; align-items: center;
    font-size: .82rem;
  }
  .installed { color: #16a34a; font-weight: 500; }
  .card-link { color: var(--accent); }

  .empty { color: var(--muted); padding: 1rem; }

  footer.page-foot {
    margin-top: 3rem; padding-top: 1.5rem;
    border-top: 1px solid var(--card-border);
    color: var(--muted); font-size: .85rem;
    display: flex; justify-content: space-between; flex-wrap: wrap; gap: .5rem;
  }

  ul.api-list { padding-left: 1.25rem; }
  ul.api-list li { margin: .35rem 0; }
</style>
</head>
<body>
<main>

<h1>Memex</h1>
<p class="tag">AI-native personal-data kernel. Your AI assistant's long-term memory.</p>

<a class="cta" href="${TELEGRAM_LINK}">
  <span class="cta-icon">💬</span>
  <span class="cta-body">
    <span class="cta-title">Sign up via Telegram</span>
    <span class="cta-sub">@${TELEGRAM_BOT} — get your token, plug into any AI assistant</span>
  </span>
</a>

<div class="how">
  <p><span class="num">1</span> Open <a href="${TELEGRAM_LINK}">@${TELEGRAM_BOT}</a> on Telegram, send <code>/start</code></p>
  <p><span class="num">2</span> Get your Memex bearer token + a config snippet for your assistant</p>
  <p><span class="num">3</span> Paste it into Claude Desktop, OpenClaw, Cursor, or any MCP/HTTP client</p>
  <p><span class="num">4</span> Your assistant now has all the modules below as long-term memory + tools.</p>
</div>

<h2>Pantheon</h2>
<p class="section-tag">Each module is a god in Memex's pantheon — installed, active, and ready to be called by your AI assistant.</p>
<div class="grid">
  ${cardsHtml}
</div>

<h2>API endpoints</h2>
<p class="section-tag">For power users hitting Memex directly.</p>
<ul class="api-list">
  <li><code>GET /health</code> — liveness check</li>
  <li><code>POST /api/v1/connections/pair-complete</code> — exchange a pairing code for a bearer token</li>
  <li><code>GET /api/v1/me</code> — your user + connection (bearer required)</li>
  <li><code>GET /api/v1/connections</code> — list your connections (bearer required)</li>
  <li><code>* /api/v1/&lt;module&gt;/…</code> — module-contributed routes (bearer required)</li>
</ul>

<h2>Pair an assistant from a code</h2>
<pre><code>curl -X POST https://memex.dovik.dev/api/v1/connections/pair-complete \\
  -H "Content-Type: application/json" \\
  -d '{"code":"ABCD-EFGH"}'</code></pre>

<footer class="page-foot">
  <span>Open source · MIT · Self-host friendly</span>
  <span><a href="${REPO_URL}">${REPO_URL.replace('https://', '')}</a></span>
</footer>

</main>
</body>
</html>
`;
};

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
      signup: { telegram: TELEGRAM_LINK },
      modules: kernel.modules.list().map((m) => {
        const x = m.module.manifest as RenderableManifest;
        return {
          id: x.id,
          codename: x.codename,
          version: x.version,
          domain: x.domain,
          icon: x.icon ?? null,
          tagline: x.tagline ?? null,
          category: x.category ?? null,
          features: x.features ?? [],
          homepage: x.homepage ?? null,
        };
      }),
      endpoints: {
        health: 'GET /health',
        pair_complete: 'POST /api/v1/connections/pair-complete',
        me: 'GET /api/v1/me',
        connections: 'GET /api/v1/connections',
      },
      docs: REPO_URL,
    });
  });
  return r;
}
