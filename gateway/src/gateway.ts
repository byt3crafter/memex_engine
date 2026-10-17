import { createHash } from 'node:crypto';
import {
  hashPassword,
  newInviteCode,
  newToken,
  normalizeInviteCode,
  sha256,
  verifyPassword,
} from './auth.js';
import { Hub } from './core.js';
import { now } from './store.js';
import type { ChannelRow, Store, TaskRow } from './store.js';
import { SCOPES, TERMINAL_STATUSES } from './types.js';
import type {
  Approval,
  ApprovalMode,
  ApprovalStatus,
  Channel,
  Conversation,
  ConversationSummary,
  GatewayEventType,
  Message,
  Principal,
  Scope,
  Task,
  TaskMessage,
  TaskStatus,
} from './types.js';

/**
 * Every rule of the gateway lives here: identities, who may reach which agent, owner
 * approvals, conversations and how messages become agent tasks. The REST API, the A2A
 * bindings, the Telegram bridge and the web app are thin adapters over this class, so
 * permissions can't differ between them.
 */

export class GatewayError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429,
    readonly code: string,
    message?: string,
    readonly detail?: unknown,
  ) {
    super(message ?? code);
  }
}

const fail = (
  status: GatewayError['status'],
  code: string,
  message?: string,
  detail?: unknown,
): never => {
  throw new GatewayError(status, code, message, detail);
};

export const HANDLE = /^[a-z0-9][a-z0-9._-]{1,62}$/;
const MENTION = /(?:^|[^a-z0-9._-])@([a-z0-9][a-z0-9._-]{1,62})/gi;
const OUTCOMES: TaskStatus[] = ['completed', 'failed', 'input_required', 'rejected'];

/** Status changes the recipient (or its owner) may make, keyed by current status. */
const RECIPIENT_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending_approval: [],
  submitted: ['working', 'input_required', 'completed', 'failed', 'rejected'],
  working: ['input_required', 'completed', 'failed'],
  input_required: ['working', 'completed', 'failed'],
  reviewing: [],
  completed: [],
  failed: [],
  rejected: [],
  canceled: [],
};

/** What `author` may do with an agent, and how much the agent's owner reviews. */
export interface Access {
  mode: ApprovalMode | 'owner';
  scopes: Scope[];
  channel: ChannelRow | null;
}

export interface AttachmentInput {
  filename: string;
  mediaType: string;
  /** Base64. */
  data: string;
}

export interface PostInput {
  body: string;
  /** Agent handles to address; @mentions in the body are added. */
  to?: string[] | undefined;
  kind?: Scope | undefined;
  project?: string | null | undefined;
  title?: string | null | undefined;
  replyTo?: string | null | undefined;
  attachments?: AttachmentInput[] | undefined;
}

export interface GatewayOptions {
  sessionTtlSeconds?: number;
  maxAttachmentBytes?: number;
  /** Agent tasks a single conversation may start per minute (stops agent loops). */
  deliveriesPerMinute?: number;
}

export class Gateway {
  readonly hub: Hub;
  private readonly sessionTtl: number;
  private readonly maxAttachment: number;
  private readonly deliveryLimit: number;
  private readonly taskListeners = new Set<(task: Task) => void>();

  constructor(
    readonly store: Store,
    opts: GatewayOptions = {},
  ) {
    this.hub = new Hub(store);
    this.sessionTtl = opts.sessionTtlSeconds ?? 30 * 24 * 3600;
    this.maxAttachment = opts.maxAttachmentBytes ?? 10 * 1024 * 1024;
    this.deliveryLimit = opts.deliveriesPerMinute ?? 30;
  }

  /** Called after every task change (A2A push notifications hook in here). */
  onTaskChange(fn: (task: Task) => void): () => void {
    this.taskListeners.add(fn);
    return () => this.taskListeners.delete(fn);
  }

  // =========================================================================
  // Identity
  // =========================================================================

  /** Agent token or a person's session token. */
  authenticate(token: string | undefined | null): Principal | null {
    if (!token) return null;
    const hash = sha256(token);
    return this.store.principalByTokenHash(hash) ?? this.store.principalBySessionHash(hash);
  }

  private checkHandle(handle: string): void {
    if (!HANDLE.test(handle))
      fail(400, 'invalid_handle', 'handle must be 2-63 chars of a-z, 0-9, . _ -');
    if (this.store.principalByHandle(handle)) fail(409, 'handle_taken');
  }

  /** An agent; owned when `owner` is given. The token is returned once and stored hashed. */
  registerAgent(input: { handle: string; description?: string | null; owner?: Principal | null }) {
    if (input.owner && input.owner.kind !== 'human') fail(403, 'only_people_own_agents');
    this.checkHandle(input.handle);
    const token = newToken();
    const agent = this.store.createPrincipal({
      kind: 'agent',
      handle: input.handle,
      description: input.description ?? null,
      ownerId: input.owner?.id ?? null,
      tokenHash: sha256(token),
    });
    return { agent, token };
  }

  registerPerson(input: { handle: string; password: string; displayName?: string | null }) {
    if (input.password.length < 8)
      fail(400, 'weak_password', 'password must be at least 8 characters');
    this.checkHandle(input.handle);
    const person = this.store.createPrincipal({
      kind: 'human',
      handle: input.handle,
      displayName: input.displayName ?? null,
      // People sign in with sessions; this placeholder can never match a token.
      tokenHash: sha256(`no-token:${newToken()}`),
      passwordHash: hashPassword(input.password),
    });
    return { person, ...this.startSession(person) };
  }

