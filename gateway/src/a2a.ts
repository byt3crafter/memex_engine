import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import type { Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { RateLimiter } from './core.js';
import { GatewayError } from './gateway.js';
import type { AttachmentInput, Gateway } from './gateway.js';
import { SCOPES, TERMINAL_STATUSES } from './types.js';
import type { Principal, Scope, Task, TaskMessage, TaskStatus } from './types.js';

/**
 * A2A (Agent2Agent) protocol v1.0. https://a2a-protocol.org
 *
 * Every gateway agent is also an A2A agent:
 *   GET  /a2a/{handle}/.well-known/agent-card.json   agent card (public only if the owner lists it)
 *   POST /a2a/{handle}                                JSON-RPC binding
 *   /a2a-rest/{handle}/...                            HTTP+JSON binding (tenant = handle), see a2a-sdk.ts
 *   gRPC                                              gRPC binding (tenant = handle), see a2a-sdk.ts
 *
 * All bindings call {@link A2AService}, which maps A2A onto gateway conversations
 * (`contextId` = conversation id) and tasks, so A2A callers get exactly the same
 * permissions, owner approvals and runner handling as everyone else.
 */

export const A2A_PROTOCOL_VERSION = '1.0';
export const A2A_CONTENT_TYPE = 'application/a2a+json';

// ---- wire types (ProtoJSON: camelCase fields, enums as their names) ----

export type A2ATaskState =
  | 'TASK_STATE_SUBMITTED'
  | 'TASK_STATE_WORKING'
  | 'TASK_STATE_COMPLETED'
  | 'TASK_STATE_FAILED'
  | 'TASK_STATE_CANCELED'
  | 'TASK_STATE_INPUT_REQUIRED'
  | 'TASK_STATE_REJECTED'
  | 'TASK_STATE_AUTH_REQUIRED';

export interface A2APart {
  text?: string;
  raw?: string;
  url?: string;
  data?: unknown;
  filename?: string;
  mediaType?: string;
  metadata?: Record<string, unknown>;
}

export interface A2AMessage {
  messageId: string;
  contextId?: string;
  taskId?: string;
  role: 'ROLE_USER' | 'ROLE_AGENT';
  parts: A2APart[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
  referenceTaskIds?: string[];
}

export interface A2ATaskStatus {
  state: A2ATaskState;
  message?: A2AMessage;
  timestamp?: string;
}

export interface A2AArtifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: A2APart[];
}

export interface A2ATask {
  id: string;
  contextId: string;
  status: A2ATaskStatus;
  artifacts?: A2AArtifact[];
  history?: A2AMessage[];
  metadata?: Record<string, unknown>;
}

export interface A2APushConfig {
  id?: string;
  taskId?: string;
  url: string;
  token?: string;
  authentication?: { scheme: string; credentials?: string };
  tenant?: string;
}

export type A2AStreamResponse =
  | { task: A2ATask }
  | { message: A2AMessage }
  | { statusUpdate: { taskId: string; contextId: string; status: A2ATaskStatus } }
  | {
      artifactUpdate: {
        taskId: string;
        contextId: string;
        artifact: A2AArtifact;
        lastChunk?: boolean;
      };
    };

const STATE: Record<TaskStatus, A2ATaskState> = {
  pending_approval: 'TASK_STATE_SUBMITTED',
  submitted: 'TASK_STATE_SUBMITTED',
  working: 'TASK_STATE_WORKING',
  reviewing: 'TASK_STATE_WORKING',
  input_required: 'TASK_STATE_INPUT_REQUIRED',
  completed: 'TASK_STATE_COMPLETED',
  failed: 'TASK_STATE_FAILED',
  rejected: 'TASK_STATE_REJECTED',
  canceled: 'TASK_STATE_CANCELED',
};
const FROM_STATE: Partial<Record<A2ATaskState, TaskStatus>> = {
  TASK_STATE_SUBMITTED: 'submitted',
  TASK_STATE_WORKING: 'working',
  TASK_STATE_INPUT_REQUIRED: 'input_required',
  TASK_STATE_COMPLETED: 'completed',
  TASK_STATE_FAILED: 'failed',
  TASK_STATE_REJECTED: 'rejected',
  TASK_STATE_CANCELED: 'canceled',
};

/** Terminal or interrupted: where a blocking SendMessage returns and a stream ends. */
const settled = (t: Task) => TERMINAL_STATUSES.includes(t.status) || t.status === 'input_required';

// ---- errors ----

export const A2A_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  taskNotFound: -32001,
  taskNotCancelable: -32002,
  pushNotSupported: -32003,
  unsupportedOperation: -32004,
  contentTypeNotSupported: -32005,
  extendedCardNotConfigured: -32007,
  versionNotSupported: -32009,
} as const;

