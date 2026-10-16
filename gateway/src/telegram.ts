import type { Gateway } from './gateway.js';
import { GatewayError } from './gateway.js';
import type { Approval, GatewayEvent, Message, Principal } from './types.js';

/**
 * Telegram for people (owners above all): approval requests with Approve/Reject buttons,
 * conversation activity, and replies straight from Telegram. Uses long polling, so the
 * gateway needs no public webhook URL.
 *
 * In Telegram:
 *   /start <code>   link this chat (code from the web app or `POST /v1/telegram/link`)
 *   /pending        what's waiting for your approval
 *   /invites        conversations you're invited to (Join / Decline buttons)
 *   /agents         your agents; /pause <agent>, /resume <agent>
 *   /quiet, /all    approvals only, or everything (default)
 *   /unlink
 *   Reply to a conversation message to answer in that conversation.
 *   Reply to an approval request with text to approve it with your edit.
 */

export interface TelegramOptions {
  token: string;
  /** Link shown in messages, e.g. the public URL of the gateway. */
  appUrl?: string | undefined;
  /** For tests: a fake Bot API. */
  apiBase?: string;
  pollTimeoutSeconds?: number;
}

interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    reply_to_message?: { message_id: number };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
}

const MAX = 3500;
const clip = (s: string) => (s.length > MAX ? `${s.slice(0, MAX)}…` : s);

