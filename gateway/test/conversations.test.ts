import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GatewayClient } from '../src/client.js';
import type { GatewayEvent } from '../src/types.js';
import { errorCode, eventually, startGateway, stopAll } from './helpers.js';
import type { TestGateway } from './helpers.js';

// The scenario this release is built for: a boss shares his OpenClaw agent with an
// employee; the employee and the employee's Claude talk to it; the boss sees and controls everything.

let gw: TestGateway;
beforeAll(async () => {
  gw = await startGateway();
});
afterAll(stopAll);

async function setup(
  opts: { approval?: 'auto' | 'requests' | 'all'; scopes?: ('message' | 'task')[] } = {},
) {
  const boss = await gw.person('boss');
  const bossAgent = await gw.agent('boss-claw', boss);
  const me = await gw.person('ludo');
  const myClaude = await gw.agent('ludo-claude', me);

  const { invite } = await boss.client.createInvite({
    agent: bossAgent.handle,
    scopes: opts.scopes ?? ['message', 'task'],
    ...(opts.approval ? { approval: opts.approval } : {}),
  });
  await me.client.redeem(invite.code);
  const { conversation } = await myClaude.client.createConversation({
    title: 'Q3 planning',
    members: [bossAgent.handle],
  });
  return { boss, bossAgent, me, myClaude, conv: conversation.id };
}