  login(handle: string, password: string) {
    const row = this.store.principalByHandle(handle);
    const full = row ? this.store.principalRow(row.id) : null;
    if (!full || full.kind !== 'human' || !verifyPassword(password, full.passwordHash)) {
      fail(401, 'invalid_login', 'wrong handle or password');
    }
    return { person: row!, ...this.startSession(row!) };
  }

  private startSession(person: Principal) {
    const token = `ses_${newToken().slice(4)}`;
    const expiresAt = this.store.createSession(sha256(token), person.id, this.sessionTtl);
    return { token, expiresAt };
  }

  logout(token: string): void {
    this.store.deleteSession(sha256(token));
  }

  me(actor: Principal) {
    return {
      principal: actor,
      agents: actor.kind === 'human' ? this.store.agentsOwnedBy(actor.id) : [],
      channels: this.channelsFor(actor),
      telegramLinked: Boolean(this.store.principalRow(actor.id)?.telegramChatId),
    };
  }

  /** The agent named `handle`, if `actor` owns it (or is it, when `selfOk`). */
  private ownedAgent(actor: Principal, handle: string, selfOk = false): Principal {
    const agent = this.store.principalByHandle(handle);
    if (!agent || agent.kind !== 'agent') return fail(404, 'not_found');
    if (agent.ownerId === actor.id || (selfOk && agent.id === actor.id)) return agent;
    return fail(403, 'not_owner', 'only the agent’s owner can do this');
  }

  updateAgent(
    actor: Principal,
    handle: string,
    patch: { description?: string | null; discoverable?: boolean; paused?: boolean },
  ): Principal {
    const agent = this.ownedAgent(actor, handle, true);
    // An agent may describe itself; only its owner may pause it or change its visibility.
    if (
      agent.id === actor.id &&
      (patch.paused !== undefined || (patch.discoverable !== undefined && agent.ownerId))
    ) {
      fail(403, 'not_owner');
    }
    const updated = this.store.tx(() => {
      const p = this.store.updatePrincipal(agent.id, patch);
      this.store.emit(
        [agent.id, ...(agent.ownerId ? [agent.ownerId] : [])],
        'agent.updated',
        null,
        p,
      );
      return p;
    });
    // Unpausing doesn't release held requests; the owner approves them one by one.
    return updated;
  }

  rotateAgentToken(actor: Principal, handle: string): { agent: Principal; token: string } {
    const agent = this.ownedAgent(actor, handle);
    const token = newToken();
    this.store.updatePrincipal(agent.id, { tokenHash: sha256(token) });
    return { agent, token };
  }

  // =========================================================================
  // Access and sharing
  // =========================================================================

  private live(ch: ChannelRow | null): ch is ChannelRow {
    return Boolean(ch && !ch.revokedAt && (!ch.expiresAt || ch.expiresAt > now()));
  }

  /**
   * What `author` may do with `agent`:
   * - the agent's owner, and the owner's other agents, have full access ("owner");
   * - otherwise a live channel author → agent, or one held by the author's owner that
   *   covers their agents (`includeAgents`).
   */
  access(author: Principal, agent: Principal): Access | null {
    if (agent.kind !== 'agent' || author.id === agent.id) return null;
    if (agent.ownerId && (author.id === agent.ownerId || author.ownerId === agent.ownerId)) {
      return { mode: 'owner', scopes: [...SCOPES], channel: null };
    }
    let ch = this.store.channelBetween(author.id, agent.id);
    if (!this.live(ch) && author.ownerId) {
      const viaOwner = this.store.channelBetween(author.ownerId, agent.id);
      ch = this.live(viaOwner) && viaOwner.includeAgents ? viaOwner : null;
    }
    if (!this.live(ch)) return null;
    // Without an owner there is nobody to approve, so access is direct.
    return { mode: agent.ownerId ? ch.approval : 'auto', scopes: ch.scopes, channel: ch };
  }

  createInvite(
    actor: Principal,
    input: {
      agent?: string | undefined;
      scopes?: Scope[] | undefined;
      mutual?: boolean | undefined;
      approval?: ApprovalMode | undefined;
      includeAgents?: boolean | undefined;
      ttlSeconds?: number | undefined;
      maxUses?: number | undefined;
      grantTtlSeconds?: number | null | undefined;
    },
  ) {
    const target = input.agent
      ? this.ownedAgent(actor, input.agent, true)
      : actor.kind === 'agent'
        ? actor
        : fail(400, 'agent_required', 'say which of your agents this code gives access to');
    // Owned agents default to owner approval; an owned agent can't hand out more on its own.
    const ownerIssued = target.ownerId === actor.id;
    let approval: ApprovalMode = input.approval ?? (target.ownerId ? 'requests' : 'auto');
    if (!target.ownerId) approval = 'auto';
    else if (!ownerIssued && approval !== 'requests' && approval !== 'all') {
      fail(403, 'owner_must_grant', 'only the owner can grant access without approval');
    }
    return this.store.createInvite({
      code: newInviteCode(),
      issuerId: actor.id,
      targetId: target.id,
      scopes: input.scopes?.length ? input.scopes : ['message'],
      mutual: Boolean(input.mutual),
      approval,
      includeAgents: input.includeAgents ?? true,
      grantTtlSeconds: input.grantTtlSeconds ?? null,
      ttlSeconds: input.ttlSeconds ?? 24 * 3600,
      maxUses: input.maxUses ?? 1,
    });
  }

