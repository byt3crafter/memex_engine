import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  Approval,
  ApprovalMode,
  Attachment,
  Channel,
  Conversation,
  ConversationSummary,
  GatewayEvent,
  Message,
  Principal,
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
    readonly serverMessage?: string,
  ) {
    super(
      `${serverMessage && serverMessage !== code ? serverMessage : code} (HTTP ${status})${
        detail && typeof detail === 'string' ? `: ${detail}` : ''
      }`,
    );
  }
}

export interface AttachmentUpload {
  filename: string;
  mediaType: string;
  /** Base64. */
  data: string;
}

export interface InviteOptions {
  /** Which of your agents the code gives access to (people must say; agents default to themselves). */
  agent?: string;
  scopes?: Scope[];
  mutual?: boolean;
  approval?: ApprovalMode;
  /** For a person redeeming: their own agents may use the access too. Default true. */
  includeAgents?: boolean;
  ttlSeconds?: number;
  maxUses?: number;
  /** How long the access lasts once redeemed. Default: until revoked. */
  grantTtlSeconds?: number | null;
}

export interface Invite {
  code: string;
  agent: string;
  scopes: Scope[];
  mutual: boolean;
  approval: ApprovalMode;
  includeAgents: boolean;
  maxUses: number;
  expiresAt: string;
}

export interface Me {
  principal: Principal;
  agents: Principal[];
  channels: Channel[];
  telegramLinked: boolean;
}

