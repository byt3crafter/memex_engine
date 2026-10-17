import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GatewayClient, GatewayError } from '../src/client.js';
import { Runner } from '../src/runner.js';
import { createApp } from '../src/server.js';
import { Store } from '../src/store.js';
import type { GatewayEvent, Task } from '../src/types.js';

let url: string;
let close: () => void;

beforeAll(async () => {
  const store = new Store(':memory:');
  const app = createApp(store, { heartbeatSeconds: 1, signInAttemptsPerMinute: 10_000 });
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
  const { token, agent } = await new GatewayClient(url).register(`${prefix}-${++n}`);
  return { client: new GatewayClient(url, token), handle: agent.handle };
}

async function pair(
  sender: Awaited<ReturnType<typeof agent>>,
  recipient: Awaited<ReturnType<typeof agent>>,
  scopes: ('message' | 'task')[] = ['message', 'task'],
) {
  const { invite } = await recipient.client.createInvite({ scopes });
  await sender.client.redeem(invite.code);
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: GatewayError) => e.code,
  );

describe('pairing and permissions', () => {
  it('rejects unauthenticated and duplicate registrations', async () => {
    const a = await agent('dup');
    expect(await code(new GatewayClient(url).register(a.handle))).toBe('handle_taken');
    expect(await code(new GatewayClient(url, 'nodd_bogus').me())).toBe('unauthorized');
  });

  it('needs a channel before sending, and enforces its scopes', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    expect(await code(alice.client.send({ to: bob.handle, body: 'hi' }))).toBe('no_channel');
    expect(await code(alice.client.send({ to: 'nobody-here', body: 'hi' }))).toBe('no_channel');

    await pair(alice, bob, ['message']);
    expect(await code(alice.client.send({ to: bob.handle, body: 'hi' }))).toBe('ok');
    expect(await code(alice.client.send({ to: bob.handle, body: 'edit', kind: 'task' }))).toBe(
      'scope_not_allowed',
    );
    // One-way: bob still can't send to alice.
    expect(await code(bob.client.send({ to: alice.handle, body: 'hi' }))).toBe('no_channel');
  });

  it('invite codes are single-use and not redeemable by the issuer', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    const carol = await agent('carol');
    const { invite } = await alice.client.createInvite();
    expect(await code(alice.client.redeem(invite.code))).toBe('cannot_redeem_own_code');
    expect(await code(bob.client.redeem(invite.code.toLowerCase()))).toBe('ok');
    expect(await code(carol.client.redeem(invite.code))).toBe('code_used');
    expect(await code(carol.client.redeem('NODD-XXXXX-XXXXX'))).toBe('invalid_code');
  });

  it('mutual invites open both directions and revoking closes them', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    const { invite } = await alice.client.createInvite({ mutual: true });
    const { channels } = await bob.client.redeem(invite.code);
    expect(channels).toHaveLength(2);
    expect(await code(alice.client.send({ to: bob.handle, body: 'hi' }))).toBe('ok');
    await alice.client.revokeChannel(channels[0]!.id); // bob -> alice
    expect(await code(bob.client.send({ to: alice.handle, body: 'hi' }))).toBe('no_channel');
  });

  it('only parties can see a task, and only the right party can move it', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    const eve = await agent('eve');
    await pair(alice, bob);
    const { task } = await alice.client.send({ to: bob.handle, body: 'do it', kind: 'task' });

    expect(await code(eve.client.get(task.id))).toBe('not_found');
    expect(await code(alice.client.setStatus(task.id, 'completed', 'faked'))).toBe(
      'invalid_transition',
    );
    expect(await code(bob.client.setStatus(task.id, 'canceled'))).toBe('invalid_transition');
    expect(await code(bob.client.setStatus(task.id, 'working'))).toBe('ok');
    expect(await code(bob.client.setStatus(task.id, 'completed', 'done'))).toBe('ok');
    expect(await code(alice.client.setStatus(task.id, 'canceled'))).toBe('invalid_transition');
    expect(await code(alice.client.message(task.id, 'more?'))).toBe('task_closed');
  });

  it('answering input_required puts the task back in the queue', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    await pair(alice, bob);
    const { task } = await alice.client.send({ to: bob.handle, body: 'deploy it' });
    await bob.client.setStatus(task.id, 'input_required', 'which environment?');
    const { task: after } = await alice.client.message(task.id, 'staging');
    expect(after.status).toBe('submitted');
    const { messages } = await bob.client.get(task.id);
    expect(messages.map((m) => [m.author, m.body])).toEqual([[alice.handle, 'staging']]);
  });
});

