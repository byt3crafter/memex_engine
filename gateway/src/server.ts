import { Hono } from 'hono';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { mountA2A } from './a2a.js';
import { newInviteCode, newToken, normalizeInviteCode, sha256 } from './auth.js';
import { authenticate, Hub, openTask, postMessage, RateLimiter } from './core.js';
import type { Store } from './store.js';
import { SCOPES, TERMINAL_STATUSES } from './types.js';
import type { Agent, GatewayEvent, TaskStatus } from './types.js';

export interface ServerOptions {
  /** When set, `POST /v1/agents` requires this value in the `x-registration-key` header. */
  registrationKey?: string | undefined;
  /** Requests per agent per minute. */
  rateLimitPerMinute?: number;
  /** Seconds between keep-alive pings on idle event streams. */
  heartbeatSeconds?: number;
  /** Public base URL used in A2A agent cards. Defaults to the request's origin. */
  publicUrl?: string | undefined;
  /** How long a blocking A2A `SendMessage` waits for the task to finish. Default 300s. */
  a2aBlockingTimeoutSeconds?: number;
}

const MAX_BODY = 64 * 1024;
const HANDLE = /^[a-z0-9][a-z0-9._-]{1,62}$/;

const registerSchema = z.object({
  handle: z.string().regex(HANDLE, 'handle must be 2-63 chars of a-z, 0-9, . _ -'),
  description: z.string().max(500).optional(),
});
const inviteSchema = z.object({
  scopes: z
    .array(z.enum(SCOPES as [string, ...string[]]))
    .min(1)
    .default(['message']),
  mutual: z.boolean().default(false),
  ttlSeconds: z
    .number()
    .int()
    .min(60)
    .max(7 * 24 * 3600)
    .default(24 * 3600),
  maxUses: z.number().int().min(1).max(100).default(1),
});
const sendSchema = z.object({
  to: z.string(),
  kind: z.enum(['message', 'task']).default('message'),
  project: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  body: z.string().min(1).max(MAX_BODY),
});
const statusSchema = z.object({
  status: z.enum(['working', 'input_required', 'completed', 'failed', 'rejected', 'canceled']),
  result: z.string().max(MAX_BODY).optional(),
});
const messageSchema = z.object({ body: z.string().min(1).max(MAX_BODY) });

/** Status changes the recipient may make, keyed by current status. */
const RECIPIENT_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  submitted: ['working', 'input_required', 'completed', 'failed', 'rejected'],
  working: ['input_required', 'completed', 'failed'],
  input_required: ['working', 'completed', 'failed'],
  completed: [],
  failed: [],
  rejected: [],
  canceled: [],
};

type Env = { Variables: { agent: Agent } };

