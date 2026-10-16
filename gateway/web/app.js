// Agent Gateway web app. No framework, no build step: plain DOM, the REST API with a
// session cookie, and server-sent events for live updates. All user content is set with
// textContent, never innerHTML.

const root = document.getElementById('root');

// ---------- api ----------

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      'x-requested-with': 'agw',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      json.message && json.message !== json.error
        ? json.message
        : humanize(json.error || res.statusText),
    );
    err.code = json.error;
    err.status = res.status;
    throw err;
  }
  return json;
}

function humanize(code) {
  const map = {
    unauthorized: 'Please sign in again.',
    invalid_login: 'Wrong handle or password.',
    handle_taken: 'That handle is taken.',
    invalid_code: 'That code is not valid.',
    code_expired: 'That code has expired.',
    code_used: 'That code was already used.',
    no_access: 'You don’t have access to that agent. Ask its owner for an invite code.',
  };
  return map[code] || String(code || 'Something went wrong').replace(/_/g, ' ');
}

// ---------- dom ----------

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = Boolean(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const COLORS = [
  '#4f46e5',
  '#0891b2',
  '#16a34a',
  '#d97706',
  '#db2777',
  '#7c3aed',
  '#0d9488',
  '#e11d48',
];
function color(s) {
  let n = 0;
  for (const ch of s) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[n % COLORS.length];
}

function avatar(handle, kind, small) {
  return h(
    'span',
    { class: `avatar${small ? ' sm' : ''}`, style: `background:${color(handle)}`, title: handle },
    kind === 'agent' ? '✦' : handle.slice(0, 1).toUpperCase(),
  );
}

function toast(text) {
  const t = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}

function when(iso) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Text with @mentions emphasised. */
function richText(text) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(/@[a-z0-9][a-z0-9._-]{1,62}/gi)) {
    parts.push(text.slice(last, m.index));
    parts.push(h('span', { class: 'mention' }, m[0]));
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

function dialog(title, build) {
  const close = () => overlay.remove();
  const box = h('div', {
    class: 'dialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
  });
  const overlay = h(
    'div',
    { class: 'overlay', onclick: (e) => e.target === overlay && close() },
    box,
  );
  box.append(
    h('h2', {}, title),
    ...[build(close)].flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false),
  );
  document.body.append(overlay);
  box.querySelector('input,textarea,button')?.focus();
  return close;
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    toast('Select and copy the text');
  }
}

// ---------- state ----------

const state = {
  me: null,
  agents: [],
  channels: [],
  telegramLinked: false,
  conversations: [],
  messages: new Map(),
  approvals: [],
  draftFiles: [],
  kind: 'message',
};

async function loadMe() {
  const me = await api('GET', '/v1/me');
  state.me = me.principal;
  state.agents = me.agents;
  state.channels = me.channels;
  state.telegramLinked = me.telegramLinked;
}

async function loadConversations() {
  state.conversations = (await api('GET', '/v1/conversations')).conversations;
}

async function loadApprovals() {
  state.approvals = (await api('GET', '/v1/approvals')).approvals;
}

async function loadMessages(id) {
  const { messages } = await api(
    'GET',
    `/v1/conversations/${encodeURIComponent(id)}/messages?limit=100`,
  );
  state.messages.set(id, messages);
  const last = messages.at(-1);
  if (last)
    api('POST', `/v1/conversations/${encodeURIComponent(id)}/read`, { seq: last.seq }).catch(
      () => {},
    );
  const conv = state.conversations.find((c) => c.id === id);
  if (conv) conv.unread = 0;
  return messages;
}

// ---------- live updates ----------

let events = null;
let refreshTimer = null;

function scheduleRefresh(what) {
  scheduleRefresh.pending = new Set([...(scheduleRefresh.pending || []), ...what]);
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    const todo = scheduleRefresh.pending;
    scheduleRefresh.pending = new Set();
    const route = currentRoute();
    try {
      await Promise.all([
        todo.has('conversations') ? loadConversations() : null,
        todo.has('approvals') ? loadApprovals() : null,
        todo.has('me') ? loadMe() : null,
        todo.has('thread') && route.name === 'chat' ? loadMessages(route.id) : null,
      ]);
    } catch {}
    render({ keepScroll: true });
  }, 150);
}

function connect() {
  if (events) events.close();
  events = new EventSource('/v1/stream');
  const on = (type, fn) => events.addEventListener(type, (e) => fn(JSON.parse(e.data)));
  on('message.created', (e) => {
    const msg = e.data;
    scheduleRefresh([
      'conversations',
      ...(currentRoute().id === msg.conversationId ? ['thread'] : []),
    ]);
    if (msg.author !== state.me?.handle && msg.kind !== 'system') {
      notify(`${msg.author}`, msg.body, `#/c/${msg.conversationId}`);
    }
  });
  on('task.updated', () => scheduleRefresh(['thread']));
  on('task.created', () => scheduleRefresh(['thread']));
  on('conversation.updated', () => scheduleRefresh(['conversations', 'thread']));
  on('conversation.invited', (e) => {
    scheduleRefresh(['conversations']);
    notify('New invitation', e.data?.title || 'You were invited to a conversation', '#/chats');
  });
  on('approval.requested', (e) => {
    scheduleRefresh(['approvals']);
    notify(
      `Approval needed: ${e.data.agent}`,
      `${e.data.requester}: ${e.data.body}`,
      '#/approvals',
    );
  });
  on('approval.resolved', () => scheduleRefresh(['approvals', 'thread']));
  on('agent.updated', () => scheduleRefresh(['me']));
  on('channel.created', () => scheduleRefresh(['me']));
  on('channel.updated', () => scheduleRefresh(['me']));
  on('channel.revoked', () => scheduleRefresh(['me']));
}

async function notify(title, body, hash) {
  if (
    document.visibilityState === 'visible' ||
    !('Notification' in window) ||
    Notification.permission !== 'granted'
  )
    return;
  const reg = await navigator.serviceWorker?.getRegistration('/app/');
  const opts = { body: body.slice(0, 200), icon: '/app/icon.svg', data: { url: `/app/${hash}` } };
  if (reg) reg.showNotification(title, opts);
  else new Notification(title, opts);
}

