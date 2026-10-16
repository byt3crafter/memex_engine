import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentCard, Message, SendMessageRequest, Task } from '@a2a-js/sdk';
import {
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  RestTransportFactory,
} from '@a2a-js/sdk/client';
import type { Client, RequestOptions } from '@a2a-js/sdk/client';
import { GrpcTransportFactory } from '@a2a-js/sdk/client/grpc';
import * as grpc from '@grpc/grpc-js';
import type { A2AMessage, A2ATask } from './a2a.js';
import { configDir, loadConfig } from './client.js';
import { newId } from './auth.js';

/**
 * Outbound A2A: lets a gateway agent talk to any A2A agent (Google ADK agents, other
 * gateways, ...) using the official SDK, which handles transport selection (JSON-RPC,
 * HTTP+JSON) and v0.3 peers. Everything here speaks A2A's JSON wire format.
 */

/**
 * Token for an A2A URL. In order: explicit token, `AGW_A2A_TOKEN`, the longest matching
 * URL prefix in `~/.agw/a2a.json` (`{"https://agent.example.com": "token"}`), and finally
 * this agent's own gateway token when the URL is on its own gateway.
 */
export function resolveToken(url: string, explicit?: string): string | undefined {
  if (explicit) return explicit;
  if (process.env.AGW_A2A_TOKEN) return process.env.AGW_A2A_TOKEN;
  try {
    const creds = JSON.parse(readFileSync(join(configDir(), 'a2a.json'), 'utf8')) as Record<
      string,
      string
    >;
    const match = Object.keys(creds)
      .filter((prefix) => url.startsWith(prefix))
      .sort((a, b) => b.length - a.length)[0];
    if (match) return creds[match];
  } catch {
    // no credentials file
  }
  const own = loadConfig();
  if (own && url.startsWith(own.url.replace(/\/$/, ''))) return own.token;
  return undefined;
}

/** Accepts an agent's base URL or the full URL of its agent card. */
function cardLocation(url: string): { base: string; path: string } {
  return url.endsWith('.json')
    ? { base: url, path: '' }
    : { base: url.replace(/\/?$/, '/'), path: '.well-known/agent-card.json' };
}

function withAuth(token: string | undefined): typeof fetch {
  if (!token) return fetch;
  return (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
}

/** An official-SDK client for the agent at `url` (base URL or agent card URL). */
export async function connectA2A(
  url: string,
  token: string | undefined,
  wait = true,
  preferredTransports: string[] = ['JSONRPC', 'HTTP+JSON', 'GRPC'],
): Promise<Client> {
  const fetchImpl = withAuth(token);
  const legacyCompat = { enabled: true };
  const factory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      transports: [
        new JsonRpcTransportFactory({ fetchImpl, legacyCompat }),
        new RestTransportFactory({ fetchImpl, legacyCompat }),
        // gRPC over TLS unless AGW_A2A_GRPC_INSECURE=1 (local setups).
        new GrpcTransportFactory({
          grpcChannelCredentials:
            process.env.AGW_A2A_GRPC_INSECURE === '1'
              ? grpc.credentials.createInsecure()
              : grpc.credentials.createSsl(),
          legacyCompat,
        }),
      ],
      preferredTransports: preferredTransports as never,
      cardResolver: new DefaultAgentCardResolver({ fetchImpl, legacyCompat }),
      clientConfig: { polling: !wait },
    }),
  );
  const { base, path } = cardLocation(url);
  return factory.createFromUrl(base, path);
}

/**
 * Per-call options carrying the bearer token. HTTP transports send it as a header; gRPC
 * sends it as metadata (gRPC won't attach call credentials to a plaintext channel).
 */
export function authOptions(token: string | undefined): RequestOptions {
  return token ? { serviceParameters: { authorization: `Bearer ${token}` } } : {};
}

export async function getAgentCard(url: string, token?: string): Promise<unknown> {
  const { base, path } = cardLocation(url);
  const card = await new DefaultAgentCardResolver({
    fetchImpl: withAuth(resolveToken(url, token)),
    legacyCompat: { enabled: true },
  }).resolve(base, path);
  return AgentCard.toJSON(card);
}

export interface SendOptions {
  token?: string | undefined;
  /** Gateway extension: `message` or `task`, sent as message metadata. */
  kind?: 'message' | 'task' | undefined;
  project?: string | undefined;
  title?: string | undefined;
  /** Continue an existing task (e.g. answer `input_required`). */
  taskId?: string | undefined;
  contextId?: string | undefined;
  /** Files to send as inline parts (base64 data). */
  files?: { filename: string; mediaType: string; data: string }[] | undefined;
  /** Block until the task finishes or needs input (default), or return straight away. */
  wait?: boolean;
}

export async function sendA2A(
  url: string,
  text: string,
  opts: SendOptions = {},
): Promise<{ task: A2ATask } | { message: A2AMessage }> {
  const token = resolveToken(url, opts.token);
  const client = await connectA2A(url, token, opts.wait ?? true);
  const metadata = Object.fromEntries(
    Object.entries({ kind: opts.kind, project: opts.project, title: opts.title }).filter(
      ([, v]) => v !== undefined,
    ),
  );
  const request = SendMessageRequest.fromJSON({
    message: {
      messageId: newId('msg'),
      role: 'ROLE_USER',
      parts: [
        { text },
        ...(opts.files ?? []).map((f) => ({
          raw: f.data,
          filename: f.filename,
          mediaType: f.mediaType,
        })),
      ],
      ...(opts.taskId ? { taskId: opts.taskId } : {}),
      ...(opts.contextId ? { contextId: opts.contextId } : {}),
      ...(Object.keys(metadata).length ? { metadata } : {}),
    },
  });
  const result = await client.sendMessage(request, authOptions(token));
  return 'status' in result
    ? { task: Task.toJSON(result) as A2ATask }
    : { message: Message.toJSON(result) as A2AMessage };
}

export async function getA2ATask(url: string, taskId: string, token?: string): Promise<A2ATask> {
  const auth = resolveToken(url, token);
  const client = await connectA2A(url, auth, true);
  return Task.toJSON(
    await client.getTask({ tenant: '', id: taskId, historyLength: undefined }, authOptions(auth)),
  ) as A2ATask;
}

export async function cancelA2ATask(url: string, taskId: string, token?: string): Promise<A2ATask> {
  const auth = resolveToken(url, token);
  const client = await connectA2A(url, auth, true);
  return Task.toJSON(
    await client.cancelTask({ tenant: '', id: taskId, metadata: undefined }, authOptions(auth)),
  ) as A2ATask;
}

const partText = (parts: { text?: string; url?: string; data?: unknown }[] = []) =>
  parts.map((p) => p.text ?? (p.url ? `[file: ${p.url}]` : JSON.stringify(p.data))).join('\n');

/** Human/LLM-readable digest of an A2A result. */
export function describeA2A(result: { task: A2ATask } | { message: A2AMessage }): string {
  if ('message' in result) return `Reply:\n${partText(result.message.parts)}`;
  const t = result.task;
  const lines = [
    `Task ${t.id}  [${t.status.state.replace('TASK_STATE_', '').toLowerCase()}]  context ${t.contextId}`,
  ];
  if (t.status.message) lines.push(`Status message:\n${partText(t.status.message.parts)}`);
  for (const a of t.artifacts ?? [])
    lines.push(`Artifact ${a.name ?? a.artifactId}:\n${partText(a.parts)}`);
  return lines.join('\n\n');
}
