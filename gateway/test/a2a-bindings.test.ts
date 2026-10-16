import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SendMessageRequest, StreamResponse, Task } from '@a2a-js/sdk';
import * as grpc from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authOptions, connectA2A, getAgentCard, sendA2A } from '../src/a2a-client.js';
import { GatewayClient } from '../src/client.js';
import { startServer } from '../src/listen.js';
import { Store } from '../src/store.js';
import { eventually } from './helpers.js';

// HTTP+JSON and gRPC bindings, push notifications, inline files and owner approval as seen
// through A2A — all driven by Google's official SDK clients.

let server: Awaited<ReturnType<typeof startServer>>;
let url: string;

beforeAll(async () => {
  process.env.AGW_A2A_GRPC_INSECURE = '1';
  server = await startServer(new Store(':memory:'), {
    port: 0,
    host: '127.0.0.1',
    grpcPort: 0,
    heartbeatSeconds: 1,
    allowPrivateWebhooks: true,
  });
  url = server.url;
});
afterAll(() => server.close());

let n = 0;
async function agent(name: string, owner?: GatewayClient) {
  const handle = `${name}-${++n}`;
  const { token } = await (owner ?? new GatewayClient(url)).register(handle, `${name} agent`);
  return { client: new GatewayClient(url, token), handle, token, a2a: `${url}/a2a/${handle}` };
}
async function pair(sender: { client: GatewayClient }, recipient: { client: GatewayClient }) {
  const { invite } = await recipient.client.createInvite({ scopes: ['message', 'task'] });
  await sender.client.redeem(invite.code);
}
const request = (text: string, extra: Record<string, unknown> = {}) =>
  SendMessageRequest.fromJSON({
    message: { messageId: `m-${Math.random()}`, role: 'ROLE_USER', parts: [{ text }] },
    configuration: { returnImmediately: true },
    ...extra,
  });

describe('agent card', () => {
  it('advertises all three bindings with the agent as tenant', async () => {
    const bob = await agent('bob');
    const card = (await getAgentCard(bob.a2a, bob.token)) as any;
    expect(card.supportedInterfaces.map((i: any) => [i.protocolBinding, i.tenant ?? null])).toEqual([
      ['JSONRPC', null],
      ['HTTP+JSON', bob.handle],
      ['GRPC', bob.handle],
    ]);
    expect(card.supportedInterfaces[2].url).toBe(`127.0.0.1:${server.grpcPort}`);
    expect(card.capabilities.pushNotifications).toBe(true);
  });
});

describe.each([['HTTP+JSON'], ['GRPC']])('%s binding (official SDK client)', (binding) => {
  it('sends, reads back and streams', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    await pair(alice, bob);
    const client = await connectA2A(bob.a2a, alice.token, false, [binding]);
    const auth = authOptions(alice.token);

    const sent = (await client.sendMessage(request(`hello over ${binding}`), auth)) as Task;
    const json = Task.toJSON(sent) as any;
    expect(json.status.state).toBe('TASK_STATE_SUBMITTED');
    expect((await bob.client.get(json.id)).task.body).toBe(`hello over ${binding}`);

    await bob.client.setStatus(json.id, 'completed', 'done!');
    const got = Task.toJSON(await client.getTask({ tenant: '', id: json.id, historyLength: undefined }, auth)) as any;
    expect(got.artifacts[0].parts[0].text).toBe('done!');

    const listed = await client.listTasks(
      { tenant: '', contextId: '', status: 0, pageSize: 10, pageToken: '', historyLength: undefined, statusTimestampAfter: undefined, includeArtifacts: true },
      auth,
    );
    expect(listed.tasks.length).toBe(1);

    // Streaming
    const events: any[] = [];
    const finishing = (async () => {
      const t = await eventually(async () => (await bob.client.list('inbox', ['submitted'])).tasks[0], 'task');
      await bob.client.setStatus(t.id, 'working');
      await bob.client.setStatus(t.id, 'completed', 'streamed');
    })();
    for await (const e of client.sendMessageStream(request('stream it'), auth)) events.push(StreamResponse.toJSON(e));
    await finishing;
    expect(events[0].task).toBeDefined();
    expect(events.at(-1).statusUpdate.status.state).toBe('TASK_STATE_COMPLETED');
    expect(events.some((e) => e.artifactUpdate?.artifact.parts[0].text === 'streamed')).toBe(true);
  });

  it('rejects callers without a token or access', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    const client = await connectA2A(bob.a2a, bob.token, false, [binding]);
    await expect(client.sendMessage(request('no token'))).rejects.toThrow();
    await expect(client.sendMessage(request('no access'), authOptions(alice.token))).rejects.toThrow(/Forbidden/);
  });
});

