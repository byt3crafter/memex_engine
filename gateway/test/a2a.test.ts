import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { SendMessageRequest, StreamResponse } from '@a2a-js/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cancelA2ATask, connectA2A, getA2ATask, getAgentCard, sendA2A } from '../src/a2a-client.js';
import { GatewayClient } from '../src/client.js';
import { Runner } from '../src/runner.js';
import { createApp } from '../src/server.js';
import { Store } from '../src/store.js';

// These tests drive the gateway with Google's official A2A SDK (@a2a-js/sdk) as the client,
// so they check wire compatibility, not just our own reading of the spec.

let url: string;
let close: () => void;

beforeAll(async () => {
  const app = createApp(new Store(':memory:'), {
    heartbeatSeconds: 1,
    a2aBlockingTimeoutSeconds: 10,
  });
  await new Promise<void>((resolve) => {
    const server = serve(
      { fetch: app.fetch, port: 0, hostname: '127.0.0.1' },
      (info: AddressInfo) => {
        url = `http://127.0.0.1:${info.port}`;
        resolve();
      },
    );
    close = () => server.close();
  });
});
afterAll(() => close());

let n = 0;
async function agent(prefix: string) {
  const { token, agent } = await new GatewayClient(url).register(
    `${prefix}-${++n}`,
    `${prefix} test agent`,
  );
  return {
    client: new GatewayClient(url, token),
    handle: agent.handle,
    token,
    a2a: `${url}/a2a/${agent.handle}`,
  };
}
type TestAgent = Awaited<ReturnType<typeof agent>>;

async function pair(
  sender: TestAgent,
  recipient: TestAgent,
  scopes: ('message' | 'task')[] = ['message', 'task'],
) {
  const { invite } = await recipient.client.createInvite({ scopes });
  await sender.client.redeem(invite.code);
}

/** Plays the recipient: picks up the newest submitted task and finishes it. */
async function finishNext(
  recipient: TestAgent,
  status: 'completed' | 'input_required',
  result: string,
) {
  for (let i = 0; i < 100; i++) {
    const { tasks } = await recipient.client.list('inbox', ['submitted']);
    const t = tasks[0];
    if (t) {
      await recipient.client.setStatus(t.id, 'working');
      await new Promise((r) => setTimeout(r, 30));
      return (await recipient.client.setStatus(t.id, status, result)).task;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('no task arrived');
}

async function rpc(
  target: string,
  method: string,
  params: unknown,
  token?: string,
  headers: Record<string, string> = {},
) {
  const res = await fetch(target, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params }),
  });
  return {
    status: res.status,
    body: (await res.json()) as { result?: any; error?: { code: number; message: string } },
  };
}

describe('A2A agent card', () => {
  it('is served per agent and parsed by the official SDK', async () => {
    const bob = await agent('bob');
    // Unlisted by default: no card without access.
    expect((await fetch(`${bob.a2a}/.well-known/agent-card.json`)).status).toBe(404);
    expect(((await getAgentCard(bob.a2a, bob.token)) as any).name).toBe(bob.handle);
    await bob.client.updateAgent(bob.handle, { discoverable: true });

    const card = (await getAgentCard(bob.a2a)) as any;
    expect(card.name).toBe(bob.handle);
    expect(card.description).toBe('bob test agent');
    expect(card.supportedInterfaces[0]).toMatchObject({
      url: bob.a2a,
      protocolBinding: 'JSONRPC',
      protocolVersion: '1.0',
    });
    expect(card.capabilities.streaming).toBe(true);
    expect(card.skills.map((s: { id: string }) => s.id)).toEqual(['message', 'task']);
    expect(card.securitySchemes.gateway.httpAuthSecurityScheme.scheme).toBe('Bearer');

    // Full card URL works too; unknown agents 404.
    expect(((await getAgentCard(`${bob.a2a}/.well-known/agent-card.json`)) as any).name).toBe(
      bob.handle,
    );
    expect((await fetch(`${url}/a2a/nobody/.well-known/agent-card.json`)).status).toBe(404);
  });
});