  /**
   * Redeeming opens a channel redeemer → agent. A mutual code between two agents also
   * opens agent → redeemer.
   */
  redeemInvite(actor: Principal, rawCode: string): { channels: Channel[] } {
    const code = normalizeInviteCode(rawCode);
    return this.store.tx(() => {
      const inv = this.store.invite(code);
      if (!inv) return fail(404, 'invalid_code');
      if (inv.expiresAt < now()) fail(409, 'code_expired');
      if (inv.uses >= inv.maxUses) fail(409, 'code_used');
      if (inv.targetId === actor.id || inv.issuerId === actor.id)
        fail(409, 'cannot_redeem_own_code');
      this.store.consumeInvite(code);
      const expiresAt = inv.grantTtlSeconds
        ? new Date(Date.now() + inv.grantTtlSeconds * 1000).toISOString()
        : null;
      const base = {
        scopes: inv.scopes,
        includeAgents: inv.includeAgents,
        expiresAt,
        grantedBy: inv.issuerId,
      };
      const channels = [
        this.store.upsertChannel({
          ...base,
          senderId: actor.id,
          recipientId: inv.targetId,
          approval: inv.approval,
        }),
      ];
      if (inv.mutual && actor.kind === 'agent') {
        channels.push(
          this.store.upsertChannel({
            ...base,
            senderId: inv.targetId,
            recipientId: actor.id,
            approval: 'auto',
          }),
        );
      }
      for (const ch of channels)
        this.store.emit(this.channelParties(ch), 'channel.created', null, publicChannel(ch));
      return { channels: channels.map(publicChannel) };
    });
  }

  /** Everyone who should see a channel: both ends and their owners. */
  private channelParties(ch: ChannelRow): string[] {
    const ids = [ch.senderId, ch.recipientId];
    for (const id of [ch.senderId, ch.recipientId]) {
      const owner = this.store.principalById(id)?.ownerId;
      if (owner) ids.push(owner);
    }
    return ids;
  }

  /** Channels `actor` is part of, plus (for people) those of the agents they own. */
  channelsFor(actor: Principal): Channel[] {
    const ids = [
      actor.id,
      ...(actor.kind === 'human' ? this.store.agentsOwnedBy(actor.id).map((a) => a.id) : []),
    ];
    return this.store.channelsInvolving(ids).map(publicChannel);
  }

  /** The owner of the receiving agent (or the agent itself, when unowned) can change access. */
  updateChannel(
    actor: Principal,
    id: string,
    patch: {
      scopes?: Scope[];
      approval?: ApprovalMode;
      includeAgents?: boolean;
      expiresAt?: string | null;
    },
  ): Channel {
    const ch = this.store.channelById(id);
    if (!ch || ch.revokedAt) return fail(404, 'not_found');
    const recipient = this.store.principalById(ch.recipientId)!;
    const controls = recipient.ownerId ? recipient.ownerId === actor.id : recipient.id === actor.id;
    if (!controls) fail(403, 'not_owner');
    return this.store.tx(() => {
      const updated = this.store.updateChannel(id, patch);
      this.store.emit(
        this.channelParties(updated),
        'channel.updated',
        null,
        publicChannel(updated),
      );
      return publicChannel(updated);
    });
  }

  /** Either end, or either end's owner, may revoke. */
  revokeChannel(actor: Principal, id: string): Channel {
    const ch = this.store.channelById(id);
    if (!ch || !this.channelParties(ch).includes(actor.id)) return fail(404, 'not_found');
    return this.store.tx(() => {
      const revoked = this.store.revokeChannel(id);
      this.store.emit(
        this.channelParties(revoked),
        'channel.revoked',
        null,
        publicChannel(revoked),
      );
      return publicChannel(revoked);
    });
  }

  // =========================================================================
  // Conversations
  // =========================================================================

  private joinedMember(actor: Principal, conversationId: string) {
    const m = this.store.member(conversationId, actor.id);
    if (!m || m.state !== 'joined') return fail(404, 'not_found');
    return m;
  }

  /** Adds an agent with its owner as overseer, so owners always see their agents' conversations. */
  private addAgentMember(
    conversationId: string,
    agent: Principal,
    addedBy: string,
    role: 'admin' | 'member' = 'member',
  ) {
    this.store.setMember(conversationId, agent.id, role, 'joined', addedBy);
    if (agent.ownerId && !this.store.member(conversationId, agent.ownerId)) {
      this.store.setMember(conversationId, agent.ownerId, 'overseer', 'joined', addedBy);
    }
  }

  createConversation(
    actor: Principal,
    input: { title?: string | null; members?: string[] },
  ): Conversation {
    return this.store.tx(() => {
      const id = this.store.createConversation({ title: input.title ?? null, createdBy: actor.id });
      if (actor.kind === 'agent') this.addAgentMember(id, actor, actor.id, 'admin');
      else this.store.setMember(id, actor.id, 'admin', 'joined', actor.id);
      for (const handle of input.members ?? []) this.addMemberInternal(actor, id, handle);
      this.notifyConversation(id, 'conversation.updated', this.store.getConversation(id));
      return this.store.getConversation(id)!;
    });
  }