export class A2AFault extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
    readonly httpStatus: 200 | 401 | 403 | 404 | 429 = 200,
  ) {
    super(message);
  }
}

/** Gateway errors in A2A terms. */
function translate(err: unknown): never {
  if (err instanceof GatewayError) {
    if (err.status === 403)
      throw new A2AFault(
        A2A_ERRORS.invalidRequest,
        `Forbidden: ${err.message}`,
        { reason: err.code },
        403,
      );
    if (err.status === 404)
      throw new A2AFault(A2A_ERRORS.taskNotFound, 'Not found', { reason: err.code });
    if (err.status === 429)
      throw new A2AFault(A2A_ERRORS.invalidRequest, err.message, { reason: err.code }, 429);
    if (err.status === 409 && err.code === 'task_closed') {
      throw new A2AFault(A2A_ERRORS.unsupportedOperation, 'Task is in a terminal state');
    }
    throw new A2AFault(A2A_ERRORS.invalidParams, err.message, { reason: err.code });
  }
  throw err;
}

// ---- conversions ----

export function toA2ATask(
  task: Task,
  thread: TaskMessage[],
  opts: { historyLength?: number | undefined; includeArtifacts?: boolean } = {},
): A2ATask {
  const base = { contextId: task.contextId, taskId: task.id };
  let history: A2AMessage[] = [
    {
      messageId: `${task.id}-0`,
      ...base,
      role: 'ROLE_USER',
      parts: [{ text: task.body }],
      metadata: { kind: task.kind, project: task.project, title: task.title },
    },
    ...thread.map(
      (m): A2AMessage => ({
        messageId: m.id,
        ...base,
        role: m.author === task.from ? 'ROLE_USER' : 'ROLE_AGENT',
        parts: [{ text: m.body }],
      }),
    ),
  ];
  if (opts.historyLength !== undefined) {
    history = opts.historyLength > 0 ? history.slice(-opts.historyLength) : [];
  }
  const out: A2ATask = {
    id: task.id,
    contextId: task.contextId,
    status: toA2AStatus(task),
    history,
    metadata: {
      from: task.from,
      to: task.to,
      kind: task.kind,
      project: task.project,
      gatewayStatus: task.status,
    },
  };
  if (opts.includeArtifacts !== false) out.artifacts = resultArtifacts(task);
  return out;
}

function statusText(task: Task): string | null {
  if (task.status === 'pending_approval')
    return `Waiting for the owner of ${task.to} to approve this request.`;
  if (task.status === 'reviewing')
    return `${task.to} has answered; the reply is waiting for its owner’s review.`;
  return task.result && task.status !== 'completed' ? task.result : null;
}

function toA2AStatus(task: Task): A2ATaskStatus {
  const status: A2ATaskStatus = { state: STATE[task.status], timestamp: task.updatedAt };
  const text = statusText(task);
  if (text) {
    status.message = {
      messageId: `${task.id}-status-${Date.parse(task.updatedAt)}`,
      contextId: task.contextId,
      taskId: task.id,
      role: 'ROLE_AGENT',
      parts: [{ text }],
    };
  }
  return status;
}

function resultArtifacts(task: Task): A2AArtifact[] {
  return task.status === 'completed' && task.result
    ? [{ artifactId: 'result', name: 'result', parts: [{ text: task.result }] }]
    : [];
}