// ---------- routing ----------

function currentRoute() {
  const [, name, id] = location.hash.split('/');
  if (name === 'c' && id) return { name: 'chat', id: decodeURIComponent(id) };
  return { name: name || 'chats', id: id ? decodeURIComponent(id) : null };
}

window.addEventListener('hashchange', () => render());

// ---------- views ----------

function renderAuth(mode = 'login', error = '') {
  const handle = h('input', {
    autocomplete: 'username',
    placeholder: 'your-handle',
    autocapitalize: 'none',
  });
  const name = h('input', { placeholder: 'Your name (optional)' });
  const pass = h('input', {
    type: 'password',
    autocomplete: mode === 'login' ? 'current-password' : 'new-password',
    placeholder: '8+ characters',
  });
  const submit = async (e) => {
    e.preventDefault();
    try {
      const body = { handle: handle.value.trim().toLowerCase(), password: pass.value };
      if (mode === 'signup')
        await api('POST', '/v1/people?cookie=1', {
          ...body,
          ...(name.value ? { displayName: name.value } : {}),
        });
      else await api('POST', '/v1/sessions?cookie=1', body);
      await boot();
    } catch (err) {
      renderAuth(mode, err.message);
    }
  };
  root.replaceChildren(
    h(
      'div',
      { class: 'auth' },
      h(
        'form',
        { class: 'card', onsubmit: submit },
        h('img', { class: 'logo', src: '/app/icon.svg', alt: '' }),
        h('h1', {}, 'Agent Gateway'),
        h(
          'p',
          { class: 'muted small', style: 'text-align:center;margin-top:0' },
          'Conversations between people and AI agents.',
        ),
        h('label', { class: 'field' }, h('span', {}, 'Handle'), handle),
        mode === 'signup' ? h('label', { class: 'field' }, h('span', {}, 'Name'), name) : null,
        h('label', { class: 'field' }, h('span', {}, 'Password'), pass),
        error ? h('div', { class: 'error', role: 'alert' }, error) : null,
        h(
          'button',
          { class: 'btn primary', style: 'width:100%;margin-top:8px', type: 'submit' },
          mode === 'signup' ? 'Create account' : 'Sign in',
        ),
        h(
          'p',
          { class: 'small muted', style: 'text-align:center' },
          mode === 'signup' ? 'Have an account? ' : 'New here? ',
          h(
            'a',
            {
              href: '#',
              onclick: (e) => (
                e.preventDefault(),
                renderAuth(mode === 'signup' ? 'login' : 'signup')
              ),
            },
            mode === 'signup' ? 'Sign in' : 'Create an account',
          ),
        ),
      ),
    ),
  );
  handle.focus();
}

function tabs(route) {
  const pending = state.approvals.length;
  const unread = state.conversations.reduce(
    (n, c) => n + (c.unread || 0) + (c.myState === 'invited' ? 1 : 0),
    0,
  );
  const tab = (href, ico, label, on, badge) =>
    h(
      'a',
      { href, class: on ? 'on' : '', 'aria-current': on ? 'page' : null },
      h('span', { class: 'ico', 'aria-hidden': 'true' }, ico),
      label,
      badge ? h('span', { class: 'badge' }, badge) : null,
    );
  return h(
    'nav',
    { class: 'tabs', 'aria-label': 'Main' },
    tab('#/chats', '💬', 'Chats', route.name === 'chats' || route.name === 'chat', unread),
    tab('#/approvals', '✅', 'Approvals', route.name === 'approvals', pending),
    tab('#/agents', '✦', 'Agents', route.name === 'agents'),
    tab('#/settings', '⚙️', 'Settings', route.name === 'settings'),
  );
}

function render(opts = {}) {
  if (!state.me) return;
  const route = currentRoute();
  const prevThread = root.querySelector('.thread');
  const atBottom = prevThread
    ? prevThread.scrollHeight - prevThread.scrollTop - prevThread.clientHeight < 80
    : true;
  const keepComposer = root.querySelector('.composer textarea');
  const draft = keepComposer?.value;
  const hadFocus = document.activeElement === keepComposer;

  let main;
  if (route.name === 'chat') main = chatView(route.id);
  else if (route.name === 'approvals') main = approvalsView();
  else if (route.name === 'agents') main = agentsView();
  else if (route.name === 'settings') main = settingsView();
  else main = chatsView();

  root.replaceChildren(
    h('div', { class: 'shell' }, h('main', { class: 'main' }, main), tabs(route)),
  );

  const thread = root.querySelector('.thread');
  if (thread) {
    if (!opts.keepScroll || atBottom) thread.scrollTop = thread.scrollHeight;
    const ta = root.querySelector('.composer textarea');
    if (ta && draft !== undefined) {
      ta.value = draft;
      if (hadFocus) ta.focus();
    }
  }
}

// ----- chats list -----

function chatsView() {
  const invited = state.conversations.filter((c) => c.myState === 'invited');
  const joined = state.conversations.filter((c) => c.myState === 'joined');
  return h(
    'div',
    { class: 'page' },
    h(
      'div',
      { class: 'page-narrow' },
      h(
        'div',
        { class: 'row' },
        h('h2', { style: 'flex:1' }, 'Chats'),
        h('button', { class: 'btn primary', onclick: newChatDialog }, '+ New'),
      ),
      invited.length ? h('h3', {}, 'Invitations') : null,
      invited.map((c) =>
        h(
          'div',
          { class: 'card row' },
          h(
            'div',
            { style: 'flex:1;min-width:0' },
            h('b', {}, c.title || 'Conversation'),
            h('div', { class: 'muted small' }, `from ${c.createdBy} · ${c.members.length} members`),
          ),
          h('button', { class: 'btn', onclick: () => respond(c.id, false) }, 'Decline'),
          h('button', { class: 'btn primary', onclick: () => respond(c.id, true) }, 'Join'),
        ),
      ),
      joined.length
        ? joined.map((c) => chatItem(c))
        : h(
            'div',
            { class: 'empty' },
            h('p', {}, 'No conversations yet.'),
            h('p', { class: 'small' }, 'Start one with a person or an agent you have access to.'),
          ),
    ),
  );
}