  /** The conversation for one-to-one sends from `actor` to `agent` (old `POST /v1/tasks`, A2A without contextId). */
  directConversation(actor: Principal, agent: Principal): string {
    const key = [actor.id, agent.id].sort().join(':');
    const existing = this.store.conversationByDirectKey(key);
    if (existing) return existing;
    return this.store.tx(() => {
      const id = this.store.createConversation({
        title: null,
        createdBy: actor.id,
        directKey: key,
      });
      if (actor.kind === 'agent') this.addAgentMember(id, actor, actor.id, 'admin');
      else this.store.setMember(id, actor.id, 'admin', 'joined', actor.id);
      this.addAgentMember(id, agent, actor.id);
      return id;
    });
  }

  addMember(actor: Principal, conversationId: string, handle: string): Conversation {
    this.joinedMember(actor, conversationId);
    return this.store.tx(() => {
      this.addMemberInternal(actor, conversationId, handle);
      const conv = this.store.getConversation(conversationId)!;
      this.notifyConversation(conversationId, 'conversation.updated', conv);
      return conv;
    });
  }

  private addMemberInternal(actor: Principal, conversationId: string, handle: string): void {
    const target = this.store.principalByHandle(handle);
    if (!target) return fail(404, 'unknown_member', `no such agent or person: ${handle}`);
    const existing = this.store.member(conversationId, target.id);
    if (existing?.state === 'joined') return;
    if (target.kind === 'agent') {
      // Bringing an agent in needs access to it (or owning it).
      if (target.id !== actor.id && !this.access(actor, target)) {
        fail(
          403,
          'no_access',
          `you don’t have access to ${handle}; ask its owner for an invite code`,
        );
      }
      this.addAgentMember(conversationId, target, actor.id);
    } else {
      // People choose whether to join.
      this.store.setMember(conversationId, target.id, 'member', 'invited', actor.id);
      this.store.emit(
        [target.id],
        'conversation.invited',
        null,
        this.store.getConversation(conversationId),
      );
    }
    this.systemMessage(conversationId, actor.id, `@${actor.handle} added @${target.handle}`);
  }

  respondToInvite(actor: Principal, conversationId: string, accept: boolean): Conversation | null {
    const m = this.store.member(conversationId, actor.id);
    if (!m || m.state !== 'invited') return fail(404, 'not_found');
    return this.store.tx(() => {
      if (accept) {
        this.store.setMember(conversationId, actor.id, m.role, 'joined', null);
        this.systemMessage(conversationId, actor.id, `@${actor.handle} joined`);
      } else {
        this.store.removeMember(conversationId, actor.id);
      }
      const conv = this.store.getConversation(conversationId)!;
      this.notifyConversation(conversationId, 'conversation.updated', conv, [actor.id]);
      return accept ? conv : null;
    });
  }

  /** Leave, or remove someone: admins remove anyone, owners remove their agents. */
  removeMember(actor: Principal, conversationId: string, handle: string): void {
    const me = this.joinedMember(actor, conversationId);
    const target = this.store.principalByHandle(handle);
    if (!target || !this.store.member(conversationId, target.id)) return fail(404, 'not_found');
    const allowed = target.id === actor.id || me.role === 'admin' || target.ownerId === actor.id;
    if (!allowed) fail(403, 'not_allowed');
    const ownsAgentHere = this.store
      .members(conversationId)
      .some((m) => this.store.principalById(m.principalId)?.ownerId === target.id);
    if (ownsAgentHere)
      fail(409, 'remove_agents_first', 'remove your agents from the conversation first');
    this.store.tx(() => {
      this.store.removeMember(conversationId, target.id);
      this.systemMessage(
        conversationId,
        actor.id,
        target.id === actor.id
          ? `@${actor.handle} left`
          : `@${actor.handle} removed @${target.handle}`,
      );
      this.notifyConversation(
        conversationId,
        'conversation.updated',
        this.store.getConversation(conversationId),
        [target.id],
      );
    });
  }

  renameConversation(actor: Principal, conversationId: string, title: string | null): Conversation {
    this.joinedMember(actor, conversationId);
    return this.store.tx(() => {
      this.store.setConversationTitle(conversationId, title);
      const conv = this.store.getConversation(conversationId)!;
      this.notifyConversation(conversationId, 'conversation.updated', conv);
      return conv;
    });
  }

  listConversations(actor: Principal): ConversationSummary[] {
    return this.store.conversationIdsFor(actor.id).map((id) => {
      const conv = this.store.getConversation(id)!;
      const me = this.store.member(id, actor.id)!;
      const visible = me.state === 'joined' ? this.visibleMessages(actor, id, { limit: 1 }) : [];
      return {
        ...conv,
        myState: me.state,
        myRole: me.role,
        unread: me.state === 'joined' ? this.store.unreadCount(id, actor.id, me.lastReadSeq) : 0,
        lastMessage: visible[0] ?? null,
      };
    });
  }

  getConversation(actor: Principal, conversationId: string): Conversation {
    if (!this.store.member(conversationId, actor.id)) return fail(404, 'not_found');
    return this.store.getConversation(conversationId)!;
  }

  listMessages(
    actor: Principal,
    conversationId: string,
    opts: { before?: number; after?: number; limit?: number },
  ) {
    this.joinedMember(actor, conversationId);
    return this.visibleMessages(actor, conversationId, {
      ...(opts.before ? { beforeSeq: opts.before } : {}),
      ...(opts.after ? { afterSeq: opts.after } : {}),
      limit: Math.min(opts.limit ?? 50, 200),
    });
  }

