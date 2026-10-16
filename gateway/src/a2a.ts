import type { Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { authenticate, openTask, postMessage } from './core.js';
import type { Hub, RateLimiter } from './core.js';
import type { Store } from './store.js';
import { SCOPES, TERMINAL_STATUSES } from './types.js';
import type { Agent, GatewayEvent, Scope, Task, TaskMessage, TaskStatus } from './types.js';

/**
 * A2A (Agent2Agent) protocol v1.0, JSON-RPC binding. https://a2a-protocol.org
 *
 * Every gateway agent is also an A2A agent:
 *   GET  /a2a/{handle}/.well-known/agent-card.json   agent card (public)
 *   POST /a2a/{handle}                                JSON-RPC endpoint
 *
 * A2A callers authenticate with a gateway token and need a channel to the agent, exactly
 * like REST callers: any A2A client can talk to a gateway agent once it registers and
 * redeems that agent's invite code. A2A tasks are ordinary gateway tasks, so the
 * recipient's runner, inbox and MCP tools handle them unchanged.
 */

export const A2A_PROTOCOL_VERSION = '1.0';

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

const STATE: Record<TaskStatus, A2ATaskState> = {
  submitted: 'TASK_STATE_SUBMITTED',
  working: 'TASK_STATE_WORKING',
  input_required: 'TASK_STATE_INPUT_REQUIRED',
  completed: 'TASK_STATE_COMPLETED',
  failed: 'TASK_STATE_FAILED',
  rejected: 'TASK_STATE_REJECTED',
  canceled: 'TASK_STATE_CANCELED',
};
const FROM_STATE = Object.fromEntries(Object.entries(STATE).map(([k, v]) => [v, k])) as Record<
  A2ATaskState,
  TaskStatus | undefined
>;

/** Terminal or interrupted: where a blocking SendMessage returns and a stream ends. */
const settled = (t: Task) => TERMINAL_STATUSES.includes(t.status) || t.status === 'input_required';

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
    metadata: { from: task.from, to: task.to, kind: task.kind, project: task.project },
  };
  if (opts.includeArtifacts !== false) out.artifacts = resultArtifacts(task);
  return out;
}

function toA2AStatus(task: Task): A2ATaskStatus {
  const status: A2ATaskStatus = { state: STATE[task.status], timestamp: task.updatedAt };
  // A completed task's result is its artifact; for any other outcome the result explains it.
  if (task.result && task.status !== 'completed') {
    status.message = {
      messageId: `${task.id}-status-${Date.parse(task.updatedAt)}`,
      contextId: task.contextId,
      taskId: task.id,
      role: 'ROLE_AGENT',
      parts: [{ text: task.result }],
    };
  }
  return status;
}

function resultArtifacts(task: Task): A2AArtifact[] {
  return task.status === 'completed' && task.result
    ? [{ artifactId: 'result', name: 'result', parts: [{ text: task.result }] }]
    : [];
}

/** Flattens A2A parts into the text the receiving agent sees. */
export function partsToText(parts: A2APart[]): string {
  return parts
    .map((p) => {
      if (p.text !== undefined) return p.text;
      if (p.data !== undefined) return '```json\n' + JSON.stringify(p.data, null, 2) + '\n```';
      const label = [p.filename, p.mediaType && `(${p.mediaType})`].filter(Boolean).join(' ');
      if (p.url !== undefined) return `[file${label ? ` ${label}` : ''}: ${p.url}]`;
      return `[inline file${label ? ` ${label}` : ''} omitted: inline files are not supported yet]`;
    })
    .join('\n\n');
}