function conversationTitle(c) {
  if (c.title) return c.title;
  const others = c.members.filter((m) => m.handle !== state.me.handle && m.role !== 'overseer');
  return others.map((m) => m.displayName || m.handle).join(', ') || 'Just you';
}

function chatItem(c) {
  const other =
    c.members.find((m) => m.handle !== state.me.handle && m.role !== 'overseer') || c.members[0];
  const last = c.lastMessage;
  return h(
    'a',
    { class: `chat-item${c.unread ? ' unread' : ''}`, href: `#/c/${encodeURIComponent(c.id)}` },
    avatar(other?.handle || '?', other?.kind),
    h(
      'div',
      { class: 'info' },
      h(
        'div',
        { class: 'title' },
        conversationTitle(c),
        c.myRole === 'overseer' ? h('span', { class: 'pill' }, 'overseeing') : null,
      ),
      h(
        'div',
        { class: 'preview' },
        last
          ? `${last.author === state.me.handle ? 'You' : last.author}: ${last.body}`
          : 'No messages yet',
      ),
    ),
    h(
      'div',
      { style: 'text-align:right' },
      last ? h('div', { class: 'small muted' }, when(last.createdAt)) : null,
      c.unread ? h('span', { class: 'badge' }, c.unread) : null,
    ),
  );
}

async function respond(id, accept) {
  try {
    await api('POST', `/v1/conversations/${encodeURIComponent(id)}/invitation`, { accept });
    await loadConversations();
    if (accept) location.hash = `#/c/${encodeURIComponent(id)}`;
    else render();
  } catch (err) {
    toast(err.message);
  }
}

function newChatDialog() {
  dialog('New conversation', (close) => {
    const title = h('input', { placeholder: 'e.g. Q3 planning' });
    const members = h('input', {
      placeholder: 'boss, boss-openclaw, my-claude',
      autocapitalize: 'none',
    });
    const err = h('div', { class: 'error' });
    const mine = state.agents.map((a) =>
      h(
        'button',
        {
          class: 'pill agent',
          type: 'button',
          onclick: () => (members.value = [members.value, a.handle].filter(Boolean).join(', ')),
        },
        `+ ${a.handle}`,
      ),
    );
    const shared = state.channels
      .filter(
        (c) => c.sender === state.me.handle || state.agents.some((a) => a.handle === c.sender),
      )
      .map((c) => c.recipient)
      .filter((v, i, all) => all.indexOf(v) === i && !state.agents.some((a) => a.handle === v));
    return [
      h('label', { class: 'field' }, h('span', {}, 'Title (optional)'), title),
      h(
        'label',
        { class: 'field' },
        h('span', {}, 'People and agents (handles, comma separated)'),
        members,
      ),
      mine.length || shared.length
        ? h(
            'div',
            { class: 'row small', style: 'margin-bottom:10px' },
            h('span', { class: 'muted' }, 'Quick add:'),
            mine,
            shared.map((handle) =>
              h(
                'button',
                {
                  class: 'pill agent',
                  type: 'button',
                  onclick: () =>
                    (members.value = [members.value, handle].filter(Boolean).join(', ')),
                },
                `+ ${handle}`,
              ),
            ),
          )
        : null,
      h(
        'p',
        { class: 'small muted' },
        'People get an invitation. Agents join directly if you own them or have access.',
      ),
      err,
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: close }, 'Cancel'),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              try {
                const list = members.value
                  .split(/[\s,]+/)
                  .map((s) => s.replace(/^@/, '').trim().toLowerCase())
                  .filter(Boolean);
                const { conversation } = await api('POST', '/v1/conversations', {
                  title: title.value.trim() || null,
                  members: list,
                });
                close();
                await loadConversations();
                location.hash = `#/c/${encodeURIComponent(conversation.id)}`;
              } catch (e) {
                err.textContent = e.message;
              }
            },
          },
          'Start',
        ),
      ),
    ];
  });
}

// ----- conversation -----

const STATUS_LABEL = {
  pending_approval: (d, owner) => `⏳ waiting for ${owner ? `@${owner}` : 'owner'} to approve`,
  submitted: (d) => `→ sent to @${d.to}`,
  working: (d) => `… @${d.to} is working`,
  input_required: (d) => `? @${d.to} needs more info`,
  reviewing: (d, owner) => `⏳ reply waiting for ${owner ? `@${owner}` : 'owner'}’s review`,
  failed: (d) => `⚠ @${d.to} couldn’t finish`,
  rejected: (d) => `✕ declined`,
  canceled: () => `canceled`,
};

function chatView(id) {
  const conv = state.conversations.find((c) => c.id === id);
  const messages = state.messages.get(id);
  if (!messages) {
    loadMessages(id).then(
      () => render(),
      (err) => toast(err.message),
    );
  }
  if (!conv) {
    return h('div', { class: 'page' }, h('div', { class: 'empty' }, 'Loading…'));
  }
  const memberOf = (handle) => conv.members.find((m) => m.handle === handle);
  const agents = conv.members.filter((m) => m.kind === 'agent' && m.handle !== state.me.handle);
  const paused = agents.filter((a) => state.agents.some((x) => x.handle === a.handle && x.paused));

  const thread = h(
    'div',
    { class: 'thread', role: 'log', 'aria-label': 'Messages' },
    (messages || []).map((m) => messageView(m, memberOf)),
    messages && !messages.length
      ? h('div', { class: 'empty' }, 'Say hello. Mention an agent with @ to ask it something.')
      : null,
  );

  return [
    h(
      'div',
      { class: 'header' },
      h('a', { class: 'icon-btn', href: '#/chats', 'aria-label': 'Back to chats' }, '←'),
      h('h1', {}, conversationTitle(conv)),
      h(
        'button',
        {
          class: 'icon-btn',
          'aria-label': 'Conversation details',
          onclick: () => conversationDialog(conv),
        },
        '⋯',
      ),
    ),
    h(
      'div',
      { class: 'members' },
      conv.members.map((m) =>
        h(
          'span',
          {
            class: `pill${m.kind === 'agent' ? ' agent' : ''}`,
            title: m.role === 'overseer' ? `Owner of an agent here` : m.role,
          },
          `${m.kind === 'agent' ? '✦ ' : ''}${m.handle}${m.state === 'invited' ? ' (invited)' : ''}${m.role === 'overseer' ? ' · owner' : ''}`,
        ),
      ),
    ),
    paused.length
      ? h(
          'div',
          { class: 'banner' },
          `${paused.map((p) => p.handle).join(', ')} paused: requests wait for your approval.`,
        )
      : null,
    thread,
    composer(conv, agents),
  ];
}

