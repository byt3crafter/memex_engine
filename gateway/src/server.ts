import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { mountA2A } from './a2a.js';
import { RateLimiter } from './core.js';
import { Gateway, GatewayError } from './gateway.js';
import type { Store } from './store.js';
import { APPROVAL_MODES, SCOPES } from './types.js';
import type { GatewayEvent, Principal, TaskStatus } from './types.js';
import { mountWebApp } from './web.js';

export interface ServerOptions {
  /** When set, creating people and unowned agents requires this in `x-registration-key`. */
  registrationKey?: string | undefined;
  /** Requests per principal per minute. */
  rateLimitPerMinute?: number;
  /** Seconds between keep-alive pings on idle event streams. */
  heartbeatSeconds?: number;
  /** Public base URL used in A2A agent cards. Defaults to the request's origin. */
  publicUrl?: string | undefined;
  /** Cap on how long a blocking A2A `SendMessage` waits. Default: as long as the caller stays connected. */
  a2aBlockingTimeoutSeconds?: number | undefined;
  /** Allow A2A push notifications to private/loopback addresses (tests, local setups). */
  allowPrivateWebhooks?: boolean;
  /** Telegram bot username, shown when linking. */
  telegramBot?: string | undefined;
  /** Sign-up / sign-in attempts per client address (and per handle) per minute. Default 20. */
  signInAttemptsPerMinute?: number;
  /** Secure cookies (set when served over HTTPS). */
  secureCookies?: boolean;
}

const SESSION_COOKIE = 'agw_session';
const MAX_TEXT = 64 * 1024;

const scopes = z.array(z.enum(SCOPES as [string, ...string[]])).min(1);
const approval = z.enum(APPROVAL_MODES as [string, ...string[]]);
const attachment = z.object({
  filename: z.string().min(1).max(200),
  mediaType: z.string().max(200).default('application/octet-stream'),
  data: z.string(),
});

const schemas = {
  person: z.object({
    handle: z.string(),
    password: z.string().min(8).max(200),
    displayName: z.string().max(100).optional(),
  }),
  login: z.object({ handle: z.string(), password: z.string() }),
  agent: z.object({ handle: z.string(), description: z.string().max(500).optional() }),
  agentPatch: z.object({
    description: z.string().max(500).nullable().optional(),
    discoverable: z.boolean().optional(),
    paused: z.boolean().optional(),
  }),
  invite: z.object({
    agent: z.string().optional(),
    scopes: scopes.optional(),
    mutual: z.boolean().optional(),
    approval: approval.optional(),
    includeAgents: z.boolean().optional(),
    ttlSeconds: z
      .number()
      .int()
      .min(60)
      .max(30 * 24 * 3600)
      .optional(),
    maxUses: z.number().int().min(1).max(100).optional(),
    grantTtlSeconds: z.number().int().min(60).nullable().optional(),
  }),
  redeem: z.object({ code: z.string().min(4).max(64) }),
  channelPatch: z.object({
    scopes: scopes.optional(),
    approval: approval.optional(),
    includeAgents: z.boolean().optional(),
    expiresAt: z.string().nullable().optional(),
  }),
  send: z.object({
    to: z.string(),
    kind: z.enum(['message', 'task']).default('message'),
    project: z.string().max(200).optional(),
    title: z.string().max(200).optional(),
    body: z.string().min(1).max(MAX_TEXT),
    attachments: z.array(attachment).max(10).optional(),
  }),
  status: z.object({
    status: z.enum(['working', 'input_required', 'completed', 'failed', 'rejected', 'canceled']),
    result: z.string().max(MAX_TEXT).optional(),
  }),
  threadMessage: z.object({ body: z.string().min(1).max(MAX_TEXT) }),
  conversation: z.object({
    title: z.string().max(200).nullable().optional(),
    members: z.array(z.string()).max(50).optional(),
  }),
  conversationPatch: z.object({ title: z.string().max(200).nullable() }),
  post: z.object({
    body: z.string().max(MAX_TEXT).default(''),
    to: z.array(z.string()).max(20).optional(),
    kind: z.enum(['message', 'task']).optional(),
    project: z.string().max(200).nullable().optional(),
    title: z.string().max(200).nullable().optional(),
    replyTo: z.string().nullable().optional(),
    attachments: z.array(attachment).max(10).optional(),
  }),
  member: z.object({ handle: z.string() }),
  invitation: z.object({ accept: z.boolean() }),
  read: z.object({ seq: z.number().int().min(0) }),
  decision: z.object({
    decision: z.enum(['approve', 'reject']),
    body: z.string().max(MAX_TEXT).optional(),
    note: z.string().max(2000).optional(),
  }),
};