export function agentCard(agent: Agent, baseUrl: string) {
  return {
    name: agent.handle,
    description: agent.description ?? `${agent.handle}, reachable through Agent Gateway.`,
    supportedInterfaces: [
      {
        url: `${baseUrl}/a2a/${agent.handle}`,
        protocolBinding: 'JSONRPC',
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ],
    provider: { organization: 'Agent Gateway', url: baseUrl },
    version: '0.1.0',
    capabilities: { streaming: true, pushNotifications: false, extendedAgentCard: false },
    securitySchemes: {
      gateway: {
        httpAuthSecurityScheme: {
          scheme: 'Bearer',
          description:
            'An Agent Gateway token (POST /v1/agents). The caller also needs a channel to this ' +
            'agent: redeem an invite code from its owner (POST /v1/invites/redeem).',
        },
      },
    },
    securityRequirements: [{ schemes: { gateway: { list: [] } } }],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain'],
    skills: [
      {
        id: 'message',
        name: 'Ask',
        description:
          'Questions and discussion; the receiving agent does not change anything. This is the ' +
          'default, or set message metadata {"kind": "message"}.',
        tags: ['question', 'read-only'],
        examples: ['How is authentication implemented in this project?'],
      },
      {
        id: 'task',
        name: 'Do work',
        description:
          'Work that may change files in one of the owner’s projects. Set message metadata ' +
          '{"kind": "task", "project": "<name>"}. Needs a channel with the task scope.',
        tags: ['task', 'coding'],
        examples: ['Add rate limiting to the login endpoint and summarise the change.'],
      },
    ],
  };
}

// ---- JSON-RPC ----

const ERR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  taskNotFound: -32001,
  taskNotCancelable: -32002,
  pushNotSupported: -32003,
  unsupportedOperation: -32004,
  extendedCardNotConfigured: -32007,
  versionNotSupported: -32009,
} as const;

type RpcId = string | number | null;

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
    readonly httpStatus: 200 | 403 = 200,
  ) {
    super(message);
  }
}

const rpcResult = (id: RpcId, result: unknown) => ({ jsonrpc: '2.0' as const, id, result });
const rpcError = (id: RpcId, code: number, message: string, data?: unknown) => ({
  jsonrpc: '2.0' as const,
  id,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});

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

const messageSchema = z.object({
  messageId: z.string().min(1),
  contextId: z.string().optional(),
  taskId: z.string().optional(),
  role: z.literal('ROLE_USER'),
  parts: z.array(partSchema).min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  extensions: z.array(z.string()).optional(),
  referenceTaskIds: z.array(z.string()).optional(),
});