function messageView(m, memberOf) {
  if (m.kind === 'system') return h('div', { class: 'sys' }, m.body);
  const mine = m.author === state.me.handle;
  const author = memberOf(m.author);
  const isAgent = m.authorKind === 'agent';
  const deliveries = m.deliveries
    .filter((d) => d.status !== 'completed')
    .map((d) => {
      const owner = memberOf(d.to)?.owner;
      const label = (STATUS_LABEL[d.status] || ((x) => x.status))(d, owner);
      return h(
        'span',
        {
          class: `pill${d.status === 'pending_approval' || d.status === 'reviewing' ? ' warn' : ''}`,
        },
        label,
      );
    });
  const files = m.attachments.map((a) =>
    a.mediaType.startsWith('image/')
      ? h(
          'a',
          {
            class: 'attachment',
            href: `/v1/files/${encodeURIComponent(a.id)}`,
            target: '_blank',
            rel: 'noopener',
          },
          h('img', {
            src: `/v1/files/${encodeURIComponent(a.id)}`,
            alt: a.filename,
            loading: 'lazy',
          }),
        )
      : h(
          'a',
          {
            class: 'attachment',
            href: `/v1/files/${encodeURIComponent(a.id)}`,
            download: a.filename,
          },
          `📎 ${a.filename} (${Math.ceil(a.size / 1024)} KB)`,
        ),
  );
  return h(
    'div',
    { class: `msg${mine ? ' mine' : ''}${isAgent ? ' agent' : ''}` },
    mine ? null : avatar(m.author, m.authorKind, true),
    h(
      'div',
      { class: 'bubble' },
      h(
        'div',
        { class: 'who' },
        author?.displayName || m.author,
        isAgent ? ' ✦' : '',
        author?.owner ? h('span', { class: 'muted' }, ` · ${author.owner}’s agent`) : null,
      ),
      richText(m.body),
      files,
      deliveries.length ? h('div', { class: 'deliveries' }, deliveries) : null,
      h('div', { class: 'meta' }, when(m.createdAt)),
    ),
  );
}

function composer(conv, agents) {
  const ta = h('textarea', {
    rows: 1,
    placeholder:
      agents.length > 1
        ? 'Message, @ to ask an agent'
        : agents.length
          ? `Message ${agents[0].handle}`
          : 'Message',
    'aria-label': 'Message',
  });
  const suggest = h('div', { class: 'suggest', hidden: true });
  const filesRow = h('div', { class: 'files' });
  const project = h('input', { placeholder: 'project (optional)', 'aria-label': 'Project' });
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true });

  const autosize = () => {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  };
  const updateSuggest = () => {
    const m = /(^|\s)@([a-z0-9._-]*)$/i.exec(ta.value.slice(0, ta.selectionStart));
    const options = m
      ? conv.members
          .filter((x) => x.handle !== state.me.handle && x.handle.startsWith(m[2].toLowerCase()))
          .sort((a, b) => (a.kind === 'agent' ? -1 : 1) - (b.kind === 'agent' ? -1 : 1))
      : [];
    suggest.hidden = !options.length;
    suggest.replaceChildren(
      ...options.slice(0, 6).map((o) =>
        h(
          'button',
          {
            type: 'button',
            onmousedown: (e) => {
              e.preventDefault();
              const before = ta.value
                .slice(0, ta.selectionStart)
                .replace(/@([a-z0-9._-]*)$/i, `@${o.handle} `);
              ta.value = before + ta.value.slice(ta.selectionStart);
              ta.selectionStart = ta.selectionEnd = before.length;
              suggest.hidden = true;
              ta.focus();
            },
          },
          avatar(o.handle, o.kind, true),
          o.handle,
          o.kind === 'agent' ? h('span', { class: 'pill agent' }, 'agent') : null,
        ),
      ),
    );
  };
  const renderFiles = () =>
    filesRow.replaceChildren(
      ...state.draftFiles.map((f, i) =>
        h(
          'span',
          { class: 'pill' },
          `📎 ${f.filename} `,
          h(
            'button',
            {
              class: 'icon-btn',
              style: 'font-size:12px;padding:0 4px',
              'aria-label': `Remove ${f.filename}`,
              onclick: () => (state.draftFiles.splice(i, 1), renderFiles()),
            },
            '✕',
          ),
        ),
      ),
    );

  fileInput.addEventListener('change', async () => {
    for (const file of fileInput.files) {
      if (file.size > 10 * 1024 * 1024) {
        toast(`${file.name} is over 10 MB`);
        continue;
      }
      const data = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.readAsDataURL(file);
      });
      state.draftFiles.push({
        filename: file.name,
        mediaType: file.type || 'application/octet-stream',
        data,
      });
    }
    fileInput.value = '';
    renderFiles();
  });

  const send = async () => {
    const body = ta.value.trim();
    if (!body && !state.draftFiles.length) return;
    try {
      await api('POST', `/v1/conversations/${encodeURIComponent(conv.id)}/messages`, {
        body,
        kind: state.kind,
        ...(state.kind === 'task' && project.value.trim() ? { project: project.value.trim() } : {}),
        ...(state.draftFiles.length ? { attachments: state.draftFiles } : {}),
      });
      ta.value = '';
      state.draftFiles = [];
      renderFiles();
      autosize();
      await loadMessages(conv.id);
      render();
    } catch (err) {
      toast(err.message);
    }
  };

  ta.addEventListener('input', () => (autosize(), updateSuggest()));
  ta.addEventListener('keydown', (e) => {
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.isComposing &&
      window.matchMedia('(pointer: fine)').matches
    ) {
      e.preventDefault();
      send();
    }
  });
  ta.addEventListener('blur', () => setTimeout(() => (suggest.hidden = true), 100));

  const kindSeg = h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'Kind of request' },
    h(
      'button',
      {
        type: 'button',
        class: state.kind === 'message' ? 'on' : '',
        onclick: () => ((state.kind = 'message'), render({ keepScroll: true })),
        title: 'Questions; the agent changes nothing',
      },
      'Ask',
    ),
    h(
      'button',
      {
        type: 'button',
        class: state.kind === 'task' ? 'on' : '',
        onclick: () => ((state.kind = 'task'), render({ keepScroll: true })),
        title: 'Work that may change files or documents',
      },
      'Task',
    ),
  );

  setTimeout(renderFiles);
  return h(
    'div',
    { class: 'composer' },
    suggest,
    filesRow,
    agents.length
      ? h('div', { class: 'opts' }, kindSeg, state.kind === 'task' ? project : null)
      : null,
    h(
      'div',
      { class: 'bar' },
      fileInput,
      h(
        'button',
        {
          class: 'icon-btn',
          type: 'button',
          'aria-label': 'Attach files',
          onclick: () => fileInput.click(),
        },
        '📎',
      ),
      ta,
      h(
        'button',
        { class: 'btn primary send', type: 'button', 'aria-label': 'Send', onclick: send },
        '↑',
      ),
    ),
  );
}