describe('A2A JSON-RPC with the official SDK client', () => {
  it('sends, lets the recipient finish, and reads the result back', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    await pair(alice, bob);

    const sent = await sendA2A(bob.a2a, 'What is in the README?', {
      token: alice.token,
      wait: false,
      project: 'docs',
    });
    if (!('task' in sent)) throw new Error('expected a task');
    expect(sent.task.status.state).toBe('TASK_STATE_SUBMITTED');

    // The recipient sees an ordinary gateway task.
    const { task: inbox } = await bob.client.get(sent.task.id);
    expect(inbox).toMatchObject({
      from: alice.handle,
      kind: 'message',
      project: 'docs',
      body: 'What is in the README?',
    });

    await bob.client.setStatus(sent.task.id, 'completed', 'It explains the gateway.');
    const done = await getA2ATask(bob.a2a, sent.task.id, alice.token);
    expect(done.status.state).toBe('TASK_STATE_COMPLETED');
    expect(done.artifacts?.[0]?.parts[0]?.text).toBe('It explains the gateway.');
    expect(done.history?.[0]?.parts[0]?.text).toBe('What is in the README?');
  });

  it('blocks until the task settles by default', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    await pair(alice, bob);
    const [sent] = await Promise.all([
      sendA2A(bob.a2a, 'summarise', { token: alice.token }),
      finishNext(bob, 'completed', 'summary here'),
    ]);
    if (!('task' in sent)) throw new Error('expected a task');
    expect(sent.task.status.state).toBe('TASK_STATE_COMPLETED');
    expect(sent.task.artifacts?.[0]?.parts[0]?.text).toBe('summary here');
  });

  it('continues an input-required task with taskId', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    await pair(alice, bob);
    const [first] = await Promise.all([
      sendA2A(bob.a2a, 'deploy it', { token: alice.token }),
      finishNext(bob, 'input_required', 'Which environment?'),
    ]);
    if (!('task' in first)) throw new Error('expected a task');
    expect(first.task.status.state).toBe('TASK_STATE_INPUT_REQUIRED');
    expect(first.task.status.message?.parts[0]?.text).toBe('Which environment?');

    const second = await sendA2A(bob.a2a, 'staging', {
      token: alice.token,
      taskId: first.task.id,
      contextId: first.task.contextId,
      wait: false,
    });
    if (!('task' in second)) throw new Error('expected a task');
    expect(second.task.id).toBe(first.task.id);
    expect(second.task.status.state).toBe('TASK_STATE_SUBMITTED');
    expect(second.task.history?.map((m) => [m.role, m.parts[0]?.text])).toEqual([
      ['ROLE_USER', 'deploy it'],
      ['ROLE_USER', 'staging'],
    ]);
  });

  it('streams the task, status updates and the result artifact', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    await pair(alice, bob);
    const client = await connectA2A(bob.a2a, alice.token);
    const request = SendMessageRequest.fromJSON({
      message: { messageId: 'm-1', role: 'ROLE_USER', parts: [{ text: 'stream please' }] },
    });

    const events: any[] = [];
    const finishing = finishNext(bob, 'completed', 'streamed result');
    for await (const event of client.sendMessageStream(request))
      events.push(StreamResponse.toJSON(event));
    await finishing;

    expect(Object.keys(events[0])).toEqual(['task']);
    const kinds = events.map((e) =>
      e.statusUpdate ? `status:${e.statusUpdate.status.state}` : Object.keys(e)[0],
    );
    expect(kinds).toEqual([
      'task',
      'status:TASK_STATE_WORKING',
      'artifactUpdate',
      'status:TASK_STATE_COMPLETED',
    ]);
    expect(events[2].artifactUpdate.artifact.parts[0].text).toBe('streamed result');
  });

  it('cancels, and refuses to cancel twice', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    await pair(alice, bob);
    const sent = await sendA2A(bob.a2a, 'long job', { token: alice.token, wait: false });
    if (!('task' in sent)) throw new Error('expected a task');
    expect((await cancelA2ATask(bob.a2a, sent.task.id, alice.token)).status.state).toBe(
      'TASK_STATE_CANCELED',
    );
    await expect(cancelA2ATask(bob.a2a, sent.task.id, alice.token)).rejects.toThrow();
    const raw = await rpc(bob.a2a, 'CancelTask', { id: sent.task.id }, alice.token);
    expect(raw.body.error?.code).toBe(-32002);
  });

  it('hands A2A tasks to the runner like any other task', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    await pair(alice, bob);
    const ac = new AbortController();
    const runner = new Runner(
      bob.client,
      {
        agents: { fake: { task: ['node', '-e', 'console.log("ran in " + process.cwd())'] } },
        projects: { api: { path: tmpdir(), agent: 'fake', allow: ['task'], approval: 'auto' } },
      },
      { log: () => {}, signal: ac.signal },
    );
    const running = runner.start();
    const sent = await sendA2A(bob.a2a, 'add rate limiting', {
      token: alice.token,
      kind: 'task',
      project: 'api',
    });
    ac.abort();
    await running;
    if (!('task' in sent)) throw new Error('expected a task');
    expect(sent.task.status.state).toBe('TASK_STATE_COMPLETED');
    expect(sent.task.artifacts?.[0]?.parts[0]?.text).toBe(`ran in ${tmpdir()}`);
  });
});

