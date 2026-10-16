import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseOutput, Runner } from '../src/runner.js';
import { eventually, startGateway, stopAll } from './helpers.js';
import type { TestGateway } from './helpers.js';

let gw: TestGateway;
beforeAll(async () => {
  gw = await startGateway();
});
afterAll(stopAll);

const fakeOpenClaw = join(import.meta.dirname, 'fixtures', 'fake-openclaw.mjs');

describe('runner with an OpenClaw agent', () => {
  it('runs one OpenClaw session per conversation, with context and attachments', async () => {
    const boss = await gw.person('boss');
    const claw = await gw.agent('boss-claw', boss);
    const me = await gw.person('ludo');
    const { invite } = await boss.client.createInvite({ agent: claw.handle, approval: 'auto' });
    await me.client.redeem(invite.code);
    const { conversation } = await me.client.createConversation({ members: [claw.handle] });
    await me.client.post(conversation.id, { body: 'Hi, quick context first.', to: [] });

    const workspace = mkdtempSync(join(tmpdir(), 'claw-'));
    const ac = new AbortController();
    const runner = new Runner(
      claw.client,
      {
        agents: {
          openclaw: {
            message: [
              'node',
              fakeOpenClaw,
              '--session-id',
              'agw-{conversation}',
              '--message-file',
              '{promptFile}',
              '--json',
            ],
            output: 'openclaw-json',
          },
        },
        defaultProject: 'main',
        // No `approval`: an owned agent trusts the owner's rules on the gateway.
        projects: { main: { path: workspace, agent: 'openclaw' } },
      },
      { log: () => {}, signal: ac.signal, approver: async () => false },
    );
    const running = runner.start();

    await me.client.post(conversation.id, {
      body: `@${claw.handle} what do you make of this?`,
      attachments: [
        {
          filename: 'plan.txt',
          mediaType: 'text/plain',
          data: Buffer.from('launch in May').toString('base64'),
        },
      ],
    });
    const reply = await eventually(
      async () =>
        (await me.client.messages(conversation.id)).messages.find((m) => m.kind === 'reply'),
      'OpenClaw reply',
    );
    ac.abort();
    await running;
    expect(reply.author).toBe(claw.handle);
    expect(reply.body).toBe(`session=agw-${conversation.id} context=true file=launch in May`);
  });

  it('parses OpenClaw JSON output', () => {
    expect(
      parseOutput(JSON.stringify({ payloads: [{ text: 'a' }, { text: 'b' }] }), 'openclaw-json'),
    ).toBe('a\n\nb');
    expect(
      parseOutput(JSON.stringify({ result: { payloads: [{ text: 'gw' }] } }), 'openclaw-json'),
    ).toBe('gw');
    expect(parseOutput('not json', 'openclaw-json')).toBe('not json');
    expect(
      parseOutput(
        JSON.stringify({ ok: false, error: { message: 'gateway down' } }),
        'openclaw-json',
      ),
    ).toMatch(/^NEEDS_INPUT: OpenClaw reported an error: gateway down/);
  });
});