function conversationDialog(conv) {
  dialog('Conversation', (close) => {
    const title = h('input', { value: conv.title || '', placeholder: 'Title' });
    const add = h('input', { placeholder: 'handle of a person or agent', autocapitalize: 'none' });
    const err = h('div', { class: 'error' });
    const me = conv.members.find((m) => m.handle === state.me.handle);
    return [
      h(
        'label',
        { class: 'field' },
        h('span', {}, 'Title'),
        h(
          'div',
          { class: 'row', style: 'flex-wrap:nowrap' },
          title,
          h(
            'button',
            {
              class: 'btn',
              onclick: async () => {
                try {
                  await api('PATCH', `/v1/conversations/${encodeURIComponent(conv.id)}`, {
                    title: title.value.trim() || null,
                  });
                  await loadConversations();
                  render();
                  toast('Renamed');
                } catch (e) {
                  err.textContent = e.message;
                }
              },
            },
            'Save',
          ),
        ),
      ),
      h('h3', {}, 'Members'),
      conv.members.map((m) =>
        h(
          'div',
          { class: 'row', style: 'padding:6px 0' },
          avatar(m.handle, m.kind, true),
          h(
            'div',
            { style: 'flex:1' },
            h(
              'div',
              {},
              m.handle,
              m.kind === 'agent'
                ? h('span', { class: 'pill agent', style: 'margin-left:6px' }, 'agent')
                : null,
            ),
            h(
              'div',
              { class: 'small muted' },
              [
                m.role === 'overseer' ? 'owner of an agent here' : m.role,
                m.state === 'invited' ? 'invited' : null,
                m.owner ? `${m.owner}’s agent` : null,
              ]
                .filter(Boolean)
                .join(' · '),
            ),
          ),
          (me?.role === 'admin' || m.owner === state.me.handle) && m.handle !== state.me.handle
            ? h(
                'button',
                {
                  class: 'btn ghost danger small',
                  onclick: async () => {
                    try {
                      await api(
                        'DELETE',
                        `/v1/conversations/${encodeURIComponent(conv.id)}/members/${encodeURIComponent(m.handle)}`,
                      );
                      await loadConversations();
                      close();
                      render();
                    } catch (e) {
                      err.textContent = e.message;
                    }
                  },
                },
                'Remove',
              )
            : null,
        ),
      ),
      h(
        'label',
        { class: 'field' },
        h('span', {}, 'Add someone'),
        h(
          'div',
          { class: 'row', style: 'flex-wrap:nowrap' },
          add,
          h(
            'button',
            {
              class: 'btn primary',
              onclick: async () => {
                try {
                  await api('POST', `/v1/conversations/${encodeURIComponent(conv.id)}/members`, {
                    handle: add.value.replace(/^@/, '').trim().toLowerCase(),
                  });
                  await loadConversations();
                  close();
                  render();
                } catch (e) {
                  err.textContent = e.message;
                }
              },
            },
            'Add',
          ),
        ),
      ),
      err,
      h(
        'div',
        { class: 'row', style: 'margin-top:12px' },
        h(
          'button',
          {
            class: 'btn danger',
            onclick: async () => {
              try {
                await api(
                  'DELETE',
                  `/v1/conversations/${encodeURIComponent(conv.id)}/members/${encodeURIComponent(state.me.handle)}`,
                );
                close();
                await loadConversations();
                location.hash = '#/chats';
              } catch (e) {
                err.textContent = e.message;
              }
            },
          },
          'Leave conversation',
        ),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: close }, 'Close'),
      ),
    ];
  });
}

// ----- approvals -----

function approvalsView() {
  return h(
    'div',
    { class: 'page' },
    h(
      'div',
      { class: 'page-narrow' },
      h('h2', {}, 'Approvals'),
      h(
        'p',
        { class: 'muted small' },
        'Requests to your agents, and their replies, waiting for your decision. Edit the text to change what is passed on.',
      ),
      state.approvals.length
        ? state.approvals.map(approvalCard)
        : h('div', { class: 'empty' }, '✅ Nothing is waiting for you.'),
    ),
  );
}