/** Text parts pass through, data becomes JSON, links stay links; inline files become attachments. */
export function partsToInput(parts: A2APart[]): { text: string; attachments: AttachmentInput[] } {
  const attachments: AttachmentInput[] = [];
  const text = parts
    .map((p) => {
      if (p.text !== undefined) return p.text;
      if (p.data !== undefined) return '```json\n' + JSON.stringify(p.data, null, 2) + '\n```';
      const label = [p.filename, p.mediaType && `(${p.mediaType})`].filter(Boolean).join(' ');
      if (p.url !== undefined) return `[file${label ? ` ${label}` : ''}: ${p.url}]`;
      attachments.push({
        filename: p.filename || 'file',
        mediaType: p.mediaType || 'application/octet-stream',
        data: p.raw ?? '',
      });
      return null;
    })
    .filter((t): t is string => t !== null)
    .join('\n\n');
  return { text, attachments };
}

// ---- request schemas ----

const partSchema = z
  .object({
    text: z.string().optional(),
    raw: z.string().optional(),
    url: z.string().optional(),
    data: z.unknown().optional(),
    filename: z.string().optional(),
    mediaType: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (p) => [p.text, p.raw, p.url, p.data].filter((v) => v !== undefined).length === 1,
    'a part must have exactly one of text, raw, url or data',
  );

const pushSchema = z.object({
  id: z.string().optional(),
  taskId: z.string().optional(),
  tenant: z.string().optional(),
  url: z.string().url(),
  token: z.string().optional(),
  authentication: z.object({ scheme: z.string(), credentials: z.string().optional() }).optional(),
});

export const sendSchema = z.object({
  tenant: z.string().optional(),
  message: z.object({
    messageId: z.string().min(1),
    contextId: z.string().optional(),
    taskId: z.string().optional(),
    role: z.literal('ROLE_USER'),
    parts: z.array(partSchema).min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
    extensions: z.array(z.string()).optional(),
    referenceTaskIds: z.array(z.string()).optional(),
  }),
  configuration: z
    .object({
      acceptedOutputModes: z.array(z.string()).optional(),
      historyLength: z.number().int().min(0).optional(),
      returnImmediately: z.boolean().optional(),
      taskPushNotificationConfig: pushSchema.optional(),
    })
    .passthrough()
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const idSchema = z.object({
  tenant: z.string().optional(),
  id: z.string().min(1),
  historyLength: z.number().int().min(0).optional(),
});

const listSchema = z.object({
  tenant: z.string().optional(),
  contextId: z.string().optional(),
  status: z.string().optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
  historyLength: z.number().int().min(0).optional(),
  statusTimestampAfter: z.string().optional(),
  includeArtifacts: z.boolean().optional(),
});

const pushIdSchema = z.object({
  tenant: z.string().optional(),
  taskId: z.string().min(1),
  id: z.string().min(1),
});
const pushListSchema = z.object({ tenant: z.string().optional(), taskId: z.string().min(1) });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const out = schema.safeParse(value ?? {});
  if (!out.success)
    throw new A2AFault(A2A_ERRORS.invalidParams, 'Invalid params', z.treeifyError(out.error));
  return out.data;
}

// ---- the service ----

export interface A2AOptions {
  publicUrl?: string | undefined;
  /** Optional cap on blocking SendMessage; by default it waits as long as the caller stays connected. */
  blockingTimeoutMs?: number | undefined;
  heartbeatMs: number;
  /** Allow push notifications to loopback/private addresses. */
  allowPrivateWebhooks: boolean;
}

export class A2AService {
  /** Extra bindings, filled in once their listeners are up (see listen.ts). */
  bindings: { rest: boolean; grpcAddress: string | null } = { rest: false, grpcAddress: null };

  constructor(
    readonly gateway: Gateway,
    readonly opts: A2AOptions,
  ) {
    gateway.onTaskChange((task) => void this.notify(task));
  }

  agent(handle: string | undefined): Principal {
    const target = handle ? this.gateway.store.principalByHandle(handle) : null;
    if (!target || target.kind !== 'agent')
      throw new A2AFault(A2A_ERRORS.invalidRequest, 'Unknown agent', undefined, 404);
    return target;
  }

  /** Unlisted agents' cards are only shown to their owner, themselves, and callers with access. */
  canSeeCard(target: Principal, viewer: Principal | null): boolean {
    if (target.discoverable) return true;
    if (!viewer) return false;
    return (
      viewer.id === target.id ||
      viewer.id === target.ownerId ||
      Boolean(this.gateway.access(viewer, target))
    );
  }

  card(target: Principal, baseUrl: string) {
    const interfaces: {
      url: string;
      protocolBinding: string;
      protocolVersion: string;
      tenant?: string;
    }[] = [
      {
        url: `${baseUrl}/a2a/${target.handle}`,
        protocolBinding: 'JSONRPC',
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ];
    if (this.bindings.rest) {
      interfaces.push({
        url: `${baseUrl}/a2a-rest`,
        protocolBinding: 'HTTP+JSON',
        protocolVersion: A2A_PROTOCOL_VERSION,
        tenant: target.handle,
      });
    }
    if (this.bindings.grpcAddress) {
      interfaces.push({
        url: this.bindings.grpcAddress,
        protocolBinding: 'GRPC',
        protocolVersion: A2A_PROTOCOL_VERSION,
        tenant: target.handle,
      });
    }
    return {
      name: target.handle,
      description:
        target.description ??
        `${target.handle}${target.owner ? ` (${target.owner}’s agent)` : ''}, reachable through Agent Gateway.`,
      supportedInterfaces: interfaces,
      provider: { organization: 'Agent Gateway', url: baseUrl },
      version: '0.3.0',
      capabilities: { streaming: true, pushNotifications: true, extendedAgentCard: false },
      securitySchemes: {
        gateway: {
          httpAuthSecurityScheme: {
            scheme: 'Bearer',
            description:
              'An Agent Gateway token. The caller also needs access to this agent: redeem an invite ' +
              'code from its owner (POST /v1/invites/redeem). The owner may approve requests first.',
          },
        },
      },
      securityRequirements: [{ schemes: { gateway: { list: [] } } }],
      defaultInputModes: ['text/plain', 'application/json', '*/*'],
      defaultOutputModes: ['text/plain'],
      skills: [
        {
          id: 'message',
          name: 'Ask',
          description:
            'Questions and discussion; the agent does not change anything. This is the default, or set ' +
            'message metadata {"kind": "message"}.',
          tags: ['question', 'read-only'],
          examples: ['How is authentication implemented in this project?'],
        },
        {
          id: 'task',
          name: 'Do work',
          description:
            'Work that may change files in one of the owner’s projects. Set message metadata ' +
            '{"kind": "task", "project": "<name>"}. Needs access with the task scope.',
          tags: ['task', 'coding'],
          examples: ['Add rate limiting to the login endpoint and summarise the change.'],
        },
      ],
    };
  }

  /** A task the caller sent to `target`; anything else reads as not found. */
  private ownTask(caller: Principal, target: Principal, taskId: string) {
    const t = this.gateway.taskRow(taskId);
    if (!t || t.senderId !== caller.id || t.recipientId !== target.id) {
      throw new A2AFault(A2A_ERRORS.taskNotFound, 'Task not found');
    }
    return t;
  }

  private view(taskId: string, historyLength?: number, includeArtifacts = true): A2ATask {
    const task = this.gateway.store.getTask(taskId)!;
    return toA2ATask(task, this.gateway.store.taskMessages(taskId), {
      historyLength,
      includeArtifacts,
    });
  }

  /** Start a task (or continue one via `message.taskId`), registering any push config. */
  begin(
    caller: Principal,
    target: Principal,
    raw: unknown,
  ): { taskId: string; historyLength?: number } {
    const p = parse(sendSchema, raw);
    const { message } = p;
    const { text, attachments } = partsToInput(message.parts);
    const files = attachments.length ? attachments : undefined;
    let task: Task;
    try {
      if (message.taskId) {
        this.ownTask(caller, target, message.taskId);
        const t = this.gateway.taskRow(message.taskId)!;
        if (message.contextId && message.contextId !== t.contextId) {
          throw new A2AFault(A2A_ERRORS.invalidParams, 'contextId does not match the task');
        }
        task = this.gateway.continueTask(caller, message.taskId, text, files);
      } else {
        const meta = { ...p.metadata, ...message.metadata };
        const kind = (meta.kind ?? 'message') as Scope;
        if (!SCOPES.includes(kind)) {
          throw new A2AFault(
            A2A_ERRORS.invalidParams,
            `metadata.kind must be one of: ${SCOPES.join(', ')}`,
          );
        }
        const str = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 200) : null);
        const input = {
          kind,
          project: str(meta.project),
          title: str(meta.title),
          body: text,
          ...(files ? { attachments: files } : {}),
        };
        task = message.contextId
          ? (this.gateway.getConversation(caller, message.contextId),
            this.gateway.sendInConversation(caller, message.contextId, target, input))
          : this.gateway.sendDirect(caller, target.handle, input);
      }
    } catch (err) {
      if (err instanceof A2AFault) throw err;
      translate(err);
    }
    const push = p.configuration?.taskPushNotificationConfig;
    if (push) this.createPush(caller, target, { ...push, taskId: task!.id });
    return {
      taskId: task!.id,
      ...(p.configuration?.historyLength !== undefined
        ? { historyLength: p.configuration.historyLength }
        : {}),
    };
  }

  async send(
    caller: Principal,
    target: Principal,
    raw: unknown,
    signal?: AbortSignal,
  ): Promise<{ task: A2ATask }> {
    const { taskId, historyLength } = this.begin(caller, target, raw);
    const returnImmediately = (raw as { configuration?: { returnImmediately?: boolean } })
      ?.configuration?.returnImmediately;
    if (!returnImmediately) {
      await this.gateway.hub.waitForTask(caller.id, taskId, settled, {
        timeoutMs: this.opts.blockingTimeoutMs,
        signal,
      });
    }
    return { task: this.view(taskId, historyLength) };
  }

  getTask(caller: Principal, target: Principal, raw: unknown): A2ATask {
    const p = parse(idSchema, raw);
    this.ownTask(caller, target, p.id);
    return this.view(p.id, p.historyLength);
  }

  listTasks(caller: Principal, target: Principal, raw: unknown) {
    const p = parse(listSchema, raw);
    const status = p.status ? FROM_STATE[p.status as A2ATaskState] : undefined;
    if (p.status && !status)
      throw new A2AFault(A2A_ERRORS.invalidParams, `Unknown status ${p.status}`);
    const pageSize = p.pageSize ?? 50;
    const offset = Number(p.pageToken || 0);
    if (!Number.isInteger(offset) || offset < 0)
      throw new A2AFault(A2A_ERRORS.invalidParams, 'Invalid pageToken');
    const { tasks, total } = this.gateway.store.listTasksBetween(
      caller.id,
      target.id,
      {
        ...(p.contextId ? { contextId: p.contextId } : {}),
        ...(status ? { status } : {}),
        ...(p.statusTimestampAfter ? { updatedAfter: p.statusTimestampAfter } : {}),
      },
      pageSize,
      offset,
    );
    return {
      tasks: tasks.map((t) => this.view(t.id, p.historyLength, p.includeArtifacts ?? false)),
      nextPageToken: offset + tasks.length < total ? String(offset + tasks.length) : '',
      pageSize,
      totalSize: total,
    };
  }

  cancel(caller: Principal, target: Principal, raw: unknown): A2ATask {
    const p = parse(idSchema, raw);
    const t = this.ownTask(caller, target, p.id);
    if (TERMINAL_STATUSES.includes(t.status)) {
      throw new A2AFault(A2A_ERRORS.taskNotCancelable, `Task is already ${t.status}`);
    }
    try {
      this.gateway.setTaskStatus(caller, t.id, 'canceled', null);
    } catch (err) {
      translate(err);
    }
    return this.view(t.id);
  }

  /** Validates a SubscribeToTask request; then stream with {@link events}. */
  subscribeCheck(caller: Principal, target: Principal, raw: unknown): string {
    const p = parse(idSchema, raw);
    const t = this.ownTask(caller, target, p.id);
    if (TERMINAL_STATUSES.includes(t.status)) {
      throw new A2AFault(A2A_ERRORS.unsupportedOperation, `Task is already ${t.status}`);
    }
    return t.id;
  }

  /**
   * The task, then status/artifact updates until it settles (or `signal` aborts).
   * Yields `null` when idle so transports can send keep-alives.
   */
  async *events(
    caller: Principal,
    taskId: string,
    historyLength: number | undefined,
    signal?: AbortSignal,
  ): AsyncGenerator<A2AStreamResponse | null> {
    const queue: Task[] = [];
    let wake: (() => void) | null = null;
    const unsubscribe = this.gateway.hub.subscribe(caller.id, (e) => {
      if (e.taskId !== taskId || (e.type !== 'task.updated' && e.type !== 'task.created')) return;
      queue.push(e.data as Task);
      wake?.();
    });
    const onAbort = () => wake?.();
    signal?.addEventListener('abort', onAbort);
    try {
      const current = this.gateway.store.getTask(taskId)!;
      yield { task: this.view(taskId, historyLength) };
      let done = settled(current);
      let lastStatus = current.status;
      while (!done && !signal?.aborted) {
        while (queue.length && !done) {
          const t = queue.shift()!;
          if (t.status === lastStatus && t.status !== 'input_required') continue;
          lastStatus = t.status;
          const artifact = resultArtifacts(t)[0];
          if (artifact)
            yield { artifactUpdate: { taskId, contextId: t.contextId, artifact, lastChunk: true } };
          yield { statusUpdate: { taskId, contextId: t.contextId, status: toA2AStatus(t) } };
          done = settled(t);
        }
        if (done || signal?.aborted) break;
        const idle = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(true), this.opts.heartbeatMs);
          wake = () => {
            clearTimeout(timer);
            resolve(false);
          };
        });
        wake = null;
        // null = keep-alive for transports that need one.
        if (idle) yield null;
      }
    } finally {
      unsubscribe();
      signal?.removeEventListener('abort', onAbort);
    }
  }

  // ---- push notifications ----

  createPush(caller: Principal, target: Principal, raw: unknown): A2APushConfig {
    const p = parse(pushSchema, raw);
    if (!p.taskId) throw new A2AFault(A2A_ERRORS.invalidParams, 'taskId is required');
    this.ownTask(caller, target, p.taskId);
    const url = new URL(p.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new A2AFault(A2A_ERRORS.invalidParams, 'Push URL must be http(s)');
    }
    const row = this.gateway.store.createPushConfig({
      ...(p.id ? { id: p.id } : {}),
      taskId: p.taskId,
      principalId: caller.id,
      url: p.url,
      token: p.token ?? null,
      authScheme: p.authentication?.scheme ?? null,
      authCredentials: p.authentication?.credentials ?? null,
    });
    return this.pushView(row);
  }

  getPush(caller: Principal, target: Principal, raw: unknown): A2APushConfig {
    const p = parse(pushIdSchema, raw);
    this.ownTask(caller, target, p.taskId);
    const row = this.gateway.store.pushConfig(p.id);
    if (!row || row.taskId !== p.taskId)
      throw new A2AFault(A2A_ERRORS.taskNotFound, 'Push config not found');
    return this.pushView(row);
  }

  listPush(caller: Principal, target: Principal, raw: unknown) {
    const p = parse(pushListSchema, raw);
    this.ownTask(caller, target, p.taskId);
    return {
      configs: this.gateway.store.pushConfigsForTask(p.taskId).map((r) => this.pushView(r)),
      nextPageToken: '',
    };
  }

  deletePush(caller: Principal, target: Principal, raw: unknown): void {
    const p = parse(pushIdSchema, raw);
    this.ownTask(caller, target, p.taskId);
    const row = this.gateway.store.pushConfig(p.id);
    if (row?.taskId === p.taskId) this.gateway.store.deletePushConfig(p.id);
  }

  private pushView(r: {
    id: string;
    taskId: string;
    url: string;
    token: string | null;
    authScheme: string | null;
  }): A2APushConfig {
    return {
      id: r.id,
      taskId: r.taskId,
      url: r.url,
      ...(r.token ? { token: r.token } : {}),
      ...(r.authScheme ? { authentication: { scheme: r.authScheme } } : {}),
    };
  }

  private chains = new Map<string, Promise<void>>();

  /** POSTs a StreamResponse to each registered webhook, in order per task. */
  private async notify(task: Task): Promise<void> {
    const configs = this.gateway.store.pushConfigsForTask(task.id);
    if (!configs.length) return;
    const payload: A2AStreamResponse = settled(task)
      ? { task: this.view(task.id) }
      : { statusUpdate: { taskId: task.id, contextId: task.contextId, status: toA2AStatus(task) } };
    const body = JSON.stringify(payload);
    const prev = this.chains.get(task.id) ?? Promise.resolve();
    const next = prev.then(() =>
      Promise.all(
        configs.map(async (cfg) => {
          try {
            if (!this.opts.allowPrivateWebhooks && (await isPrivateHost(new URL(cfg.url).hostname)))
              return;
            const headers: Record<string, string> = { 'content-type': A2A_CONTENT_TYPE };
            if (cfg.authScheme && cfg.authCredentials)
              headers.authorization = `${cfg.authScheme} ${cfg.authCredentials}`;
            if (cfg.token) headers['x-a2a-notification-token'] = cfg.token;
            await fetch(cfg.url, {
              method: 'POST',
              headers,
              body,
              signal: AbortSignal.timeout(5000),
              redirect: 'error',
            });
          } catch {
            // Best effort: the client can always GetTask.
          }
        }),
      ).then(() => undefined),
    );
    this.chains.set(task.id, next);
    await next;
    if (this.chains.get(task.id) === next) this.chains.delete(task.id);
  }
}