  /**
   * An agent never sees a request that is still waiting for (or was refused by) its owner,
   * so approval really happens before the agent reads it. People see everything.
   */
  private visibleTo(viewer: Principal, msg: Message): boolean {
    if (viewer.kind !== 'agent') return true;
    return !msg.deliveries.some(
      (d) =>
        d.to === viewer.handle &&
        (d.status === 'pending_approval' ||
          (d.status === 'rejected' &&
            this.store.latestApproval(d.taskId, 'request')?.status === 'rejected')),
    );
  }

  private visibleMessages(
    viewer: Principal,
    conversationId: string,
    opts: { beforeSeq?: number; afterSeq?: number; limit: number },
  ): Message[] {
    const msgs = this.store.messages(conversationId, opts);
    return viewer.kind === 'agent' ? msgs.filter((m) => this.visibleTo(viewer, m)) : msgs;
  }

  markRead(actor: Principal, conversationId: string, seq: number): void {
    this.joinedMember(actor, conversationId);
    this.store.markRead(conversationId, actor.id, seq);
  }

  attachment(actor: Principal, id: string) {
    const file = this.store.attachment(id);
    if (!file || this.store.member(file.conversationId, actor.id)?.state !== 'joined')
      return fail(404, 'not_found');
    return file;
  }

  // =========================================================================
  // Messages → agent tasks
  // =========================================================================

  /**
   * Post into a conversation. Agents addressed by `to`, by @mention, or implicitly (the only
   * other agent in the conversation) each get a task; requests that need the owner's
   * approval wait in their approval queue.
   */
  postMessage(actor: Principal, conversationId: string, input: PostInput): Message {
    this.joinedMember(actor, conversationId);
    const body = input.body.trim();
    if (!body && !input.attachments?.length) fail(400, 'empty_message');
    const kind = input.kind ?? 'message';
    if (!SCOPES.includes(kind)) fail(400, 'invalid_kind');

    const agentMembers = this.store
      .members(conversationId)
      .filter((m) => m.state === 'joined')
      .map((m) => this.store.principalById(m.principalId)!)
      .filter((p) => p.kind === 'agent' && p.id !== actor.id);
    const byHandle = new Map(agentMembers.map((a) => [a.handle, a]));

    const named = new Set<string>(input.to ?? []);
    for (const match of body.matchAll(MENTION)) {
      if (byHandle.has(match[1]!.toLowerCase())) named.add(match[1]!.toLowerCase());
    }
    let addressed: Principal[] = [];
    for (const handle of named) {
      const agent = byHandle.get(handle);
      if (!agent) fail(400, 'not_a_member_agent', `${handle} is not an agent in this conversation`);
      addressed.push(agent!);
    }
    if (!addressed.length && !input.to && agentMembers.length === 1) addressed = agentMembers;

    // Check every recipient before writing anything.
    const plans = addressed.map((agent) => {
      const acc = this.access(actor, agent);
      if (acc && !acc.scopes.includes(kind)) {
        fail(
          403,
          'scope_not_allowed',
          `your access to ${agent.handle} only allows: ${acc.scopes.join(', ')}`,
          {
            allowed: acc.scopes,
          },
        );
      }
      if (!acc && !agent.ownerId)
        fail(403, 'no_access', `you don’t have access to ${agent.handle}`);
      return { agent, acc };
    });
    const files = (input.attachments ?? []).map((a) => this.decodeAttachment(a));
    if (plans.length) this.checkDeliveryRate(conversationId);

    const message = this.store.tx(() => {
      const msg = this.store.insertMessage({
        conversationId,
        authorId: actor.id,
        kind: 'text',
        body,
        toIds: addressed.map((a) => a.id),
        replyTo: input.replyTo ?? null,
        taskId: null,
      });
      for (const f of files)
        this.store.insertAttachment({
          ...f,
          conversationId,
          messageId: msg.id,
          createdBy: actor.id,
        });
      const full = this.store.getMessage(msg.id)!;
      for (const { agent, acc } of plans) {
        this.deliver(actor, conversationId, full, agent, acc, {
          kind,
          project: input.project ?? null,
          title: input.title ?? null,
        });
      }
      const final = this.store.getMessage(msg.id)!;
      this.notifyMessage(final);
      return final;
    });
    return message;
  }

  private decodeAttachment(a: AttachmentInput) {
    const data = Buffer.from(a.data, 'base64');
    if (data.byteLength > this.maxAttachment) {
      fail(413, 'attachment_too_large', `attachments are limited to ${this.maxAttachment} bytes`);
    }
    const filename = a.filename.replace(/[/\\\0]/g, '_').slice(0, 200) || 'file';
    return {
      filename,
      mediaType: a.mediaType || 'application/octet-stream',
      data: new Uint8Array(data),
      sha256: createHash('sha256').update(data).digest('hex'),
    };
  }

  private recent = new Map<string, number[]>();

  private checkDeliveryRate(conversationId: string): void {
    const t = Date.now();
    const times = (this.recent.get(conversationId) ?? []).filter((x) => t - x < 60_000);
    if (times.length >= this.deliveryLimit) {
      fail(429, 'too_many_requests', 'too many agent requests in this conversation; slow down');
    }
    times.push(t);
    this.recent.set(conversationId, times);
  }