describe('A2A permissions and errors', () => {
  it('requires a token and a channel with the right scope', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    const msg = { message: { messageId: 'x', role: 'ROLE_USER', parts: [{ text: 'hi' }] } };

    const noToken = await rpc(bob.a2a, 'SendMessage', msg);
    expect(noToken.status).toBe(401);

    const noChannel = await rpc(bob.a2a, 'SendMessage', msg, alice.token);
    expect(noChannel.status).toBe(403);
    await expect(sendA2A(bob.a2a, 'hi', { token: alice.token })).rejects.toThrow();

    await pair(alice, bob, ['message']);
    const wrongScope = await rpc(
      bob.a2a,
      'SendMessage',
      {
        ...msg,
        message: { ...msg.message, metadata: { kind: 'task' } },
        configuration: { returnImmediately: true },
      },
      alice.token,
    );
    expect(wrongScope.status).toBe(403);
    expect(wrongScope.body.error?.message).toMatch(/only allows: message/);

    const ok = await rpc(
      bob.a2a,
      'SendMessage',
      { ...msg, configuration: { returnImmediately: true } },
      alice.token,
    );
    expect(ok.body.result.task.status.state).toBe('TASK_STATE_SUBMITTED');
  });

  it('only shows a caller its own tasks with that agent', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    const eve = await agent('eve');
    await pair(alice, bob);
    await pair(eve, bob);
    const sent = await rpc(
      bob.a2a,
      'SendMessage',
      {
        message: { messageId: 'x', role: 'ROLE_USER', parts: [{ text: 'secret' }] },
        configuration: { returnImmediately: true },
      },
      alice.token,
    );
    const id = sent.body.result.task.id;
    expect((await rpc(bob.a2a, 'GetTask', { id }, eve.token)).body.error?.code).toBe(-32001);
    expect((await rpc(bob.a2a, 'ListTasks', {}, eve.token)).body.result.tasks).toEqual([]);
    expect((await rpc(bob.a2a, 'GetTask', { id }, alice.token)).body.result.id).toBe(id);
  });

  it('lists with pagination and filters', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    await pair(alice, bob);
    for (const text of ['one', 'two', 'three']) {
      await rpc(
        bob.a2a,
        'SendMessage',
        {
          message: { messageId: text, role: 'ROLE_USER', parts: [{ text }] },
          configuration: { returnImmediately: true },
        },
        alice.token,
      );
    }
    const page1 = (await rpc(bob.a2a, 'ListTasks', { pageSize: 2 }, alice.token)).body.result;
    expect(page1).toMatchObject({ pageSize: 2, totalSize: 3, nextPageToken: '2' });
    expect(page1.tasks.map((t: any) => t.history.at(-1).parts[0].text)).toEqual(['three', 'two']);
    const page2 = (await rpc(bob.a2a, 'ListTasks', { pageSize: 2, pageToken: '2' }, alice.token))
      .body.result;
    expect(page2.tasks).toHaveLength(1);
    expect(page2.nextPageToken).toBe('');
    const done = (await rpc(bob.a2a, 'ListTasks', { status: 'TASK_STATE_COMPLETED' }, alice.token))
      .body.result;
    expect(done.totalSize).toBe(0);
  });

  it('returns the spec error codes', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    await pair(alice, bob);
    const code = async (method: string, params: unknown, headers?: Record<string, string>) =>
      (await rpc(bob.a2a, method, params, alice.token, headers)).body.error?.code;

    expect(await code('NoSuchMethod', {})).toBe(-32601);
    expect(await code('GetTask', { id: 'tsk_missing' })).toBe(-32001);
    expect(
      await code('SendMessage', { message: { messageId: 'x', role: 'ROLE_USER', parts: [] } }),
    ).toBe(-32602);
    expect(
      await code('SendMessage', {
        message: { messageId: 'x', role: 'ROLE_USER', parts: [{ text: 'a', url: 'b' }] },
      }),
    ).toBe(-32602);
    expect(await code('CreateTaskPushNotificationConfig', { url: 'https://x' })).toBe(-32602);
    expect(await code('CreateTaskPushNotificationConfig', { url: 'https://x.example', taskId: 'tsk_nope' })).toBe(-32001);
    expect(await code('GetExtendedAgentCard', {})).toBe(-32007);
    expect(await code('GetTask', { id: 'x' }, { 'A2A-Version': '0.3' })).toBe(-32009);

    const bad = await fetch(bob.a2a, {
      method: 'POST',
      body: 'not json',
      headers: { authorization: `Bearer ${alice.token}` },
    });
    expect(((await bad.json()) as any).error.code).toBe(-32700);
  });
});