function approvalCard(a) {
  const conv = state.conversations.find((c) => c.id === a.conversationId);
  const body = h('textarea', {
    class: 'body',
    value: a.body,
    rows: 4,
    'aria-label': 'Text to pass on',
  });
  const note = h('input', { placeholder: 'Note (optional, shown when rejecting)' });
  const decide = async (decision) => {
    try {
      await api('POST', `/v1/approvals/${encodeURIComponent(a.id)}`, {
        decision,
        ...(decision === 'approve' && body.value !== a.body ? { body: body.value } : {}),
        ...(note.value.trim() ? { note: note.value.trim() } : {}),
      });
      toast(decision === 'approve' ? 'Approved' : 'Rejected');
      await loadApprovals();
      render();
    } catch (err) {
      toast(err.message);
    }
  };
  return h(
    'div',
    { class: 'card approval' },
    h(
      'div',
      { class: 'row', style: 'margin-bottom:8px' },
      h(
        'span',
        { class: `pill ${a.kind === 'request' ? 'warn' : 'agent'}` },
        a.kind === 'request' ? 'Request' : 'Reply',
      ),
      h(
        'b',
        {},
        a.kind === 'request' ? `${a.requester} → ${a.agent}` : `${a.agent} → ${a.requester}`,
      ),
      h('span', { class: 'spacer' }),
      h('span', { class: 'small muted' }, when(a.createdAt)),
    ),
    conv
      ? h(
          'div',
          { class: 'small', style: 'margin-bottom:8px' },
          'in ',
          h('a', { href: `#/c/${encodeURIComponent(conv.id)}` }, conversationTitle(conv)),
        )
      : null,
    body,
    h('div', { style: 'margin-top:8px' }, note),
    h(
      'div',
      { class: 'row', style: 'margin-top:10px' },
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn danger', onclick: () => decide('reject') }, 'Reject'),
      h(
        'button',
        { class: 'btn primary', onclick: () => decide('approve') },
        body.value !== a.body ? 'Approve edited' : 'Approve',
      ),
    ),
  );
}

// ----- agents -----

const APPROVAL_TEXT = {
  requests: 'You approve each request',
  all: 'You approve requests and replies',
  auto: 'Full control (no approval)',
};

function agentsView() {
  return h(
    'div',
    { class: 'page' },
    h(
      'div',
      { class: 'page-narrow' },
      h(
        'div',
        { class: 'row' },
        h('h2', { style: 'flex:1' }, 'Your agents'),
        h('button', { class: 'btn primary', onclick: newAgentDialog }, '+ New agent'),
      ),
      state.agents.length
        ? state.agents.map(agentCard)
        : h(
            'div',
            { class: 'empty' },
            h('p', {}, 'No agents yet.'),
            h(
              'p',
              { class: 'small' },
              'Create one for your Claude Code, Gemini CLI, Codex or OpenClaw, then share it with others.',
            ),
          ),
    ),
  );
}

function agentCard(a) {
  const access = state.channels.filter((c) => c.recipient === a.handle);
  const toggle = async (patch) => {
    try {
      await api('PATCH', `/v1/agents/${encodeURIComponent(a.handle)}`, patch);
      await loadMe();
      render();
    } catch (err) {
      toast(err.message);
    }
  };
  return h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'row' },
      avatar(a.handle, 'agent'),
      h(
        'div',
        { style: 'flex:1;min-width:0' },
        h('b', {}, a.handle),
        h('div', { class: 'small muted' }, a.description || 'No description'),
      ),
      h('span', { class: `pill ${a.paused ? 'warn' : 'ok'}` }, a.paused ? 'Paused' : 'Running'),
    ),
    h(
      'div',
      { class: 'row', style: 'margin-top:12px' },
      h(
        'label',
        { class: 'switch' },
        h('input', {
          type: 'checkbox',
          checked: a.paused,
          onchange: (e) => toggle({ paused: e.target.checked }),
        }),
        'Paused',
      ),
      h(
        'label',
        { class: 'switch' },
        h('input', {
          type: 'checkbox',
          checked: a.discoverable,
          onchange: (e) => toggle({ discoverable: e.target.checked }),
        }),
        'Public A2A card',
      ),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => tokenDialog(a) }, 'Connect'),
      h('button', { class: 'btn primary', onclick: () => shareDialog(a) }, 'Share'),
    ),
    h('h3', {}, `Who has access (${access.length})`),
    access.length
      ? access.map((c) =>
          h(
            'div',
            { class: 'row', style: 'padding:6px 0;flex-wrap:nowrap' },
            avatar(c.sender, null, true),
            h(
              'div',
              { style: 'flex:1;min-width:0' },
              h(
                'div',
                {},
                c.sender,
                c.includeAgents ? h('span', { class: 'muted small' }, ' + their agents') : null,
              ),
              h(
                'div',
                { class: 'small muted' },
                `${c.scopes.includes('task') ? 'Ask & tasks' : 'Ask only'}${c.expiresAt ? ` · until ${new Date(c.expiresAt).toLocaleDateString()}` : ''}`,
              ),
            ),
            h(
              'select',
              {
                style: 'width:auto',
                'aria-label': `Approval for ${c.sender}`,
                onchange: async (e) => {
                  try {
                    await api('PATCH', `/v1/channels/${encodeURIComponent(c.id)}`, {
                      approval: e.target.value,
                    });
                    await loadMe();
                    toast('Updated');
                  } catch (err) {
                    toast(err.message);
                  }
                },
              },
              Object.entries(APPROVAL_TEXT).map(([v, t]) =>
                h('option', { value: v, selected: c.approval === v }, t),
              ),
            ),
            h('button', { class: 'btn ghost danger', onclick: () => revoke(c) }, 'Revoke'),
          ),
        )
      : h('div', { class: 'small muted' }, 'Nobody yet. Use Share to give someone an invite code.'),
  );
}

async function revoke(c) {
  if (!confirm(`Revoke ${c.sender}’s access to ${c.recipient}?`)) return;
  try {
    await api('DELETE', `/v1/channels/${encodeURIComponent(c.id)}`);
    await loadMe();
    render();
  } catch (err) {
    toast(err.message);
  }
}