describe('accounts', () => {
  it('signs people in with passwords and keeps agent tokens separate', async () => {
    const p = await gw.person('carol');
    expect(await errorCode(new GatewayClient(gw.url).login(p.handle, 'wrong password'))).toBe(
      'invalid_login',
    );
    const { token } = await new GatewayClient(gw.url).login(p.handle, 'correct horse battery');
    const { principal, agents } = await new GatewayClient(gw.url, token).me();
    expect(principal).toMatchObject({ handle: p.handle, kind: 'human' });
    expect(agents).toEqual([]);

    const a = await gw.agent('helper', p);
    expect((await p.client.me()).agents.map((x) => x.handle)).toEqual([a.handle]);
    expect((await a.client.me()).principal).toMatchObject({ kind: 'agent', owner: p.handle });
    // Agents can't log in with a password, people can't use their session as an agent token elsewhere.
    expect(await errorCode(new GatewayClient(gw.url).login(a.handle, 'x'))).toBe('invalid_login');
    await p.client.logout();
    expect(await errorCode(p.client.me())).toBe('unauthorized');
  });

  it('slows down password guessing', async () => {
    const strict = await startGateway({ signInAttemptsPerMinute: 5 });
    const target = await strict.person('victim');
    const results: string[] = [];
    for (let i = 0; i < 8; i++) {
      results.push(
        await errorCode(new GatewayClient(strict.url).login(target.handle, `guess-${i}`)),
      );
    }
    expect(results.slice(0, 4).every((r) => r === 'invalid_login')).toBe(true);
    expect(results.at(-1)).toBe('rate_limited');
  });

  it('protects cookie sessions against cross-site writes', async () => {
    const res = await fetch(`${gw.url}/v1/sessions?cookie=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: (await gw.person('dana')).handle,
        password: 'correct horse battery',
      }),
    });
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    expect(cookie).toMatch(/^agw_session=/);
    const post = (headers: Record<string, string>) =>
      fetch(`${gw.url}/v1/conversations`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', ...headers },
        body: '{}',
      });
    expect((await post({})).status).toBe(403);
    expect((await post({ 'x-requested-with': 'agw' })).status).toBe(201);
  });
});

describe('sharing an agent with owner approval', () => {
  it('holds requests until the owner approves, and the agent never sees them before', async () => {
    const { boss, bossAgent, me, myClaude, conv } = await setup();

    // Boss and I joined automatically as overseers of our agents.
    const members = (await myClaude.client.conversation(conv)).conversation.members;
    expect(members.map((m) => [m.handle, m.role])).toEqual(
      expect.arrayContaining([
        [myClaude.handle, 'admin'],
        [me.handle, 'overseer'],
        [bossAgent.handle, 'member'],
        [boss.handle, 'overseer'],
      ]),
    );

    // My Claude asks; with one other agent in the room, it's addressed implicitly.
    const { message } = await myClaude.client.post(conv, { body: 'What was Q3 revenue?' });
    expect(message.to).toEqual([bossAgent.handle]);
    expect(message.deliveries[0]?.status).toBe('pending_approval');

    // The boss has it in his queue; his agent has nothing.
    const [approval] = (await boss.client.approvals()).approvals;
    expect(approval).toMatchObject({
      kind: 'request',
      agent: bossAgent.handle,
      requester: myClaude.handle,
    });
    expect((await bossAgent.client.list('inbox')).tasks).toEqual([]);
    expect(
      (await bossAgent.client.messages(conv)).messages.some((m) => m.body.includes('Q3')),
    ).toBe(false);
    expect(await errorCode(bossAgent.client.get(message.deliveries[0]!.taskId))).toBe('not_found');
    // People in the conversation see it, marked as waiting.
    expect((await me.client.messages(conv)).messages.at(-1)?.deliveries[0]?.status).toBe(
      'pending_approval',
    );

    // Nothing the agent could receive (live stream, replay, audit log) contains the request yet.
    const agentLog = gw.store.eventsSince(bossAgent.agent.id, 0);
    expect(JSON.stringify(agentLog)).not.toContain('What was Q3 revenue?');

    // The boss approves, tightening the wording first.
    await boss.client.decide(approval!.id, 'approve', {
      body: 'What was Q3 revenue? Totals only, no client names.',
    });
    const { tasks } = await bossAgent.client.list('inbox', ['submitted']);
    expect(tasks[0]?.body).toBe('What was Q3 revenue? Totals only, no client names.');
    expect(
      (await bossAgent.client.messages(conv)).messages.some(
        (m) => m.body === 'What was Q3 revenue?',
      ),
    ).toBe(true);

    // The agent answers; the reply lands in the conversation.
    await bossAgent.client.setStatus(tasks[0]!.id, 'completed', 'Q3 revenue was $1.2M.');
    const reply = (await me.client.messages(conv)).messages.at(-1)!;
    expect(reply).toMatchObject({
      author: bossAgent.handle,
      kind: 'reply',
      body: 'Q3 revenue was $1.2M.',
    });
  });

  it('lets the owner reject with a note', async () => {
    const { boss, bossAgent, me, myClaude, conv } = await setup();
    const { message } = await me.client.post(conv, {
      body: `@${bossAgent.handle} share the payroll file`,
    });
    const [approval] = (await boss.client.approvals()).approvals;
    await boss.client.decide(approval!.id, 'reject', { note: 'not for sharing' });

    const taskId = message.deliveries[0]!.taskId;
    expect((await myClaude.client.messages(conv)).messages.at(-1)?.body).toMatch(
      /declined .*not for sharing/,
    );
    expect((await me.client.get(taskId)).task).toMatchObject({ status: 'rejected' });
    // The agent never saw it.
    expect(
      (await bossAgent.client.messages(conv)).messages.some((m) => m.body.includes('payroll')),
    ).toBe(false);
  });

  it('reviews replies too in "all" mode, and the owner can edit them', async () => {
    const { boss, bossAgent, me, myClaude, conv } = await setup({ approval: 'all' });
    await myClaude.client.post(conv, { body: 'Who are our top clients?' });
    const [request] = (await boss.client.approvals()).approvals;
    await boss.client.decide(request!.id, 'approve');

    const task = (await bossAgent.client.list('inbox', ['submitted'])).tasks[0]!;
    await bossAgent.client.setStatus(task.id, 'completed', 'Acme Corp ($400k), Globex ($300k)');
    expect((await me.client.get(task.id)).task.status).toBe('reviewing');
    expect((await me.client.messages(conv)).messages.some((m) => m.body.includes('Acme'))).toBe(
      false,
    );

    const [review] = (await boss.client.approvals()).approvals;
    expect(review).toMatchObject({ kind: 'reply', proposedStatus: 'completed' });
    await boss.client.decide(review!.id, 'approve', {
      body: 'Two enterprise clients account for 60% of revenue.',
    });
    expect((await me.client.messages(conv)).messages.at(-1)).toMatchObject({
      author: bossAgent.handle,
      body: 'Two enterprise clients account for 60% of revenue.',
    });
    expect((await me.client.get(task.id)).task.status).toBe('completed');
  });

  it('gives full control when the owner allows it, until he pauses or revokes', async () => {
    const { boss, bossAgent, me, myClaude, conv } = await setup();
    const channel = (await boss.client.channels()).channels.find(
      (c) => c.recipient === bossAgent.handle,
    )!;
    await boss.client.updateChannel(channel.id, { approval: 'auto' });

    // Me and my Claude both direct his agent with no approval step.
    const a = await myClaude.client.post(conv, { body: 'Draft the Q4 plan', kind: 'task' });
    expect(a.message.deliveries[0]?.status).toBe('submitted');
    const b = await me.client.post(conv, { body: `@${bossAgent.handle} also list risks` });
    expect(b.message.deliveries[0]?.status).toBe('submitted');
    expect((await boss.client.approvals()).approvals).toEqual([]);

    // The boss still sees everything.
    expect(
      (await boss.client.messages(conv)).messages.filter((m) => m.kind === 'text').length,
    ).toBe(2);

    // Pause: everything waits for him again.
    await boss.client.updateAgent(bossAgent.handle, { paused: true });
    const c = await myClaude.client.post(conv, { body: 'and the budget?' });
    expect(c.message.deliveries[0]?.status).toBe('pending_approval');
    await boss.client.updateAgent(bossAgent.handle, { paused: false });

    // Owner takes over a task himself.
    await boss.client.setStatus(
      a.message.deliveries[0]!.taskId,
      'completed',
      'I’ll write this one myself.',
    );
    expect((await me.client.get(a.message.deliveries[0]!.taskId)).task.status).toBe('completed');

    // Revoke: my access is gone; requests go back to his queue for a decision.
    await boss.client.revokeChannel(channel.id);
    const d = await myClaude.client.post(conv, { body: 'one more thing' });
    expect(d.message.deliveries[0]?.status).toBe('pending_approval');
    // And I can't bring his agent into new conversations.
    const { conversation } = await me.client.createConversation({ title: 'new' });
    expect(await errorCode(me.client.addMember(conversation.id, bossAgent.handle))).toBe(
      'no_access',
    );
  });

  it('enforces scopes', async () => {
    const { bossAgent, myClaude, conv } = await setup({ scopes: ['message'] });
    expect(
      await errorCode(myClaude.client.post(conv, { body: 'refactor billing', kind: 'task' })),
    ).toBe('scope_not_allowed');
    expect(
      await errorCode(myClaude.client.post(conv, { body: 'question', to: [bossAgent.handle] })),
    ).toBe('ok');
  });

  it('only the owner can grant access without approval', async () => {
    const boss = await gw.person('boss');
    const bossAgent = await gw.agent('boss-claw', boss);
    expect(await errorCode(bossAgent.client.createInvite({ approval: 'auto' }))).toBe(
      'owner_must_grant',
    );
    expect((await bossAgent.client.createInvite()).invite.approval).toBe('requests');
    expect(
      (await boss.client.createInvite({ agent: bossAgent.handle, approval: 'auto' })).invite
        .approval,
    ).toBe('auto');
    const stranger = await gw.person('eve');
    expect(await errorCode(stranger.client.createInvite({ agent: bossAgent.handle }))).toBe(
      'not_owner',
    );
  });
});

describe('conversations', () => {
  it('invites people, who choose to join, and holds requests from people without access', async () => {
    const { boss, bossAgent, me, conv } = await setup();
    const carol = await gw.person('carol');
    await me.client.addMember(conv, carol.handle);

    const [invited] = (await carol.client.conversations()).conversations;
    expect(invited).toMatchObject({ id: conv, myState: 'invited', lastMessage: null });
    expect(await errorCode(carol.client.messages(conv))).toBe('not_found');
    await carol.client.respondToInvitation(conv, true);

    // Carol has no access of her own to the boss's agent: it waits for the boss.
    const { message } = await carol.client.post(conv, { body: `@${bossAgent.handle} hello` });
    expect(message.deliveries[0]?.status).toBe('pending_approval');
    expect((await boss.client.approvals()).approvals[0]?.requester).toBe(carol.handle);
  });

  it('addresses agents by @mention when several are present', async () => {
    const owner = await gw.person('olga');
    const a = await gw.agent('writer', owner);
    const b = await gw.agent('reviewer', owner);
    const { conversation } = await owner.client.createConversation({
      members: [a.handle, b.handle],
    });

    const plain = await owner.client.post(conversation.id, { body: 'morning all' });
    expect(plain.message.deliveries).toEqual([]);
    const one = await owner.client.post(conversation.id, { body: `@${b.handle} please review` });
    expect(one.message.deliveries.map((d) => [d.to, d.status])).toEqual([[b.handle, 'submitted']]);
    // An owner's agents talk to each other freely (agent-to-agent in the same household).
    const relay = await a.client.post(conversation.id, { body: `@${b.handle} here is my draft` });
    expect(relay.message.deliveries[0]?.status).toBe('submitted');
  });

  it('counts unread messages and stores attachments', async () => {
    const { bossAgent, me, myClaude, conv, boss } = await setup({ approval: 'auto' });
    const file = Buffer.from('revenue,1200000\n').toString('base64');
    const { message } = await myClaude.client.post(conv, {
      body: 'see attached',
      attachments: [{ filename: 'q3.csv', mediaType: 'text/csv', data: file }],
    });
    expect(message.attachments[0]).toMatchObject({
      filename: 'q3.csv',
      mediaType: 'text/csv',
      size: 16,
    });

    // The agent's task mentions the file and the agent can fetch it.
    const task = (await bossAgent.client.list('inbox', ['submitted'])).tasks[0]!;
    expect(task.body).toContain(`[attachment ${message.attachments[0]!.id}: q3.csv`);
    expect(Buffer.from(await bossAgent.client.download(message.attachments[0]!)).toString()).toBe(
      'revenue,1200000\n',
    );
    const outsider = await gw.person('mallory');
    expect(await errorCode(outsider.client.download(message.attachments[0]!))).toBe(
      'download_failed',
    );

    const summary = (await boss.client.conversations()).conversations.find((c) => c.id === conv)!;
    expect(summary.unread).toBeGreaterThan(0);
    await boss.client.markRead(conv, summary.lastSeq);
    expect(
      (await boss.client.conversations()).conversations.find((c) => c.id === conv)!.unread,
    ).toBe(0);
    expect((await me.client.conversations()).conversations[0]?.lastMessage?.body).toBe(
      'see attached',
    );
  });

  it('continues a task that needs input when someone answers in the conversation', async () => {
    const { bossAgent, myClaude, conv } = await setup({ approval: 'auto' });
    const first = await myClaude.client.post(conv, { body: 'book the venue' });
    const taskId = first.message.deliveries[0]!.taskId;
    await bossAgent.client.setStatus(taskId, 'input_required', 'Which date?');
    const second = await myClaude.client.post(conv, { body: 'October 3rd' });
    expect(second.message.deliveries[0]).toMatchObject({ taskId, status: 'submitted' });
    const { messages } = await bossAgent.client.get(taskId);
    expect(messages.at(-1)?.body).toBe('October 3rd');
  });

  it('stops runaway agent loops', async () => {
    const owner = await gw.person('ivan');
    const a = await gw.agent('ping', owner);
    const { conversation } = await owner.client.createConversation({ members: [a.handle] });
    const results = [];
    for (let i = 0; i < 32; i++)
      results.push(await errorCode(owner.client.post(conversation.id, { body: `msg ${i}` })));
    expect(results.filter((r) => r === 'too_many_requests').length).toBeGreaterThan(0);
  });

  it('streams conversation events to people', async () => {
    const { me, myClaude, conv } = await setup({ approval: 'auto' });
    const ac = new AbortController();
    let connected!: () => void;
    const ready = new Promise<void>((r) => (connected = r));
    const got: GatewayEvent[] = [];
    const following = me.client.subscribe((e) => void got.push(e), {
      signal: ac.signal,
      onConnect: () => connected(),
    });
    await ready;
    await myClaude.client.post(conv, { body: 'hello boss agent' });
    await eventually(async () => got.find((e) => e.type === 'message.created'), 'message event');
    ac.abort();
    await following;
  });
});