export function createApp(store: Store, opts: ServerOptions = {}) {
  const app = new Hono<Env>();
  const hub = new Hub(store);
  const limiter = new RateLimiter(opts.rateLimitPerMinute ?? 240);

  const bad = (
    c: Context,
    status: 400 | 401 | 403 | 404 | 409 | 429,
    error: string,
    detail?: unknown,
  ) => c.json({ error, ...(detail === undefined ? {} : { detail }) }, status);

  async function parse<T>(
    c: Context,
    schema: z.ZodType<T>,
  ): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return { ok: false, res: bad(c, 400, 'invalid_json') };
    }
    const out = schema.safeParse(json);
    if (!out.success)
      return { ok: false, res: bad(c, 400, 'invalid_request', z.treeifyError(out.error)) };
    return { ok: true, data: out.data };
  }

  app.get('/', (c) => c.json({ name: 'agent-gateway', version: '0.1.0', docs: 'see README.md' }));
  app.get('/health', (c) => c.json({ ok: true }));

  app.post('/v1/agents', async (c) => {
    if (opts.registrationKey && c.req.header('x-registration-key') !== opts.registrationKey) {
      return bad(c, 401, 'registration_key_required');
    }
    const p = await parse(c, registerSchema);
    if (!p.ok) return p.res;
    if (store.agentByHandle(p.data.handle)) return bad(c, 409, 'handle_taken');
    const token = newToken();
    const agent = store.createAgent(p.data.handle, sha256(token), p.data.description ?? null);
    // The token is shown once; only its hash is stored.
    return c.json({ agent, token }, 201);
  });

  // Everything below needs a bearer token.
  app.use('/v1/*', async (c, next) => {
    const agent = authenticate(store, c.req.header('authorization'));
    if (!agent) return bad(c, 401, 'unauthorized');
    if (!limiter.allow(agent.id)) return bad(c, 429, 'rate_limited');
    c.set('agent', agent);
    await next();
  });

  app.get('/v1/me', (c) => {
    const me = c.get('agent');
    return c.json({ agent: me, channels: store.channelsFor(me.id) });
  });

  app.post('/v1/invites', async (c) => {
    const p = await parse(c, inviteSchema);
    if (!p.ok) return p.res;
    const { scopes, mutual, ttlSeconds, maxUses } = p.data;
    const invite = store.createInvite(
      newInviteCode(),
      c.get('agent').id,
      scopes as never,
      mutual,
      ttlSeconds,
      maxUses,
    );
    return c.json({ invite }, 201);
  });

  app.post('/v1/invites/redeem', async (c) => {
    const p = await parse(c, z.object({ code: z.string().min(4).max(64) }));
    if (!p.ok) return p.res;
    const out = store.redeemInvite(normalizeInviteCode(p.data.code), c.get('agent').id);
    if ('error' in out) return bad(c, out.error === 'invalid_code' ? 404 : 409, out.error);
    return c.json(out, 201);
  });

  app.get('/v1/channels', (c) => c.json({ channels: store.channelsFor(c.get('agent').id) }));

  app.delete('/v1/channels/:id', (c) => {
    const ch = store.revokeChannel(c.req.param('id'), c.get('agent').id);
    return ch ? c.json({ channel: ch }) : bad(c, 404, 'not_found');
  });

  app.post('/v1/tasks', async (c) => {
    const p = await parse(c, sendSchema);
    if (!p.ok) return p.res;
    const out = openTask(store, c.get('agent'), store.agentByHandle(p.data.to), {
      kind: p.data.kind,
      project: p.data.project ?? null,
      title: p.data.title ?? null,
      body: p.data.body,
    });
    if ('error' in out) {
      return out.error === 'no_channel'
        ? bad(c, 403, 'no_channel', 'redeem an invite code from this agent first')
        : bad(c, 403, 'scope_not_allowed', { allowed: out.allowed });
    }
    return c.json({ task: out.task }, 201);
  });

  app.get('/v1/tasks', (c) => {
    const box = c.req.query('box') === 'outbox' ? 'outbox' : 'inbox';
    const statuses = c.req.query('status')?.split(',').filter(Boolean) as TaskStatus[] | undefined;
    const n = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
    return c.json({ tasks: store.listTasks(c.get('agent').id, box, statuses ?? null, n) });
  });

  /** Returns the task if the caller is a party to it. */
  function partyTask(c: Context<Env>) {
    const id = c.req.param('id') ?? '';
    const parties = store.taskParties(id);
    const me = c.get('agent').id;
    if (!parties || (parties.senderId !== me && parties.recipientId !== me)) return null;
    return {
      task: store.getTask(id)!,
      isSender: parties.senderId === me,
      isRecipient: parties.recipientId === me,
    };
  }

  app.get('/v1/tasks/:id', (c) => {
    const t = partyTask(c);
    if (!t) return bad(c, 404, 'not_found');
    return c.json({ task: t.task, messages: store.taskMessages(t.task.id) });
  });

  app.post('/v1/tasks/:id/status', async (c) => {
    const t = partyTask(c);
    if (!t) return bad(c, 404, 'not_found');
    const p = await parse(c, statusSchema);
    if (!p.ok) return p.res;
    const { status, result } = p.data;
    const current = t.task.status;
    const allowed =
      status === 'canceled'
        ? t.isSender && !TERMINAL_STATUSES.includes(current)
        : t.isRecipient && RECIPIENT_TRANSITIONS[current].includes(status);
    if (!allowed) return bad(c, 409, 'invalid_transition', { from: current, to: status });
    return c.json({ task: store.updateTaskStatus(t.task.id, status, result ?? null) });
  });

  app.post('/v1/tasks/:id/messages', async (c) => {
    const t = partyTask(c);
    if (!t) return bad(c, 404, 'not_found');
    const p = await parse(c, messageSchema);
    if (!p.ok) return p.res;
    const out = postMessage(store, t.task, c.get('agent'), t.isSender, p.data.body);
    if ('error' in out) return bad(c, 409, out.error);
    return c.json(out, 201);
  });

  /**
   * Server-sent events for the calling agent. Resume with `Last-Event-ID` (or `?since=`);
   * without either, the stream starts from now.
   */
  app.get('/v1/stream', (c) => {
    const me = c.get('agent');
    const resume = c.req.header('last-event-id') ?? c.req.query('since');
    let last = resume !== undefined ? Number(resume) || 0 : store.latestEventSeq(me.id);
    const heartbeatMs = (opts.heartbeatSeconds ?? 15) * 1000;

    return streamSSE(c, async (stream) => {
      const queue: GatewayEvent[] = [];
      let wake: (() => void) | null = null;
      let closed = false;
      const push = (e: GatewayEvent) => {
        queue.push(e);
        wake?.();
      };
      // Subscribe before replaying so nothing slips between the two; seq dedupes the overlap.
      const unsubscribe = hub.subscribe(me.id, push);
      stream.onAbort(() => {
        closed = true;
        unsubscribe();
        wake?.();
      });
      queue.push(...store.eventsSince(me.id, last));

      await stream.writeSSE({
        event: 'ready',
        data: JSON.stringify({ agent: me.handle, since: last }),
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

  mountA2A(app, store, hub, limiter, {
    publicUrl: opts.publicUrl,
    blockingTimeoutMs: (opts.a2aBlockingTimeoutSeconds ?? 300) * 1000,
    heartbeatMs: (opts.heartbeatSeconds ?? 15) * 1000,
  });

  return app;
}