/** Typed client for the gateway's REST API. */
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
    if (!res.ok) {
      throw new GatewayError(
        res.status,
        String(json.error ?? 'http_error'),
        json.detail,
        typeof json.message === 'string' ? json.message : undefined,
      );
    }
    return json as T;
  }

  private q(params: Record<string, string | number | undefined>): string {
    const entries = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]): [string, string] => [k, String(v)]);
    return entries.length ? `?${new URLSearchParams(entries)}` : '';
  }

  // ---- identity ----

  /** Register an agent. With a person's session token, the agent belongs to that person. */
  register(handle: string, description?: string, registrationKey?: string) {
    return this.req<{ agent: Principal; token: string }>(
      'POST',
      '/v1/agents',
      { handle, ...(description ? { description } : {}) },
      registrationKey ? { 'x-registration-key': registrationKey } : {},
    );
  }

  signUp(handle: string, password: string, displayName?: string, registrationKey?: string) {
    return this.req<{ person: Principal; token: string; expiresAt: string }>(
      'POST',
      '/v1/people',
      { handle, password, ...(displayName ? { displayName } : {}) },
      registrationKey ? { 'x-registration-key': registrationKey } : {},
    );
  }

  login(handle: string, password: string) {
    return this.req<{ person: Principal; token: string; expiresAt: string }>(
      'POST',
      '/v1/sessions',
      {
        handle,
        password,
      },
    );
  }

  logout() {
    return this.req<{ ok: true }>('DELETE', '/v1/sessions');
  }

  me() {
    return this.req<Me>('GET', '/v1/me');
  }

  myAgents() {
    return this.req<{ agents: Principal[] }>('GET', '/v1/agents');
  }

  updateAgent(
    handle: string,
    patch: { description?: string | null; discoverable?: boolean; paused?: boolean },
  ) {
    return this.req<{ agent: Principal }>(
      'PATCH',
      `/v1/agents/${encodeURIComponent(handle)}`,
      patch,
    );
  }

  rotateAgentToken(handle: string) {
    return this.req<{ agent: Principal; token: string }>(
      'POST',
      `/v1/agents/${encodeURIComponent(handle)}/token`,
    );
  }

  // ---- sharing ----

  createInvite(opts: InviteOptions = {}) {
    return this.req<{ invite: Invite }>('POST', '/v1/invites', opts);
  }

  redeem(code: string) {
    return this.req<{ channels: Channel[] }>('POST', '/v1/invites/redeem', { code });
  }

  channels() {
    return this.req<{ channels: Channel[] }>('GET', '/v1/channels');
  }

  updateChannel(
    id: string,
    patch: {
      scopes?: Scope[];
      approval?: ApprovalMode;
      includeAgents?: boolean;
      expiresAt?: string | null;
    },
  ) {
    return this.req<{ channel: Channel }>('PATCH', `/v1/channels/${encodeURIComponent(id)}`, patch);
  }

  revokeChannel(id: string) {
    return this.req<{ channel: Channel }>('DELETE', `/v1/channels/${encodeURIComponent(id)}`);
  }

  // ---- tasks ----

  send(input: {
    to: string;
    body: string;
    kind?: Scope;
    project?: string;
    title?: string;
    attachments?: AttachmentUpload[];
  }) {
    return this.req<{ task: Task }>('POST', '/v1/tasks', input);
  }

  list(box: 'inbox' | 'outbox' = 'inbox', status?: TaskStatus[], limit = 50) {
    return this.req<{ tasks: Task[] }>(
      'GET',
      `/v1/tasks${this.q({ box, limit, status: status?.length ? status.join(',') : undefined })}`,
    );
  }

  /** The task, its thread, and the recent conversation before it (what the agent may see). */
  get(id: string) {
    return this.req<{ task: Task; messages: TaskMessage[]; context: Message[] }>(
      'GET',
      `/v1/tasks/${encodeURIComponent(id)}`,
    );
  }

  setStatus(
    id: string,
    status: Exclude<TaskStatus, 'submitted' | 'pending_approval' | 'reviewing'>,
    result?: string,
  ) {
    return this.req<{ task: Task }>('POST', `/v1/tasks/${encodeURIComponent(id)}/status`, {
      status,
      ...(result === undefined ? {} : { result }),
    });
  }

  /** Add to a task: as sender, answers `input_required`; otherwise a note on the thread. */
  message(id: string, body: string) {
    return this.req<{ task: Task }>('POST', `/v1/tasks/${encodeURIComponent(id)}/messages`, {
      body,
    });
  }

  // ---- conversations ----

  conversations() {
    return this.req<{ conversations: ConversationSummary[] }>('GET', '/v1/conversations');
  }

  createConversation(input: { title?: string | null; members?: string[] }) {
    return this.req<{ conversation: Conversation }>('POST', '/v1/conversations', input);
  }

  conversation(id: string) {
    return this.req<{ conversation: Conversation }>(
      'GET',
      `/v1/conversations/${encodeURIComponent(id)}`,
    );
  }

  renameConversation(id: string, title: string | null) {
    return this.req<{ conversation: Conversation }>(
      'PATCH',
      `/v1/conversations/${encodeURIComponent(id)}`,
      { title },
    );
  }

  messages(id: string, opts: { before?: number; after?: number; limit?: number } = {}) {
    return this.req<{ messages: Message[] }>(
      'GET',
      `/v1/conversations/${encodeURIComponent(id)}/messages${this.q(opts)}`,
    );
  }

  post(
    id: string,
    input: {
      body: string;
      to?: string[];
      kind?: Scope;
      project?: string | null;
      title?: string | null;
      replyTo?: string | null;
      attachments?: AttachmentUpload[];
    },
  ) {
    return this.req<{ message: Message }>(
      'POST',
      `/v1/conversations/${encodeURIComponent(id)}/messages`,
      input,
    );
  }

  addMember(id: string, handle: string) {
    return this.req<{ conversation: Conversation }>(
      'POST',
      `/v1/conversations/${encodeURIComponent(id)}/members`,
      {
        handle,
      },
    );
  }

  removeMember(id: string, handle: string) {
    return this.req<{ ok: true }>(
      'DELETE',
      `/v1/conversations/${encodeURIComponent(id)}/members/${encodeURIComponent(handle)}`,
    );
  }

  respondToInvitation(id: string, accept: boolean) {
    return this.req<{ conversation: Conversation | null }>(
      'POST',
      `/v1/conversations/${encodeURIComponent(id)}/invitation`,
      { accept },
    );
  }

  markRead(id: string, seq: number) {
    return this.req<{ ok: true }>('POST', `/v1/conversations/${encodeURIComponent(id)}/read`, {
      seq,
    });
  }

  // ---- approvals ----

  approvals(status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending') {
    return this.req<{ approvals: Approval[] }>('GET', `/v1/approvals${this.q({ status })}`);
  }

  decide(id: string, decision: 'approve' | 'reject', opts: { body?: string; note?: string } = {}) {
    return this.req<{ approval: Approval }>('POST', `/v1/approvals/${encodeURIComponent(id)}`, {
      decision,
      ...opts,
    });
  }

  // ---- files ----

  async download(file: Attachment | string): Promise<Uint8Array> {
    const id = typeof file === 'string' ? file : file.id;
    const res = await fetch(new URL(`/v1/files/${encodeURIComponent(id)}`, this.url), {
      headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
    });
    if (!res.ok) throw new GatewayError(res.status, 'download_failed');
    return new Uint8Array(await res.arrayBuffer());
  }

  // ---- Telegram ----

  telegramLinkCode() {
    return this.req<{ code: string; bot: string | null }>('POST', '/v1/telegram/link');
  }

  // ---- live events ----

  /**
   * Follow this principal's event stream, reconnecting with backoff and resuming from the
   * last seen event. Resolves when `signal` aborts.
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
  /** "human" for a signed-in person, "agent" for an agent token. */
  kind?: 'human' | 'agent';
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
  if (!cfg) {
    throw new Error(
      'Not signed in. Run `agw login <handle>` (people) or `agw register <handle>` (agents), or set AGW_URL and AGW_TOKEN.',
    );
  }
  return new GatewayClient(cfg.url, cfg.token);
}