const sendSchema = z.object({
  tenant: z.string().optional(),
  message: messageSchema,
  configuration: z
    .object({
      acceptedOutputModes: z.array(z.string()).optional(),
      historyLength: z.number().int().min(0).optional(),
      returnImmediately: z.boolean().optional(),
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

function params<T>(schema: z.ZodType<T>, value: unknown): T {
  const out = schema.safeParse(value ?? {});
  if (!out.success)
    throw new RpcError(ERR.invalidParams, 'Invalid params', z.treeifyError(out.error));
  return out.data;
}

export interface A2AOptions {
  publicUrl?: string | undefined;
  blockingTimeoutMs: number;
  heartbeatMs: number;
}

export function mountA2A(
  app: Hono<any>,
  store: Store,
  hub: Hub,
  limiter: RateLimiter,
  opts: A2AOptions,
): void {
  const baseUrl = (c: Context) => (opts.publicUrl ?? new URL(c.req.url).origin).replace(/\/$/, '');

  app.get('/a2a/:handle/.well-known/agent-card.json', (c) => {
    const agent = store.agentByHandle(c.req.param('handle'));
    return agent ? c.json(agentCard(agent, baseUrl(c))) : c.json({ error: 'not_found' }, 404);
  });

  app.post('/a2a/:handle', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(rpcError(null, ERR.parse, 'Parse error'));
    }
    if (Array.isArray(body)) {
      return c.json(rpcError(null, ERR.invalidRequest, 'Batch requests are not supported'));
    }
    const req = body as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
    const id: RpcId = typeof req.id === 'string' || typeof req.id === 'number' ? req.id : null;
    if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      return c.json(rpcError(id, ERR.invalidRequest, 'Invalid Request'));
    }

    // Missing version is accepted for leniency; an explicit non-1.x version is not.
    const version = c.req.header('a2a-version') ?? c.req.query('A2A-Version') ?? '';
    if (version && !/^1(\.\d+)?$/.test(version)) {
      return c.json(
        rpcError(id, ERR.versionNotSupported, `A2A version ${version} is not supported`, {
          supported: [A2A_PROTOCOL_VERSION],
        }),
      );
    }

    const caller = authenticate(store, c.req.header('authorization'));
    if (!caller) {
      c.header('WWW-Authenticate', 'Bearer');
      return c.json(
        rpcError(id, ERR.invalidRequest, 'Unauthorized: gateway bearer token required'),
        401,
      );
    }
    if (!limiter.allow(caller.id))
      return c.json(rpcError(id, ERR.invalidRequest, 'Rate limited'), 429);
    const target = store.agentByHandle(c.req.param('handle'));
    if (!target) return c.json(rpcError(id, ERR.invalidRequest, 'Unknown agent'), 404);

    try {
      return await dispatch(c, id, req.method, req.params, caller, target);
    } catch (err) {
      if (err instanceof RpcError) {
        return c.json(rpcError(id, err.code, err.message, err.data), err.httpStatus);
      }
      console.error('a2a internal error', err);
      return c.json(rpcError(id, ERR.internal, 'Internal error'));
    }
  });

  /** A task `caller` sent to `target`; anything else is "not found". */
  function ownTask(caller: Agent, target: Agent, taskId: string): Task {
    const parties = store.taskParties(taskId);
    if (!parties || parties.senderId !== caller.id || parties.recipientId !== target.id) {
      throw new RpcError(ERR.taskNotFound, 'Task not found');
    }
    return store.getTask(taskId)!;
  }

  async function dispatch(
    c: Context,
    id: RpcId,
    method: string,
    raw: unknown,
    caller: Agent,
    target: Agent,
  ): Promise<Response> {
    switch (method) {
      case 'SendMessage':
      case 'SendStreamingMessage': {
        const p = params(sendSchema, raw);
        const task = receive(caller, target, p);
        const historyLength = p.configuration?.historyLength;
        if (method === 'SendStreamingMessage') return stream(c, id, caller, task.id, historyLength);
        const final = p.configuration?.returnImmediately
          ? task
          : await hub.waitForTask(
              store,
              caller.id,
              task.id,
              settled,
              opts.blockingTimeoutMs,
              c.req.raw.signal,
            );
        return c.json(
          rpcResult(id, {
            task: toA2ATask(final, store.taskMessages(final.id), { historyLength }),
          }),
        );
      }

      case 'GetTask': {
        const p = params(idSchema, raw);
        const task = ownTask(caller, target, p.id);
        return c.json(rpcResult(id, toA2ATask(task, store.taskMessages(task.id), p)));
      }

      case 'ListTasks': {
        const p = params(listSchema, raw);
        const status = p.status ? FROM_STATE[p.status as A2ATaskState] : undefined;
        if (p.status && !status)
          throw new RpcError(ERR.invalidParams, `Unknown status ${p.status}`);
        const pageSize = p.pageSize ?? 50;
        const offset = Number(p.pageToken || 0);
        if (!Number.isInteger(offset) || offset < 0)
          throw new RpcError(ERR.invalidParams, 'Invalid pageToken');
        const { tasks, total } = store.listTasksBetween(
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
        return c.json(
          rpcResult(id, {
            tasks: tasks.map((t) =>
              toA2ATask(t, store.taskMessages(t.id), {
                historyLength: p.historyLength,
                includeArtifacts: p.includeArtifacts ?? false,
              }),
            ),
            nextPageToken: offset + tasks.length < total ? String(offset + tasks.length) : '',
            pageSize,
            totalSize: total,
          }),
        );
      }

      case 'CancelTask': {
        const p = params(idSchema, raw);
        const task = ownTask(caller, target, p.id);
        if (TERMINAL_STATUSES.includes(task.status)) {
          throw new RpcError(ERR.taskNotCancelable, `Task is already ${task.status}`);
        }
        const canceled = store.updateTaskStatus(task.id, 'canceled', null);
        return c.json(rpcResult(id, toA2ATask(canceled, store.taskMessages(task.id))));
      }

      case 'SubscribeToTask': {
        const p = params(idSchema, raw);
        const task = ownTask(caller, target, p.id);
        if (TERMINAL_STATUSES.includes(task.status)) {
          throw new RpcError(ERR.unsupportedOperation, `Task is already ${task.status}`);
        }
        return stream(c, id, caller, task.id, undefined);
      }

      case 'CreateTaskPushNotificationConfig':
      case 'GetTaskPushNotificationConfig':
      case 'ListTaskPushNotificationConfigs':
      case 'DeleteTaskPushNotificationConfig':
        throw new RpcError(ERR.pushNotSupported, 'Push notifications are not supported');

      case 'GetExtendedAgentCard':
        throw new RpcError(ERR.extendedCardNotConfigured, 'No extended agent card');

      default:
        throw new RpcError(ERR.methodNotFound, `Method not found: ${method}`);
    }
  }

  /** Start a new task, or continue one when the message carries a `taskId`. */
  function receive(caller: Agent, target: Agent, p: z.infer<typeof sendSchema>): Task {
    const { message } = p;
    const text = partsToText(message.parts);

    if (message.taskId) {
      const task = ownTask(caller, target, message.taskId);
      if (message.contextId && message.contextId !== task.contextId) {
        throw new RpcError(ERR.invalidParams, 'contextId does not match the task');
      }
      const out = postMessage(store, task, caller, true, text);
      if ('error' in out)
        throw new RpcError(ERR.unsupportedOperation, `Task is already ${task.status}`);
      return out.task;
    }

    const meta = { ...p.metadata, ...message.metadata };
    const kind = (meta.kind ?? 'message') as Scope;
    if (!SCOPES.includes(kind)) {
      throw new RpcError(ERR.invalidParams, `metadata.kind must be one of: ${SCOPES.join(', ')}`);
    }
    const str = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 200) : null);
    const out = openTask(store, caller, target, {
      kind,
      project: str(meta.project),
      title: str(meta.title),
      body: text,
      contextId: message.contextId ?? null,
    });
    if ('error' in out) {
      const why =
        out.error === 'no_channel'
          ? 'no channel to this agent; redeem an invite code from its owner first'
          : `this channel only allows: ${out.allowed.join(', ')}`;
      throw new RpcError(ERR.invalidRequest, `Forbidden: ${why}`, { reason: out.error }, 403);
    }
    return out.task;
  }

  /** SSE stream of StreamResponse objects: the task, then status/artifact updates until settled. */
  function stream(
    c: Context,
    id: RpcId,
    caller: Agent,
    taskId: string,
    historyLength: number | undefined,
  ): Response {
    return streamSSE(c, async (sse) => {
      const queue: GatewayEvent[] = [];
      let wake: (() => void) | null = null;
      let closed = false;
      const unsubscribe = hub.subscribe(caller.id, (e) => {
        if (e.taskId !== taskId) return;
        queue.push(e);
        wake?.();
      });
      sse.onAbort(() => {
        closed = true;
        wake?.();
      });
      const send = (result: unknown) =>
        sse.writeSSE({ data: JSON.stringify(rpcResult(id, result)) });

      try {
        const current = store.getTask(taskId)!;
        await send({ task: toA2ATask(current, store.taskMessages(taskId), { historyLength }) });
        let done = settled(current);
        while (!done && !closed) {
          while (queue.length && !done) {
            const e = queue.shift()!;
            if (e.type !== 'task.updated') continue;
            const t = e.data as Task;
            const artifact = resultArtifacts(t)[0];
            if (artifact) {
              await send({
                artifactUpdate: { taskId, contextId: t.contextId, artifact, lastChunk: true },
              });
            }
            await send({
              statusUpdate: { taskId, contextId: t.contextId, status: toA2AStatus(t) },
            });
            done = settled(t);
          }
          if (done || closed) break;
          const idle = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(true), opts.heartbeatMs);
            wake = () => {
              clearTimeout(timer);
              resolve(false);
            };
          });
          wake = null;
          // SSE comment: keeps proxies from closing the connection, ignored by clients.
          if (idle && !closed) await sse.write(': keep-alive\n\n');
        }
      } finally {
        unsubscribe();
      }
    });
  }
}