function newAgentDialog() {
  dialog('New agent', (close) => {
    const handle = h('input', { placeholder: 'e.g. ludo-claude', autocapitalize: 'none' });
    const desc = h('input', {
      placeholder: 'What it does, e.g. "Claude Code on the billing repo"',
    });
    const err = h('div', { class: 'error' });
    return [
      h('label', { class: 'field' }, h('span', {}, 'Handle'), handle),
      h('label', { class: 'field' }, h('span', {}, 'Description'), desc),
      err,
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: close }, 'Cancel'),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              try {
                const out = await api('POST', '/v1/agents', {
                  handle: handle.value.trim().toLowerCase(),
                  ...(desc.value.trim() ? { description: desc.value.trim() } : {}),
                });
                close();
                await loadMe();
                render();
                tokenDialog(out.agent, out.token);
              } catch (e) {
                err.textContent = e.message;
              }
            },
          },
          'Create',
        ),
      ),
    ];
  });
}

function tokenDialog(agent, token) {
  dialog(`Connect ${agent.handle}`, (close) => {
    const origin = location.origin;
    const area = h('div');
    const show = (t) => {
      const env = `AGW_URL=${origin} AGW_TOKEN=${t}`;
      area.replaceChildren(
        h(
          'p',
          { class: 'small' },
          'This token is shown once. Keep it secret: anyone with it can act as this agent.',
        ),
        h('div', { class: 'code' }, t),
        h(
          'div',
          { class: 'row', style: 'margin:8px 0 14px' },
          h('button', { class: 'btn', onclick: () => copy(t) }, 'Copy token'),
        ),
        h('h3', {}, 'Claude Code'),
        h(
          'div',
          { class: 'code' },
          `claude mcp add agw -e AGW_URL=${origin} -e AGW_TOKEN=${t} -- agw mcp`,
        ),
        h('h3', {}, 'OpenClaw, Gemini CLI, Codex'),
        h(
          'p',
          { class: 'small muted' },
          'Add an MCP server named "agw" running `agw mcp` with these environment variables, or run the listener so tasks start the agent automatically:',
        ),
        h('div', { class: 'code' }, `${env} agw run`),
        h(
          'p',
          { class: 'small muted' },
          'See the README for runner.json (projects, OpenClaw preset).',
        ),
      );
    };
    if (token) show(token);
    else
      area.replaceChildren(
        h(
          'p',
          { class: 'small' },
          'Get a new token to connect this agent. The old token stops working.',
        ),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              try {
                const out = await api(
                  'POST',
                  `/v1/agents/${encodeURIComponent(agent.handle)}/token`,
                );
                show(out.token);
              } catch (e) {
                toast(e.message);
              }
            },
          },
          'Issue new token',
        ),
      );
    return [
      area,
      h(
        'div',
        { class: 'row', style: 'margin-top:14px' },
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: close }, 'Done'),
      ),
    ];
  });
}

function shareDialog(agent) {
  dialog(`Share ${agent.handle}`, (close) => {
    const ask = h('input', { type: 'checkbox', checked: true, disabled: true });
    const work = h('input', { type: 'checkbox' });
    const includeAgents = h('input', { type: 'checkbox', checked: true });
    let approval = 'requests';
    const radios = Object.entries({
      requests: ['Approve each request', 'You see every request first and decide (recommended).'],
      all: [
        'Approve requests and replies',
        'Also review what your agent answers before it is sent.',
      ],
      auto: [
        'Full control',
        'They direct your agent directly. You still see everything and can pause or revoke.',
      ],
    }).map(([value, [title, text]]) =>
      h(
        'label',
        { class: 'choice' },
        h('input', {
          type: 'radio',
          name: 'approval',
          value,
          checked: value === approval,
          onchange: () => (approval = value),
        }),
        h('span', {}, h('b', {}, title), h('span', { class: 'small muted' }, text)),
      ),
    );
    const codeTtl = h(
      'select',
      {},
      h('option', { value: 3600 }, '1 hour'),
      h('option', { value: 86400, selected: true }, '24 hours'),
      h('option', { value: 604800 }, '7 days'),
    );
    const accessTtl = h(
      'select',
      {},
      h('option', { value: '' }, 'Until I revoke it'),
      h('option', { value: 86400 }, '1 day'),
      h('option', { value: 604800 }, '7 days'),
      h('option', { value: 2592000 }, '30 days'),
    );
    const result = h('div');
    const err = h('div', { class: 'error' });
    return [
      h('h3', {}, 'They can'),
      h(
        'label',
        { class: 'choice' },
        ask,
        h(
          'span',
          {},
          h('b', {}, 'Ask questions'),
          h('span', { class: 'small muted' }, 'Your agent answers; it doesn’t change anything.'),
        ),
      ),
      h(
        'label',
        { class: 'choice' },
        work,
        h(
          'span',
          {},
          h('b', {}, 'Give it tasks'),
          h('span', { class: 'small muted' }, 'Work that may change files or documents.'),
        ),
      ),
      h(
        'label',
        { class: 'choice' },
        includeAgents,
        h(
          'span',
          {},
          h('b', {}, 'Their agents too'),
          h('span', { class: 'small muted' }, 'e.g. their Claude can ask on their behalf.'),
        ),
      ),
      h('h3', {}, 'Your control'),
      radios,
      h(
        'div',
        { class: 'row', style: 'margin-top:10px;flex-wrap:nowrap' },
        h(
          'label',
          { class: 'field', style: 'flex:1;margin:0' },
          h('span', {}, 'Code valid for'),
          codeTtl,
        ),
        h(
          'label',
          { class: 'field', style: 'flex:1;margin:0' },
          h('span', {}, 'Access lasts'),
          accessTtl,
        ),
      ),
      err,
      result,
      h(
        'div',
        { class: 'row', style: 'margin-top:14px' },
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: close }, 'Close'),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              try {
                const { invite } = await api('POST', '/v1/invites', {
                  agent: agent.handle,
                  scopes: work.checked ? ['message', 'task'] : ['message'],
                  approval,
                  includeAgents: includeAgents.checked,
                  ttlSeconds: Number(codeTtl.value),
                  ...(accessTtl.value ? { grantTtlSeconds: Number(accessTtl.value) } : {}),
                });
                result.replaceChildren(
                  h(
                    'p',
                    { class: 'small' },
                    'Send this code to the person. They enter it in Settings → Redeem a code (or `agw redeem`). It works once.',
                  ),
                  h('div', { class: 'bigcode' }, invite.code),
                  h(
                    'div',
                    { class: 'row', style: 'margin-top:8px' },
                    h('span', { class: 'spacer' }),
                    h('button', { class: 'btn', onclick: () => copy(invite.code) }, 'Copy code'),
                  ),
                );
              } catch (e) {
                err.textContent = e.message;
              }
            },
          },
          'Create invite code',
        ),
      ),
    ];
  });
}

