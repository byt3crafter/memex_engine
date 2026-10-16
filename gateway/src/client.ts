import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  Agent,
  Channel,
  GatewayEvent,
  Scope,
  Task,
  TaskMessage,
  TaskStatus,
} from './types.js';

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: unknown,
  ) {
    super(
      `${code} (HTTP ${status})${detail ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`,
    );
  }
}

export class GatewayClient {
  constructor(
    readonly url: string,
    readonly token?: string,
  ) {}

  private async req<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const res = await fetch(new URL(path, this.url), {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok)
      throw new GatewayError(res.status, String(json.error ?? 'http_error'), json.detail);
    return json as T;
  }

  register(handle: string, description?: string, registrationKey?: string) {
    return this.req<{ agent: Agent; token: string }>(
      'POST',
      '/v1/agents',
      { handle, ...(description ? { description } : {}) },
      registrationKey ? { 'x-registration-key': registrationKey } : {},
    );
  }

  me() {
    return this.req<{ agent: Agent; channels: Channel[] }>('GET', '/v1/me');
  }

  createInvite(
    opts: { scopes?: Scope[]; mutual?: boolean; ttlSeconds?: number; maxUses?: number } = {},
  ) {
    return this.req<{
      invite: {
        code: string;
        scopes: Scope[];
        mutual: boolean;
        maxUses: number;
        expiresAt: string;
      };
    }>('POST', '/v1/invites', opts);
  }

  redeem(code: string) {
    return this.req<{ channels: Channel[] }>('POST', '/v1/invites/redeem', { code });
  }

  channels() {
    return this.req<{ channels: Channel[] }>('GET', '/v1/channels');
  }

  revokeChannel(id: string) {
    return this.req<{ channel: Channel }>('DELETE', `/v1/channels/${encodeURIComponent(id)}`);
  }

  send(input: { to: string; body: string; kind?: Scope; project?: string; title?: string }) {
    return this.req<{ task: Task }>('POST', '/v1/tasks', input);
  }

  list(box: 'inbox' | 'outbox' = 'inbox', status?: TaskStatus[], limit = 50) {
    const q = new URLSearchParams({ box, limit: String(limit) });
    if (status?.length) q.set('status', status.join(','));
    return this.req<{ tasks: Task[] }>('GET', `/v1/tasks?${q}`);
  }

  get(id: string) {
    return this.req<{ task: Task; messages: TaskMessage[] }>(
      'GET',
      `/v1/tasks/${encodeURIComponent(id)}`,
    );
  }

  setStatus(id: string, status: Exclude<TaskStatus, 'submitted'>, result?: string) {
    return this.req<{ task: Task }>('POST', `/v1/tasks/${encodeURIComponent(id)}/status`, {
      status,
      ...(result === undefined ? {} : { result }),
    });
  }

  message(id: string, body: string) {
    return this.req<{ message: TaskMessage; task: Task }>(
      'POST',
      `/v1/tasks/${encodeURIComponent(id)}/messages`,
      {
        body,
      },
    );
  }

  /**
   * Follow this agent's event stream, reconnecting with backoff and resuming from the last
   * seen event. Resolves when `signal` aborts.
   */
  async subscribe(
    onEvent: (e: GatewayEvent) => void | Promise<void>,
    opts: {
      signal?: AbortSignal;
      since?: number;
      onConnect?: () => void | Promise<void>;
      onError?: (err: unknown) => void;
    } = {},
  ): Promise<void> {
    let last: number | undefined = opts.since;
    let backoff = 1000;
    while (!opts.signal?.aborted) {
      try {
        const res = await fetch(new URL('/v1/stream', this.url), {
          headers: {
            authorization: `Bearer ${this.token}`,
            accept: 'text/event-stream',
            ...(last === undefined ? {} : { 'last-event-id': String(last) }),
          },
          ...(opts.signal ? { signal: opts.signal } : {}),
        });
        if (!res.ok || !res.body) {
          const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          throw new GatewayError(res.status, String(json.error ?? 'stream_failed'));
        }
        backoff = 1000;
        await opts.onConnect?.();
        for await (const frame of sseFrames(res.body)) {
          if (frame.event === 'ready' || frame.event === 'ping' || !frame.data) continue;
          const event = JSON.parse(frame.data) as GatewayEvent;
          last = event.seq;
          await onEvent(event);
        }
      } catch (err) {
        if (opts.signal?.aborted) return;
        if (err instanceof GatewayError && err.status === 401) throw err;
        opts.onError?.(err);
      }
      if (opts.signal?.aborted) return;
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 30_000);
    }
  }
}

async function* sseFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }> {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      yield { event, data: data.join('\n') };
    }
  }
}

// ---- local config (~/.agw/config.json) ----

export interface LocalConfig {
  url: string;
  token: string;
  handle: string;
}

export function configDir(): string {
  return process.env.AGW_HOME ?? join(homedir(), '.agw');
}

export function loadConfig(): LocalConfig | null {
  if (process.env.AGW_URL && process.env.AGW_TOKEN) {
    return {
      url: process.env.AGW_URL,
      token: process.env.AGW_TOKEN,
      handle: process.env.AGW_HANDLE ?? '',
    };
  }
  try {
    return JSON.parse(readFileSync(join(configDir(), 'config.json'), 'utf8')) as LocalConfig;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: LocalConfig): string {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const path = join(configDir(), 'config.json');
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  return path;
}

export function clientFromConfig(): GatewayClient {
  const cfg = loadConfig();
  if (!cfg)
    throw new Error(
      'Not registered. Run `agw register <handle> --url <gateway-url>` first (or set AGW_URL and AGW_TOKEN).',
    );
  return new GatewayClient(cfg.url, cfg.token);
}