  /** Turns a message into a task for `agent` (or continues one waiting for input). */
  private deliver(
    actor: Principal,
    conversationId: string,
    message: Message,
    agent: Principal,
    acc: Access | null,
    opts: { kind: Scope; project: string | null; title: string | null },
  ): TaskRow {
    const isOwner = acc?.mode === 'owner';
    const held = !isOwner && (agent.paused || !acc || acc.mode !== 'auto');
    const mode = acc?.mode ?? 'requests';
    const text = taskText(message);

    let task: TaskRow;
    const waiting = this.store.openTaskIn(conversationId, agent.id, ['input_required']);
    if (waiting) {
      this.store.addTaskMessage(waiting.id, actor.id, text);
      this.store.db
        .prepare('UPDATE tasks SET request_message_id = ?, approval = ? WHERE id = ?')
        .run(message.id, mode, waiting.id);
      task = this.store.setTaskStatus(waiting.id, held ? 'pending_approval' : 'submitted', null);
    } else {
      task = this.store.createTask({
        senderId: actor.id,
        recipientId: agent.id,
        kind: opts.kind,
        project: opts.project,
        title: opts.title,
        body: text,
        contextId: conversationId,
        status: held ? 'pending_approval' : 'submitted',
        approval: mode,
        requestMessageId: message.id,
      });
    }
    if (held) {
      const approval = this.store.createApproval({
        kind: 'request',
        taskId: task.id,
        conversationId,
        agentId: agent.id,
        ownerId: agent.ownerId!,
        requesterId: actor.id,
        body: text,
        proposedStatus: null,
      });
      this.store.emit(
        [agent.ownerId!],
        'approval.requested',
        task.id,
        this.publicApproval(approval),
      );
    }
    this.emitTask(task, waiting ? 'task.updated' : 'task.created');
    return task;
  }

  /** Send to one agent outside any named conversation (REST `POST /v1/tasks`). Needs access. */
  sendDirect(
    actor: Principal,
    toHandle: string,
    input: {
      kind: Scope;
      project: string | null;
      title: string | null;
      body: string;
      attachments?: AttachmentInput[];
    },
  ): Task {
    const agent = this.store.principalByHandle(toHandle);
    // Same error for "no such agent" and "no access".
    const acc = agent ? this.access(actor, agent) : null;
    if (!agent || !acc)
      return fail(403, 'no_channel', 'redeem an invite code for this agent first');
    if (!acc.scopes.includes(input.kind)) {
      fail(
        403,
        'scope_not_allowed',
        `your access to ${agent.handle} only allows: ${acc.scopes.join(', ')}`,
        {
          allowed: acc.scopes,
        },
      );
    }
    const conversationId = this.directConversation(actor, agent);
    return this.sendInConversation(actor, conversationId, agent, input);
  }

  /** Post addressed to exactly one agent and return its task (A2A and the REST task API use this). */
  sendInConversation(
    actor: Principal,
    conversationId: string,
    agent: Principal,
    input: {
      kind: Scope;
      project: string | null;
      title: string | null;
      body: string;
      attachments?: AttachmentInput[];
    },
  ): Task {
    if (this.store.member(conversationId, agent.id)?.state !== 'joined') {
      this.addMember(actor, conversationId, agent.handle);
    }
    const msg = this.postMessage(actor, conversationId, { ...input, to: [agent.handle] });
    const delivery = msg.deliveries.find((d) => d.to === agent.handle)!;
    return this.store.getTask(delivery.taskId)!;
  }

  /** The sender adds to a task (answering `input_required`), or the recipient adds a note. */
  continueTask(
    actor: Principal,
    taskId: string,
    body: string,
    attachments?: AttachmentInput[],
  ): Task {
    const t = this.store.taskRow(taskId);
    if (!t || (t.senderId !== actor.id && t.recipientId !== actor.id))
      return fail(404, 'not_found');
    if (TERMINAL_STATUSES.includes(t.status)) fail(409, 'task_closed');
    if (t.senderId === actor.id) {
      const agent = this.store.principalById(t.recipientId)!;
      if (t.status === 'input_required') {
        return this.sendInConversation(actor, t.contextId, agent, {
          kind: t.kind,
          project: t.project,
          title: t.title,
          body,
          ...(attachments ? { attachments } : {}),
        });
      }
      // Additional context while the agent works: thread note only.
      this.store.tx(() => {
        const m = this.store.addTaskMessage(t.id, actor.id, body);
        this.emitTaskMessage(t, m);
      });
      return this.store.getTask(t.id)!;
    }
    this.store.tx(() => {
      const m = this.store.addTaskMessage(t.id, actor.id, body);
      this.emitTaskMessage(t, m);
    });
    return this.store.getTask(t.id)!;
  }