/** Blocks webhooks into the gateway's own network unless explicitly allowed. */
async function isPrivateHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) return true;
  return addresses.some((ip) =>
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80:|::ffff:(127|10|192\.168)\.)/i.test(
      ip,
    ),
  );
}

// ---- JSON-RPC binding ----

type RpcId = string | number | null;
const rpcResult = (id: RpcId, result: unknown) => ({ jsonrpc: '2.0' as const, id, result });
const rpcError = (id: RpcId, code: number, message: string, data?: unknown) => ({
  jsonrpc: '2.0' as const,
  id,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});

export function mountA2A(
  app: Hono<any>,
  gateway: Gateway,
  limiter: RateLimiter,
  opts: A2AOptions,
): A2AService {
  const service = new A2AService(gateway, opts);
  const baseUrl = (c: Context) => (opts.publicUrl ?? new URL(c.req.url).origin).replace(/\/$/, '');
  const bearer = (c: Context) => {
    const h = c.req.header('authorization') ?? '';
    return h.startsWith('Bearer ') ? h.slice(7) : null;
  };

  app.get('/a2a/:handle/.well-known/agent-card.json', (c) => {
    const target = gateway.store.principalByHandle(c.req.param('handle'));
    const viewer = gateway.authenticate(bearer(c));
    // Unlisted and unknown agents look the same from outside.
    if (!target || target.kind !== 'agent' || !service.canSeeCard(target, viewer)) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(service.card(target, baseUrl(c)));
  });

  app.post('/a2a/:handle', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(rpcError(null, A2A_ERRORS.parse, 'Parse error'));
    }
    if (Array.isArray(body)) {
      return c.json(rpcError(null, A2A_ERRORS.invalidRequest, 'Batch requests are not supported'));
    }
    const req = body as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
    const id: RpcId = typeof req.id === 'string' || typeof req.id === 'number' ? req.id : null;
    if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      return c.json(rpcError(id, A2A_ERRORS.invalidRequest, 'Invalid Request'));
    }

    // Missing version is accepted for leniency; an explicit non-1.x version is not.
    const version = c.req.header('a2a-version') ?? c.req.query('A2A-Version') ?? '';
    if (version && !/^1(\.\d+)?$/.test(version)) {
      return c.json(
        rpcError(id, A2A_ERRORS.versionNotSupported, `A2A version ${version} is not supported`, {
          supported: [A2A_PROTOCOL_VERSION],
        }),
      );
    }

    const caller = gateway.authenticate(bearer(c));
    if (!caller) {
      c.header('WWW-Authenticate', 'Bearer');
      return c.json(
        rpcError(id, A2A_ERRORS.invalidRequest, 'Unauthorized: gateway bearer token required'),
        401,
      );
    }
    if (!limiter.allow(caller.id))
      return c.json(rpcError(id, A2A_ERRORS.invalidRequest, 'Rate limited'), 429);

    try {
      const target = service.agent(c.req.param('handle'));
      const p = req.params;
      switch (req.method) {
        case 'SendMessage':
          return c.json(rpcResult(id, await service.send(caller, target, p, c.req.raw.signal)));
        case 'SendStreamingMessage': {
          const { taskId, historyLength } = service.begin(caller, target, p);
          return sse(c, id, service.events(caller, taskId, historyLength, c.req.raw.signal));
        }
        case 'GetTask':
          return c.json(rpcResult(id, service.getTask(caller, target, p)));
        case 'ListTasks':
          return c.json(rpcResult(id, service.listTasks(caller, target, p)));
        case 'CancelTask':
          return c.json(rpcResult(id, service.cancel(caller, target, p)));
        case 'SubscribeToTask': {
          const taskId = service.subscribeCheck(caller, target, p);
          return sse(c, id, service.events(caller, taskId, undefined, c.req.raw.signal));
        }
        case 'CreateTaskPushNotificationConfig':
          return c.json(rpcResult(id, service.createPush(caller, target, p)));
        case 'GetTaskPushNotificationConfig':
          return c.json(rpcResult(id, service.getPush(caller, target, p)));
        case 'ListTaskPushNotificationConfigs':
          return c.json(rpcResult(id, service.listPush(caller, target, p)));
        case 'DeleteTaskPushNotificationConfig':
          service.deletePush(caller, target, p);
          return c.json(rpcResult(id, {}));
        case 'GetExtendedAgentCard':
          throw new A2AFault(A2A_ERRORS.extendedCardNotConfigured, 'No extended agent card');
        default:
          throw new A2AFault(A2A_ERRORS.methodNotFound, `Method not found: ${req.method}`);
      }
    } catch (err) {
      if (err instanceof A2AFault)
        return c.json(rpcError(id, err.code, err.message, err.data), err.httpStatus);
      if (err instanceof GatewayError) {
        try {
          translate(err);
        } catch (fault) {
          const f = fault as A2AFault;
          return c.json(rpcError(id, f.code, f.message, f.data), f.httpStatus);
        }
      }
      console.error('a2a internal error', err);
      return c.json(rpcError(id, A2A_ERRORS.internal, 'Internal error'));
    }
  });

  /** SSE of JSON-RPC responses wrapping StreamResponse objects. */
  function sse(c: Context, id: RpcId, events: AsyncGenerator<A2AStreamResponse | null>): Response {
    return streamSSE(c, async (stream) => {
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });
      for await (const event of events) {
        if (aborted) break;
        // SSE comment: keeps proxies from closing the connection, ignored by clients.
        if (event === null) await stream.write(': keep-alive\n\n');
        else await stream.writeSSE({ data: JSON.stringify(rpcResult(id, event)) });
      }
    });
  }

  return service;
}