describe('push notifications', () => {
  it('POSTs task updates to the registered webhook', async () => {
    const received: { headers: Record<string, unknown>; body: any }[] = [];
    const hook = createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body: JSON.parse(data) });
        res.end('ok');
      });
    });
    await new Promise<void>((r) => hook.listen(0, '127.0.0.1', r));
    const hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/a2a-hook`;

    const alice = await agent('alice');
    const bob = await agent('bob');
    await pair(alice, bob);
    const sent = await sendA2A(bob.a2a, 'long job', { token: alice.token, wait: false });
    if (!('task' in sent)) throw new Error('expected task');

    const rpc = async (method: string, params: unknown) =>
      (await (
        await fetch(bob.a2a, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.token}` },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        })
      ).json()) as any;
    const created = await rpc('CreateTaskPushNotificationConfig', {
      taskId: sent.task.id,
      url: hookUrl,
      token: 'secret-123',
    });
    expect(created.result).toMatchObject({ taskId: sent.task.id, url: hookUrl });
    expect((await rpc('ListTaskPushNotificationConfigs', { taskId: sent.task.id })).result.configs).toHaveLength(1);

    await bob.client.setStatus(sent.task.id, 'working');
    await bob.client.setStatus(sent.task.id, 'completed', 'finished after a long time');
    const final = await eventually(async () => received.find((r) => r.body.task), 'final push');
    expect(final.headers['x-a2a-notification-token']).toBe('secret-123');
    expect(final.headers['content-type']).toBe('application/a2a+json');
    expect(final.body.task.artifacts[0].parts[0].text).toBe('finished after a long time');
    expect(received.some((r) => r.body.statusUpdate?.status.state === 'TASK_STATE_WORKING')).toBe(true);

    await rpc('DeleteTaskPushNotificationConfig', { taskId: sent.task.id, id: created.result.id });
    expect((await rpc('ListTaskPushNotificationConfigs', { taskId: sent.task.id })).result.configs).toHaveLength(0);
    hook.close();
  });
});

describe('A2A meets the conversation system', () => {
  it('accepts inline files and shows owner approval as a waiting task', async () => {
    const boss = await new GatewayClient(url).signUp(`boss-${++n}`, 'correct horse battery');
    const bossClient = new GatewayClient(url, boss.token);
    const bossAgent = await agent('boss-claw', bossClient);
    const caller = await agent('caller');
    const { invite } = await bossClient.createInvite({ agent: bossAgent.handle });
    await caller.client.redeem(invite.code);

    const sent = await sendA2A(bossAgent.a2a, 'please read this', {
      token: caller.token,
      wait: false,
      files: [{ filename: 'notes.txt', mediaType: 'text/plain', data: Buffer.from('hi there').toString('base64') }],
    });
    if (!('task' in sent)) throw new Error('expected task');
    expect(sent.task.status.state).toBe('TASK_STATE_SUBMITTED');
    expect(sent.task.status.message?.parts[0]?.text).toMatch(/Waiting for the owner/);
    expect(sent.task.metadata?.gatewayStatus).toBe('pending_approval');

    // The conversation is the A2A context, and the boss approves from his queue.
    const { messages } = await bossClient.messages(sent.task.contextId);
    expect(messages.at(-1)?.attachments[0]).toMatchObject({ filename: 'notes.txt', size: 8 });
    const [approval] = (await bossClient.approvals()).approvals;
    await bossClient.decide(approval!.id, 'approve');
    const file = messages.at(-1)!.attachments[0]!;
    expect(Buffer.from(await bossAgent.client.download(file)).toString()).toBe('hi there');
  });

  it('continues an existing conversation by contextId', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    await pair(alice, bob);
    const { conversation } = await alice.client.createConversation({ title: 'shared', members: [bob.handle] });
    const sent = await sendA2A(bob.a2a, 'in the thread', { token: alice.token, wait: false, contextId: conversation.id });
    if (!('task' in sent)) throw new Error('expected task');
    expect(sent.task.contextId).toBe(conversation.id);
    expect((await alice.client.messages(conversation.id)).messages.at(-1)?.body).toBe('in the thread');
  });

  it('waits past the old 5-minute cap (no fixed limit) and returns when the task settles', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    await pair(alice, bob);
    const [sent] = await Promise.all([
      sendA2A(bob.a2a, 'take your time', { token: alice.token }),
      (async () => {
        const t = await eventually(async () => (await bob.client.list('inbox', ['submitted'])).tasks[0], 'task');
        await new Promise((r) => setTimeout(r, 1500));
        await bob.client.setStatus(t.id, 'completed', 'worth the wait');
      })(),
    ]);
    if (!('task' in sent)) throw new Error('expected task');
    expect(sent.task.artifacts?.[0]?.parts[0]?.text).toBe('worth the wait');
  });
});

// Keep grpc import used for clarity of what the GRPC binding runs on.
void grpc;