  /**
   * The recipient agent (or its owner, taking over) moves a task; the sender may cancel.
   * With `approval: all`, the agent's outcome waits for the owner before anyone sees it.
   */
  setTaskStatus(actor: Principal, taskId: string, status: TaskStatus, result: string | null): Task {
    const t = this.store.taskRow(taskId);
    const agent = t ? this.store.principalById(t.recipientId)! : null;
    const isOwner = Boolean(agent?.ownerId && agent.ownerId === actor.id);
    if (!t || !agent || (t.senderId !== actor.id && t.recipientId !== actor.id && !isOwner)) {
      return fail(404, 'not_found');
    }
    if (t.status === 'pending_approval' && t.recipientId === actor.id)
      return fail(404, 'not_found');
    const allowed =
      status === 'canceled'
        ? (t.senderId === actor.id || isOwner) && !TERMINAL_STATUSES.includes(t.status)
        : (t.recipientId === actor.id || isOwner) &&
          RECIPIENT_TRANSITIONS[t.status].includes(status);
    if (!allowed) fail(409, 'invalid_transition', undefined, { from: t.status, to: status });

    return this.store.tx(() => {
      if (OUTCOMES.includes(status) && !isOwner && t.approval === 'all' && agent.ownerId) {
        const held = this.store.holdTaskOutcome(t.id, status, result);
        const approval = this.store.createApproval({
          kind: 'reply',
          taskId: t.id,
          conversationId: t.contextId,
          agentId: agent.id,
          ownerId: agent.ownerId,
          requesterId: t.senderId,
          body: result ?? '',
          proposedStatus: status,
        });
        this.store.emit([agent.ownerId], 'approval.requested', t.id, this.publicApproval(approval));
        this.emitTask(held, 'task.updated');
        return this.store.getTask(t.id)!;
      }
      if (status === 'canceled') this.closeApproval(t.id, actor);
      return this.applyOutcome(t, status, result, status === 'canceled' ? actor : null);
    });
  }

  private closeApproval(taskId: string, actor: Principal): void {
    const a = this.store.pendingApprovalForTask(taskId);
    if (a) {
      const decided = this.store.decideApproval(a.id, 'rejected', actor.id, 'canceled');
      this.store.emit(
        [a.ownerId, a.requesterId],
        'approval.resolved',
        taskId,
        this.publicApproval(decided),
      );
    }
  }

  /** Records the outcome and posts it into the conversation. */
  private applyOutcome(
    t: TaskRow,
    status: TaskStatus,
    result: string | null,
    canceledBy: Principal | null,
  ): Task {
    const updated = this.store.setTaskStatus(t.id, status, result);
    this.emitTask(updated, 'task.updated');
    if (OUTCOMES.includes(status)) {
      const text =
        status === 'completed'
          ? result || '(no output)'
          : status === 'input_required'
            ? result || 'I need more information to continue.'
            : status === 'failed'
              ? `⚠️ I couldn’t complete this: ${result ?? 'unknown error'}`
              : `I declined this request${result ? `: ${result}` : '.'}`;
      const msg = this.store.insertMessage({
        conversationId: t.contextId,
        authorId: t.recipientId,
        kind: 'reply',
        body: text,
        toIds: [],
        replyTo: t.requestMessageId,
        taskId: t.id,
      });
      this.notifyMessage(msg);
    } else if (canceledBy) {
      this.systemMessage(
        t.contextId,
        canceledBy.id,
        `@${canceledBy.handle} canceled the request to @${t.to}`,
      );
    }
    return this.store.getTask(t.id)!;
  }

  // =========================================================================
  // Owner approvals
  // =========================================================================

  listApprovals(actor: Principal, status: ApprovalStatus | null = 'pending'): Approval[] {
    return this.store.approvalsForOwner(actor.id, status).map((a) => this.publicApproval(a));
  }

  /**
   * Approve or reject. Approving a request can edit what the agent receives; approving a
   * reply can edit what the requester receives.
   */
  decide(
    actor: Principal,
    approvalId: string,
    decision: 'approve' | 'reject',
    opts: { body?: string | undefined; note?: string | undefined } = {},
  ): Approval {
    const a = this.store.approval(approvalId);
    if (!a || a.ownerId !== actor.id) return fail(404, 'not_found');
    if (a.status !== 'pending') fail(409, 'already_decided');
    const t = this.store.taskRow(a.taskId)!;
    const note = opts.note?.trim() || null;

    return this.store.tx(() => {
      const decided = this.store.decideApproval(
        a.id,
        decision === 'approve' ? 'approved' : 'rejected',
        actor.id,
        note,
        opts.body,
      );
      if (a.kind === 'request') {
        if (decision === 'approve') {
          if (opts.body !== undefined && opts.body !== t.body)
            this.store.setTaskBody(t.id, opts.body);
          const updated = this.store.setTaskStatus(t.id, 'submitted', null);
          // The agent couldn't see the request until now.
          const msg = t.requestMessageId ? this.store.getMessage(t.requestMessageId) : null;
          if (msg) this.store.emit([t.recipientId], 'message.created', null, msg);
          this.emitTask(updated, 'task.updated');
        } else {
          const updated = this.store.setTaskStatus(
            t.id,
            'rejected',
            `Declined by owner${note ? `: ${note}` : ''}`,
          );
          this.emitTask(updated, 'task.updated');
          this.systemMessage(
            t.contextId,
            actor.id,
            `@${actor.handle} declined @${a.requester}’s request to @${a.agent}${note ? `: ${note}` : ''}`,
          );
        }
      } else if (decision === 'approve') {
        this.applyOutcome(t, t.pendingStatus ?? 'completed', opts.body ?? t.pendingResult, null);
      } else {
        const updated = this.store.setTaskStatus(
          t.id,
          'failed',
          `The owner withheld this reply${note ? `: ${note}` : '.'}`,
        );
        this.emitTask(updated, 'task.updated');
        this.systemMessage(
          t.contextId,
          actor.id,
          `@${actor.handle} withheld @${a.agent}’s reply${note ? `: ${note}` : ''}`,
        );
      }
      const pub = this.publicApproval(decided);
      this.store.emit([a.ownerId, a.requesterId], 'approval.resolved', a.taskId, pub);
      return pub;
    });
  }