export async function startTelegramBridge(gateway: Gateway, opts: TelegramOptions) {
  const base = `${opts.apiBase ?? 'https://api.telegram.org'}/bot${opts.token}`;
  const store = gateway.store;
  let stopped = false;
  const ac = new AbortController();

  async function call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${base}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: method === 'getUpdates' ? ac.signal : AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) throw new Error(`telegram ${method}: ${json.description ?? 'failed'}`);
    return json.result as T;
  }

  const send = (chatId: string, text: string, extra: Record<string, unknown> = {}) =>
    call<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text: clip(text),
      disable_web_page_preview: true,
      ...extra,
    });

  const me = await call<{ username: string }>('getMe');

  // ---- outgoing: gateway events → Telegram ----

  const buttons = (approvalId: string) => ({
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `apr:${approvalId}:approve` },
          { text: '❌ Reject', callback_data: `apr:${approvalId}:reject` },
        ],
      ],
    },
  });

  function describeApproval(a: Approval): string {
    const conv = store.getConversation(a.conversationId);
    const where = conv?.title ? ` in “${conv.title}”` : '';
    return a.kind === 'request'
      ? `🔔 ${a.requester} wants ${a.agent}${where} to:\n\n${a.body}\n\nReply with text to approve an edited version.`
      : `🔔 ${a.agent}’s reply to ${a.requester}${where} is waiting for you:\n\n${a.body}\n\nReply with text to send an edited version.`;
  }

  async function notifyApproval(chatId: string, a: Approval) {
    const sent = await send(chatId, describeApproval(a), buttons(a.id));
    store.mapTelegramMessage(chatId, sent.message_id, {
      approvalId: a.id,
      conversationId: a.conversationId,
    });
  }

  async function notifyMessage(chatId: string, person: Principal, msg: Message) {
    if (msg.author === person.handle || msg.kind === 'system') return;
    const conv = store.getConversation(msg.conversationId);
    const title =
      conv?.title ??
      conv?.members
        .filter((m) => m.handle !== person.handle)
        .map((m) => m.handle)
        .join(', ');
    const waits = msg.deliveries.some((d) => d.status === 'pending_approval')
      ? '\n⏳ waiting for approval'
      : '';
    const files = msg.attachments.length
      ? `\n📎 ${msg.attachments.map((a) => a.filename).join(', ')}`
      : '';
    const sent = await send(
      chatId,
      `💬 ${title}\n${msg.author}${msg.authorKind === 'agent' ? ' (agent)' : ''}: ${msg.body}${files}${waits}`,
    );
    store.mapTelegramMessage(chatId, sent.message_id, { conversationId: msg.conversationId });
  }

  async function notifyInvitation(chatId: string, person: Principal, conversationId: string) {
    const conv = store.getConversation(conversationId);
    const me = store.member(conversationId, person.id);
    if (!conv || me?.state !== 'invited') return;
    const inviter = me.addedBy ? store.handleOf(me.addedBy) : conv.createdBy;
    const others = conv.members
      .filter((m) => m.handle !== person.handle && m.handle !== inviter)
      .map((m) => `${m.handle}${m.kind === 'agent' ? ' (agent)' : ''}`);
    const text =
      `\u2709\ufe0f ${inviter} invited you to \u201c${conv.title ?? 'a conversation'}\u201d` +
      (others.length ? `\nAlso in it: ${others.join(', ')}` : '');
    const sent = await send(chatId, text, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '\u2705 Join', callback_data: `inv:${conversationId}:join` },
            { text: '\u2715 Decline', callback_data: `inv:${conversationId}:decline` },
          ],
        ],
      },
    });
    store.mapTelegramMessage(chatId, sent.message_id, { conversationId });
  }

  async function markResolved(a: Approval) {
    for (const ref of store.telegramMessagesForApproval(a.id)) {
      const verdict = a.status === 'approved' ? '✅ Approved' : '❌ Rejected';
      await call('editMessageReplyMarkup', {
        chat_id: ref.chatId,
        message_id: ref.messageId,
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
      await send(
        ref.chatId,
        `${verdict}${a.decidedBy ? ` by ${a.decidedBy}` : ''}${a.note ? `: ${a.note}` : ''}`,
        {
          reply_to_message_id: ref.messageId,
        },
      ).catch(() => {});
    }
  }

  const unsubscribe = gateway.hub.subscribeAll((principalId, e: GatewayEvent) => {
    const prefs = store.telegramPrefs(principalId);
    if (!prefs.chatId) return;
    const person = store.principalById(principalId);
    if (!person || person.kind !== 'human') return;
    const chatId = prefs.chatId;
    const run = async () => {
      if (e.type === 'approval.requested') {
        const a = e.data as Approval;
        if (store.approval(a.id)?.ownerId === principalId) await notifyApproval(chatId, a);
      } else if (e.type === 'approval.resolved') {
        const a = e.data as Approval;
        if (store.approval(a.id)?.ownerId === principalId) await markResolved(a);
      } else if (e.type === 'message.created' && prefs.notify === 'all') {
        await notifyMessage(chatId, person, e.data as Message);
      } else if (e.type === 'conversation.invited') {
        await notifyInvitation(chatId, person, (e.data as { id: string }).id);
      }
    };
    run().catch((err) => console.error('telegram notify failed:', (err as Error).message));
  });

  // ---- incoming: Telegram → gateway ----

  const reply = (chatId: string, text: string, to?: number) =>
    send(chatId, text, to ? { reply_to_message_id: to } : {}).catch(() => {});

  async function onMessage(m: NonNullable<TgUpdate['message']>) {
    const chatId = String(m.chat.id);
    const text = (m.text ?? '').trim();
    const [command, ...rest] = text.split(/\s+/);
    const argText = rest.join(' ');

    if (command === '/start') {
      if (!argText)
        return reply(
          chatId,
          'Open the Agent Gateway web app → Settings → Link Telegram, then send /start <code> here.',
        );
      const person = gateway.linkTelegram(argText, chatId);
      return reply(
        chatId,
        person
          ? `Linked to ${person.handle}. You’ll get approval requests and conversation messages here. /quiet for approvals only.`
          : 'That code is invalid or expired. Make a new one in the web app.',
      );
    }

    const person = store.principalByTelegramChat(chatId);
    if (!person)
      return reply(
        chatId,
        'This chat isn’t linked. In the web app: Settings → Link Telegram, then /start <code>.',
      );

    try {
      switch (command) {
        case '/pending': {
          const pending = gateway.listApprovals(person);
          if (!pending.length) return reply(chatId, 'Nothing is waiting for you.');
          for (const a of pending) await notifyApproval(chatId, a);
          return;
        }
        case '/invites': {
          const open = store
            .conversationIdsFor(person.id)
            .filter((id) => store.member(id, person.id)?.state === 'invited');
          if (!open.length) return reply(chatId, 'No open invitations.');
          for (const id of open) await notifyInvitation(chatId, person, id);
          return;
        }
        case '/agents': {
          const agents = store.agentsOwnedBy(person.id);
          return reply(
            chatId,
            agents.length
              ? agents.map((a) => `${a.handle}${a.paused ? ' (paused)' : ''}`).join('\n')
              : 'You have no agents yet.',
          );
        }
        case '/pause':
        case '/resume': {
          const agent = gateway.updateAgent(person, argText, { paused: command === '/pause' });
          return reply(
            chatId,
            `${agent.handle} is ${agent.paused ? 'paused: nothing reaches it until you approve' : 'running again'}.`,
          );
        }
        case '/quiet':
        case '/all':
          store.setTelegramNotify(person.id, command === '/quiet' ? 'approvals' : 'all');
          return reply(
            chatId,
            command === '/quiet'
              ? 'Only approval requests from now on.'
              : 'You’ll see all conversation messages.',
          );
        case '/unlink':
          gateway.unlinkTelegram(person);
          return reply(chatId, 'Unlinked. Bye!');
        case '/help':
          return reply(chatId, HELP);
      }

      const ref = m.reply_to_message
        ? store.telegramMessage(chatId, m.reply_to_message.message_id)
        : null;
      if (ref?.approvalId) {
        const a = store.approval(ref.approvalId);
        if (a?.status === 'pending') {
          gateway.decide(person, a.id, 'approve', { body: text });
          return reply(chatId, '✅ Approved with your edit.', m.message_id);
        }
      }
      if (ref?.conversationId) {
        gateway.postMessage(person, ref.conversationId, { body: text });
        return reply(chatId, '✉️ Sent.', m.message_id);
      }
      return reply(chatId, 'Reply to a message to answer in its conversation, or /help.');
    } catch (err) {
      const why = err instanceof GatewayError ? err.message : 'something went wrong';
      return reply(chatId, `⚠️ ${why}`, m.message_id);
    }
  }

  async function onCallback(q: NonNullable<TgUpdate['callback_query']>) {
    const chatId = q.message ? String(q.message.chat.id) : '';
    const person = chatId ? store.principalByTelegramChat(chatId) : null;
    const [kind, id, decision] = (q.data ?? '').split(':');
    let answer = 'Done';
    if (person && kind === 'apr' && id && (decision === 'approve' || decision === 'reject')) {
      try {
        gateway.decide(person, id, decision);
        answer = decision === 'approve' ? 'Approved' : 'Rejected';
      } catch (err) {
        answer = err instanceof GatewayError ? err.message : 'Failed';
      }
    } else if (person && kind === 'inv' && id && (decision === 'join' || decision === 'decline')) {
      try {
        const conv = gateway.respondToInvite(person, id, decision === 'join');
        answer = decision === 'join' ? 'Joined' : 'Declined';
        if (q.message) {
          await call('editMessageReplyMarkup', {
            chat_id: chatId,
            message_id: q.message.message_id,
            reply_markup: { inline_keyboard: [] },
          }).catch(() => {});
        }
        await send(
          chatId,
          conv
            ? `\u2705 You joined \u201c${conv.title ?? 'the conversation'}\u201d. New messages will come here; reply to one to answer.`
            : '\u2715 Declined.',
          q.message ? { reply_to_message_id: q.message.message_id } : {},
        ).catch(() => {});
      } catch {
        answer = 'This invitation is no longer open';
      }
    }
    await call('answerCallbackQuery', { callback_query_id: q.id, text: answer }).catch(() => {});
  }

  async function poll() {
    let offset = 0;
    let backoff = 1000;
    while (!stopped) {
      try {
        const updates = await call<TgUpdate[]>('getUpdates', {
          offset,
          timeout: opts.pollTimeoutSeconds ?? 25,
          allowed_updates: ['message', 'callback_query'],
        });
        backoff = 1000;
        for (const u of updates) {
          offset = u.update_id + 1;
          if (u.message) await onMessage(u.message);
          else if (u.callback_query) await onCallback(u.callback_query);
        }
      } catch (err) {
        if (stopped) return;
        console.error('telegram poll failed:', (err as Error).message);
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  }
  const polling = poll();

  return {
    username: me.username,
    async stop() {
      stopped = true;
      unsubscribe();
      ac.abort();
      await polling.catch(() => {});
    },
  };
}

const HELP = `Agent Gateway
/pending — approvals waiting for you
/invites — conversations you're invited to
/agents — your agents
/pause <agent>, /resume <agent>
/quiet — approvals only; /all — everything
/unlink
Reply to a conversation message to answer there. Reply to an approval request with text to approve your edited version.`;