describe('event stream', () => {
  it('delivers live events and resumes from Last-Event-ID', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    await pair(alice, bob);

    const ac = new AbortController();
    const seen: GatewayEvent[] = [];
    let connected!: () => void;
    const ready = new Promise<void>((r) => (connected = r));
    const done = bob.client.subscribe(
      (e) => {
        // Conversation events arrive too; this test follows tasks.
        if (e.type !== 'task.created') return;
        seen.push(e);
        if (seen.length === 2) ac.abort();
      },
      { signal: ac.signal, onConnect: () => connected() },
    );
    await ready;
    await alice.client.send({ to: bob.handle, body: 'one' });
    await alice.client.send({ to: bob.handle, body: 'two' });
    await done;
    expect(seen.map((e) => [e.type, (e.data as Task).body])).toEqual([
      ['task.created', 'one'],
      ['task.created', 'two'],
    ]);

    // Missed while disconnected, replayed on resume.
    await alice.client.send({ to: bob.handle, body: 'three' });
    const ac2 = new AbortController();
    const replayed: GatewayEvent[] = [];
    await bob.client.subscribe(
      (e) => {
        if (e.type !== 'task.created') return;
        replayed.push(e);
        ac2.abort();
      },
      { signal: ac2.signal, since: seen[1]!.seq },
    );
    expect((replayed[0]!.data as Task).body).toBe('three');
  });
});

describe('runner', () => {
  it('runs a task with the configured agent and posts the result', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    await pair(alice, bob);
    const dir = mkdtempSync(join(tmpdir(), 'nodd-'));

    const asked: string[] = [];
    const ac = new AbortController();
    const runner = new Runner(
      bob.client,
      {
        agents: {
          fake: {
            task: [
              'node',
              '-e',
              'console.log("did: " + process.argv[1].includes("rename the thing") + " in " + process.cwd())',
              '{prompt}',
            ],
            message: ['node', '-e', 'console.log("NEEDS_INPUT: which file?")'],
          },
        },
        projects: {
          demo: {
            path: dir,
            agent: 'fake',
            allow: ['message', 'task'],
            approval: 'prompt',
            allowFrom: [alice.handle],
          },
        },
      },
      {
        approver: async (t) => {
          asked.push(t.id);
          return true;
        },
        log: () => {},
        signal: ac.signal,
      },
    );
    const running = runner.start();

    // Queued before/while the runner connects; it must still be picked up.
    const { task } = await alice.client.send({
      to: bob.handle,
      body: 'please rename the thing',
      kind: 'task',
      project: 'demo',
    });
    const { task: unknown } = await alice.client.send({
      to: bob.handle,
      body: 'x',
      project: 'nope',
    });
    const { task: question } = await alice.client.send({
      to: bob.handle,
      body: 'refactor',
      project: 'demo',
    });

    const settle = async (id: string, until: (t: Task) => boolean) => {
      for (let i = 0; i < 100; i++) {
        const { task: t } = await alice.client.get(id);
        if (until(t)) return t;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`task ${id} never settled`);
    };

    const done = await settle(task.id, (t) => t.status === 'completed');
    expect(done.result).toBe(`did: true in ${dir}`);
    expect(asked).toContain(task.id);

    const rejected = await settle(unknown.id, (t) => t.status === 'rejected');
    expect(rejected.result).toMatch(/unknown project/);

    const needs = await settle(question.id, (t) => t.status === 'input_required');
    expect(needs.result).toBe('which file?');

    ac.abort();
    await running;
  });

  it('rejects senders outside allowFrom and tasks the owner declines', async () => {
    const alice = await agent('alice');
    const bob = await agent('bob');
    const mallory = await agent('mallory');
    await pair(alice, bob);
    await pair(mallory, bob);
    const runner = new Runner(
      bob.client,
      {
        projects: {
          demo: { path: tmpdir(), agent: 'echo', allow: ['task'], allowFrom: [alice.handle] },
        },
      },
      { approver: async () => false, log: () => {} },
    );
    const { task: fromMallory } = await mallory.client.send({
      to: bob.handle,
      body: 'x',
      kind: 'task',
      project: 'demo',
    });
    const { task: declined } = await alice.client.send({
      to: bob.handle,
      body: 'x',
      kind: 'task',
      project: 'demo',
    });
    await runner.handle(fromMallory.id);
    await runner.handle(declined.id);
    expect((await bob.client.get(fromMallory.id)).task.result).toBe(
      'sender not allowed for this project',
    );
    expect((await bob.client.get(declined.id)).task.result).toBe('declined on the runner');
  });
});