  publicApproval(
    a: Approval & { agentId?: string; ownerId?: string; requesterId?: string },
  ): Approval {
    const { agentId: _a, ownerId: _o, requesterId: _r, ...rest } = a;
    return rest;
  }

  // =========================================================================
  // Tasks (agent view)
  // =========================================================================

  private canSeeTask(actor: Principal, t: TaskRow): boolean {
    const recipient = this.store.principalById(t.recipientId);
    const sender = this.store.principalById(t.senderId);
    if (t.recipientId === actor.id) return t.status !== 'pending_approval';
    return (
      t.senderId === actor.id || recipient?.ownerId === actor.id || sender?.ownerId === actor.id
    );
  }

  getTask(
    actor: Principal,
    taskId: string,
  ): { task: Task; messages: TaskMessage[]; context: Message[] } {
    const t = this.store.taskRow(taskId);
    if (!t || !this.canSeeTask(actor, t)) return fail(404, 'not_found');
    // Recent conversation before the request, as the agent is allowed to see it.
    const before = t.requestMessageId ? this.store.getMessage(t.requestMessageId)?.seq : undefined;
    const context = this.visibleMessages(actor, t.contextId, {
      ...(before ? { beforeSeq: before } : {}),
      limit: 20,
    }).filter((m) => m.kind !== 'system');
    return { task: this.store.getTask(t.id)!, messages: this.store.taskMessages(t.id), context };
  }

  /** Raw task for adapters that already checked access. */
  taskRow(taskId: string): TaskRow | null {
    return this.store.taskRow(taskId);
  }

  listTasks(
    actor: Principal,
    box: 'inbox' | 'outbox',
    statuses: TaskStatus[] | null,
    limit: number,
  ): Task[] {
    const tasks = this.store.listTasks(actor.id, box, statuses, limit);
    return box === 'inbox' ? tasks.filter((t) => t.status !== 'pending_approval') : tasks;
  }

  // =========================================================================
  // Events
  // =========================================================================

  /** Task events reach sender, recipient (not while held for approval) and both owners. */
  private emitTask(t: TaskRow, type: GatewayEventType): void {
    const sender = this.store.principalById(t.senderId);
    const recipient = this.store.principalById(t.recipientId);
    const ids = [t.senderId, sender?.ownerId, recipient?.ownerId].filter(Boolean) as string[];
    if (t.status !== 'pending_approval') ids.push(t.recipientId);
    const task = this.store.getTask(t.id)!;
    this.store.emit(ids, type, t.id, task);
    for (const fn of this.taskListeners) queueMicrotask(() => fn(task));
  }

  private emitTaskMessage(t: TaskRow, m: TaskMessage): void {
    const sender = this.store.principalById(t.senderId);
    const recipient = this.store.principalById(t.recipientId);
    const ids = [t.senderId, t.recipientId, sender?.ownerId, recipient?.ownerId].filter(
      Boolean,
    ) as string[];
    this.store.emit(ids, 'task.message', t.id, m);
  }

  private notifyConversation(
    conversationId: string,
    type: GatewayEventType,
    data: unknown,
    extra: string[] = [],
  ): void {
    const ids = this.store
      .members(conversationId)
      .filter((m) => m.state === 'joined')
      .map((m) => m.principalId);
    this.store.emit([...ids, ...extra], type, null, data);
  }

  private notifyMessage(msg: Message): void {
    const ids = this.store
      .members(msg.conversationId)
      .filter((m) => m.state === 'joined')
      .map((m) => this.store.principalById(m.principalId)!)
      .filter((p) => this.visibleTo(p, msg))
      .map((p) => p.id);
    this.store.emit(ids, 'message.created', null, msg);
  }

  private systemMessage(conversationId: string, authorId: string, body: string): void {
    const msg = this.store.insertMessage({
      conversationId,
      authorId,
      kind: 'system',
      body,
      toIds: [],
      replyTo: null,
      taskId: null,
    });
    this.notifyMessage(msg);
  }

  // =========================================================================
  // Telegram linking
  // =========================================================================

  createTelegramLinkCode(actor: Principal): string {
    if (actor.kind !== 'human') fail(403, 'people_only');
    const code = newInviteCode().replace('NODD-', 'TG-');
    this.store.createTelegramLink(sha256(code), actor.id, 15 * 60);
    return code;
  }

  linkTelegram(code: string, chatId: string): Principal | null {
    const principalId = this.store.consumeTelegramLink(sha256(normalizeInviteCode(code)));
    if (!principalId) return null;
    return this.store.updatePrincipal(principalId, { telegramChatId: chatId });
  }

  unlinkTelegram(actor: Principal): void {
    this.store.updatePrincipal(actor.id, { telegramChatId: null });
  }
}

/** What the agent receives for a message: its text plus a list of attachments. */
function taskText(message: Message): string {
  const files = message.attachments.map(
    (a) => `[attachment ${a.id}: ${a.filename} (${a.mediaType}, ${a.size} bytes)]`,
  );
  return [message.body, ...files].filter(Boolean).join('\n');
}

export function publicChannel(ch: ChannelRow): Channel {
  const { senderId: _s, recipientId: _r, ...rest } = ch;
  return rest;
}