// ----- settings -----

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});

function settingsView() {
  const code = h('input', { placeholder: 'AGW-XXXXX-XXXXX', autocapitalize: 'characters' });
  const myAccess = state.channels.filter(
    (c) => !state.agents.some((a) => a.handle === c.recipient),
  );
  const tg = h('div');
  const renderTg = () => {
    tg.replaceChildren(
      state.telegramLinked
        ? h(
            'div',
            { class: 'row' },
            h('span', { class: 'pill ok' }, '✓ Linked'),
            h('span', { class: 'small muted' }, 'Approvals and messages come to Telegram.'),
            h('span', { class: 'spacer' }),
            h(
              'button',
              {
                class: 'btn ghost danger',
                onclick: async () => {
                  await api('DELETE', '/v1/telegram/link');
                  await loadMe();
                  render();
                },
              },
              'Unlink',
            ),
          )
        : h(
            'button',
            {
              class: 'btn',
              onclick: async () => {
                try {
                  const { code: c, bot } = await api('POST', '/v1/telegram/link');
                  tg.replaceChildren(
                    h(
                      'p',
                      { class: 'small' },
                      `In Telegram, open ${bot ? `@${bot}` : 'the gateway’s bot'} and send:`,
                    ),
                    h('div', { class: 'code' }, `/start ${c}`),
                    h(
                      'div',
                      { class: 'row', style: 'margin-top:8px' },
                      h('button', { class: 'btn', onclick: () => copy(`/start ${c}`) }, 'Copy'),
                      bot
                        ? h(
                            'a',
                            {
                              class: 'btn',
                              href: `https://t.me/${bot}?start=${encodeURIComponent(c)}`,
                              target: '_blank',
                              rel: 'noopener',
                            },
                            'Open Telegram',
                          )
                        : null,
                      h('span', { class: 'small muted' }, 'The code expires in 15 minutes.'),
                    ),
                  );
                } catch (e) {
                  toast(e.message);
                }
              },
            },
            'Link Telegram',
          ),
    );
  };
  renderTg();
  return h(
    'div',
    { class: 'page' },
    h(
      'div',
      { class: 'page-narrow' },
      h('h2', {}, 'Settings'),
      h(
        'div',
        { class: 'card row' },
        avatar(state.me.handle, 'human'),
        h(
          'div',
          { style: 'flex:1' },
          h('b', {}, state.me.displayName || state.me.handle),
          h('div', { class: 'small muted' }, `@${state.me.handle}`),
        ),
        h(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              await api('DELETE', '/v1/sessions').catch(() => {});
              events?.close();
              state.me = null;
              renderAuth();
            },
          },
          'Sign out',
        ),
      ),
      h('h3', {}, 'Redeem a code'),
      h(
        'div',
        { class: 'card' },
        h(
          'p',
          { class: 'small muted', style: 'margin-top:0' },
          'Someone shared their agent with you? Enter the code here.',
        ),
        h(
          'div',
          { class: 'row', style: 'flex-wrap:nowrap' },
          code,
          h(
            'button',
            {
              class: 'btn primary',
              onclick: async () => {
                try {
                  const { channels } = await api('POST', '/v1/invites/redeem', {
                    code: code.value.trim(),
                  });
                  toast(`You now have access to ${channels.map((c) => c.recipient).join(', ')}`);
                  code.value = '';
                  await loadMe();
                  render();
                } catch (e) {
                  toast(e.message);
                }
              },
            },
            'Redeem',
          ),
        ),
      ),
      h('h3', {}, 'Agents shared with you'),
      h(
        'div',
        { class: 'card' },
        myAccess.length
          ? myAccess.map((c) =>
              h(
                'div',
                { class: 'row', style: 'padding:4px 0;flex-wrap:nowrap' },
                avatar(c.recipient, 'agent', true),
                h(
                  'div',
                  { style: 'flex:1' },
                  c.recipient,
                  h(
                    'div',
                    { class: 'small muted' },
                    `${APPROVAL_TEXT[c.approval]}${c.scopes.includes('task') ? ' · tasks allowed' : ' · questions only'}`,
                  ),
                ),
                h('button', { class: 'btn ghost danger', onclick: () => revoke(c) }, 'Remove'),
              ),
            )
          : h('div', { class: 'small muted' }, 'None yet.'),
      ),
      h('h3', {}, 'Telegram'),
      h('div', { class: 'card' }, tg),
      h('h3', {}, 'This device'),
      h(
        'div',
        { class: 'card row' },
        'Notification' in window && Notification.permission !== 'granted'
          ? h(
              'button',
              {
                class: 'btn',
                onclick: async () => {
                  const p = await Notification.requestPermission();
                  toast(p === 'granted' ? 'Notifications on' : 'Notifications blocked');
                  render();
                },
              },
              'Turn on notifications',
            )
          : h('span', { class: 'small muted' }, 'Notifications are on while the app is open.'),
        installPrompt
          ? h('button', { class: 'btn', onclick: () => installPrompt.prompt() }, 'Install app')
          : h(
              'span',
              { class: 'small muted' },
              'On your phone, use “Add to Home Screen” to install.',
            ),
      ),
    ),
  );
}

// ---------- boot ----------

async function boot() {
  try {
    await loadMe();
  } catch {
    return renderAuth();
  }
  if (state.me.kind !== 'human') {
    await api('DELETE', '/v1/sessions').catch(() => {});
    return renderAuth('login', 'The web app is for people. Agents use the API, MCP or A2A.');
  }
  await Promise.all([loadConversations(), loadApprovals()]);
  if (!location.hash) location.hash = '#/chats';
  render();
  connect();
}

if ('serviceWorker' in navigator)
  navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {});
boot();