type Env = { Variables: { me: Principal } };

export function createApp(store: Store, opts: ServerOptions = {}) {
  const gateway = new Gateway(store);
  const app = new Hono<Env>();
  const limiter = new RateLimiter(opts.rateLimitPerMinute ?? 600);
  // Unauthenticated endpoints: per client address, and per handle for sign-in attempts.
  const openLimiter = new RateLimiter(opts.signInAttemptsPerMinute ?? 20);
  const clientAddress = (c: Context) =>
    (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket
      ?.remoteAddress ?? 'unknown';
  const throttle = (key: string) => {
    if (!openLimiter.allow(key))
      throw new GatewayError(429, 'rate_limited', 'too many attempts; wait a minute');
  };

  app.onError((err, c) => {
    if (err instanceof GatewayError) {
      return c.json(
        {
          error: err.code,
          message: err.message,
          ...(err.detail === undefined ? {} : { detail: err.detail }),
        },
        err.status,
      );
    }
    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  });

  async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      throw new GatewayError(400, 'invalid_json');
    }
    const out = schema.safeParse(json);
    if (!out.success) {
      throw new GatewayError(400, 'invalid_request', 'invalid request', z.treeifyError(out.error));
    }
    return out.data;
  }

  const requireRegistrationKey = (c: Context) => {
    if (opts.registrationKey && c.req.header('x-registration-key') !== opts.registrationKey) {
      throw new GatewayError(401, 'registration_key_required');
    }
  };

  const bearer = (c: Context) => {
    const h = c.req.header('authorization') ?? '';
    return h.startsWith('Bearer ') ? h.slice(7) : null;
  };

  const startWebSession = (c: Context, token: string, expiresAt: string) => {
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: Boolean(opts.secureCookies),
      path: '/',
      expires: new Date(expiresAt),
    });
  };

  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/api', (c) =>
    c.json({ name: 'agent-gateway', version: '0.3.0', app: '/app', docs: 'see README.md' }),
  );

  // ---- sign-up / sign-in (no auth) ----

  app.post('/v1/people', async (c) => {
    throttle(`ip:${clientAddress(c)}`);
    requireRegistrationKey(c);
    const out = gateway.registerPerson(await body(c, schemas.person));
    if (c.req.query('cookie')) startWebSession(c, out.token, out.expiresAt);
    return c.json(out, 201);
  });

  app.post('/v1/sessions', async (c) => {
    const b = await body(c, schemas.login);
    throttle(`ip:${clientAddress(c)}`);
    throttle(`login:${b.handle.toLowerCase()}`);
    const out = gateway.login(b.handle, b.password);
    if (c.req.query('cookie')) startWebSession(c, out.token, out.expiresAt);
    return c.json(out, 201);
  });

  // Unowned agents register themselves; people create owned agents (authenticated, below).
  app.post('/v1/agents', async (c, next) => {
    if (bearer(c) || getCookie(c, SESSION_COOKIE)) return next();
    throttle(`ip:${clientAddress(c)}`);
    requireRegistrationKey(c);
    return c.json(gateway.registerAgent(await body(c, schemas.agent)), 201);
  });

  // ---- everything below needs a token (agents) or a session (people) ----

  app.use('/v1/*', async (c, next) => {
    const cookie = getCookie(c, SESSION_COOKIE);
    const me = gateway.authenticate(bearer(c) ?? cookie);
    if (!me) throw new GatewayError(401, 'unauthorized');
    // Cookie-authenticated writes must come from our own pages: browsers won't send a
    // custom header cross-site without CORS, which this server never grants.
    const viaCookie = !bearer(c) && Boolean(cookie);
    if (viaCookie && c.req.method !== 'GET' && c.req.header('x-requested-with') !== 'agw') {
      throw new GatewayError(403, 'csrf', 'missing X-Requested-With header');
    }
    if (!limiter.allow(me.id)) throw new GatewayError(429, 'rate_limited');
    c.set('me', me);
    await next();
  });

  app.delete('/v1/sessions', (c) => {
    const token = bearer(c) ?? getCookie(c, SESSION_COOKIE);
    if (token) gateway.logout(token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/v1/me', (c) => c.json(gateway.me(c.get('me'))));

  // ---- agents ----

  app.post('/v1/agents', async (c) => {
    const b = await body(c, schemas.agent);
    return c.json(gateway.registerAgent({ ...b, owner: c.get('me') }), 201);
  });

  app.get('/v1/agents', (c) => c.json({ agents: gateway.me(c.get('me')).agents }));

  app.patch('/v1/agents/:handle', async (c) => {
    const b = await body(c, schemas.agentPatch);
    return c.json({ agent: gateway.updateAgent(c.get('me'), c.req.param('handle'), b) });
  });

  app.post('/v1/agents/:handle/token', (c) =>
    c.json(gateway.rotateAgentToken(c.get('me'), c.req.param('handle'))),
  );

  // ---- sharing ----

  app.post('/v1/invites', async (c) => {
    const invite = gateway.createInvite(c.get('me'), (await body(c, schemas.invite)) as never);
    return c.json({ invite }, 201);
  });

  app.post('/v1/invites/redeem', async (c) => {
    const b = await body(c, schemas.redeem);
    return c.json(gateway.redeemInvite(c.get('me'), b.code), 201);
  });

  app.get('/v1/channels', (c) => c.json({ channels: gateway.channelsFor(c.get('me')) }));

  app.patch('/v1/channels/:id', async (c) => {
    const b = await body(c, schemas.channelPatch);
    return c.json({ channel: gateway.updateChannel(c.get('me'), c.req.param('id'), b as never) });
  });

  app.delete('/v1/channels/:id', (c) =>
    c.json({ channel: gateway.revokeChannel(c.get('me'), c.req.param('id')) }),
  );

  // ---- tasks (work for agents) ----

  app.post('/v1/tasks', async (c) => {
    const b = await body(c, schemas.send);
    const task = gateway.sendDirect(c.get('me'), b.to, {
      kind: b.kind,
      project: b.project ?? null,
      title: b.title ?? null,
      body: b.body,
      ...(b.attachments ? { attachments: b.attachments } : {}),
    });
    return c.json({ task }, 201);
  });

  app.get('/v1/tasks', (c) => {
    const box = c.req.query('box') === 'outbox' ? 'outbox' : 'inbox';
    const statuses = c.req.query('status')?.split(',').filter(Boolean) as TaskStatus[] | undefined;
    const n = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
    return c.json({ tasks: gateway.listTasks(c.get('me'), box, statuses ?? null, n) });
  });

  app.get('/v1/tasks/:id', (c) => c.json(gateway.getTask(c.get('me'), c.req.param('id'))));

  app.post('/v1/tasks/:id/status', async (c) => {
    const b = await body(c, schemas.status);
    return c.json({
      task: gateway.setTaskStatus(c.get('me'), c.req.param('id'), b.status, b.result ?? null),
    });
  });

  app.post('/v1/tasks/:id/messages', async (c) => {
    const b = await body(c, schemas.threadMessage);
    return c.json({ task: gateway.continueTask(c.get('me'), c.req.param('id'), b.body) }, 201);
  });

  // ---- conversations ----

  app.get('/v1/conversations', (c) =>
    c.json({ conversations: gateway.listConversations(c.get('me')) }),
  );

  app.post('/v1/conversations', async (c) => {
    const b = await body(c, schemas.conversation);
    return c.json({ conversation: gateway.createConversation(c.get('me'), b) }, 201);
  });

  app.get('/v1/conversations/:id', (c) =>
    c.json({ conversation: gateway.getConversation(c.get('me'), c.req.param('id')) }),
  );

  app.patch('/v1/conversations/:id', async (c) => {
    const b = await body(c, schemas.conversationPatch);
    return c.json({
      conversation: gateway.renameConversation(c.get('me'), c.req.param('id'), b.title),
    });
  });

  app.get('/v1/conversations/:id/messages', (c) => {
    const num = (k: string) => {
      const v = Number(c.req.query(k));
      return Number.isFinite(v) && v > 0 ? v : undefined;
    };
    const before = num('before');
    const after = num('after');
    const limit = num('limit');
    return c.json({
      messages: gateway.listMessages(c.get('me'), c.req.param('id'), {
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
        ...(limit ? { limit } : {}),
      }),
    });
  });

  app.post('/v1/conversations/:id/messages', async (c) => {
    const b = await body(c, schemas.post);
    return c.json({ message: gateway.postMessage(c.get('me'), c.req.param('id'), b) }, 201);
  });

  app.post('/v1/conversations/:id/members', async (c) => {
    const b = await body(c, schemas.member);
    return c.json(
      { conversation: gateway.addMember(c.get('me'), c.req.param('id'), b.handle) },
      201,
    );
  });

  app.delete('/v1/conversations/:id/members/:handle', (c) => {
    gateway.removeMember(c.get('me'), c.req.param('id'), c.req.param('handle'));
    return c.json({ ok: true });
  });

  app.post('/v1/conversations/:id/invitation', async (c) => {
    const b = await body(c, schemas.invitation);
    return c.json({
      conversation: gateway.respondToInvite(c.get('me'), c.req.param('id'), b.accept),
    });
  });

  app.post('/v1/conversations/:id/read', async (c) => {
    const b = await body(c, schemas.read);
    gateway.markRead(c.get('me'), c.req.param('id'), b.seq);
    return c.json({ ok: true });
  });

  // ---- owner approvals ----

  app.get('/v1/approvals', (c) => {
    const status = c.req.query('status');
    const filter =
      status === 'all'
        ? null
        : ((status as 'pending' | 'approved' | 'rejected' | undefined) ?? 'pending');
    return c.json({ approvals: gateway.listApprovals(c.get('me'), filter) });
  });

  app.post('/v1/approvals/:id', async (c) => {
    const b = await body(c, schemas.decision);
    return c.json({
      approval: gateway.decide(c.get('me'), c.req.param('id'), b.decision, {
        body: b.body,
        note: b.note,
      }),
    });
  });

  // ---- files ----

  app.get('/v1/files/:id', (c) => {
    const file = gateway.attachment(c.get('me'), c.req.param('id'));
    const inline =
      /^(image|audio|video)\//.test(file.mediaType) || file.mediaType === 'application/pdf';
    return c.body(Buffer.from(file.data), 200, {
      'content-type': file.mediaType,
      'content-length': String(file.size),
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(file.filename)}"`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    });
  });

  // ---- Telegram ----

  app.post('/v1/telegram/link', (c) =>
    c.json(
      { code: gateway.createTelegramLinkCode(c.get('me')), bot: opts.telegramBot ?? null },
      201,
    ),
  );

  app.delete('/v1/telegram/link', (c) => {
    gateway.unlinkTelegram(c.get('me'));
    return c.json({ ok: true });
  });

  // ---- live events ----

  /**
   * Server-sent events for the caller. Resume with `Last-Event-ID` (or `?since=`);
   * without either, the stream starts from now.
   */
  app.get('/v1/stream', (c) => {
    const me = c.get('me');
    const resume = c.req.header('last-event-id') ?? c.req.query('since');
    let last = resume !== undefined ? Number(resume) || 0 : store.latestEventSeq(me.id);
    const heartbeatMs = (opts.heartbeatSeconds ?? 15) * 1000;

    return streamSSE(c, async (stream) => {
      const queue: GatewayEvent[] = [];
      let wake: (() => void) | null = null;
      let closed = false;
      // Subscribe before replaying so nothing slips between the two; seq dedupes the overlap.
      const unsubscribe = gateway.hub.subscribe(me.id, (e) => {
        queue.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        closed = true;
        unsubscribe();
        wake?.();
      });
      queue.push(...store.eventsSince(me.id, last));

      await stream.writeSSE({
        event: 'ready',
        data: JSON.stringify({ handle: me.handle, since: last }),
      });
      while (!closed) {
        while (queue.length && !closed) {
          const e = queue.shift()!;
          if (e.seq <= last) continue;
          last = e.seq;
          await stream.writeSSE({ id: String(e.seq), event: e.type, data: JSON.stringify(e) });
        }
        if (closed) break;
        const idle = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(true), heartbeatMs);
          wake = () => {
            clearTimeout(timer);
            resolve(false);
          };
        });
        wake = null;
        if (idle && !closed) await stream.writeSSE({ event: 'ping', data: '' });
      }
    });
  });

  const a2a = mountA2A(app, gateway, limiter, {
    publicUrl: opts.publicUrl,
    blockingTimeoutMs: opts.a2aBlockingTimeoutSeconds
      ? opts.a2aBlockingTimeoutSeconds * 1000
      : undefined,
    heartbeatMs: (opts.heartbeatSeconds ?? 15) * 1000,
    allowPrivateWebhooks: Boolean(opts.allowPrivateWebhooks),
  });
  mountWebApp(app);

  return Object.assign(app, { gateway, a2a });
}
