import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { newId, sha256 } from './auth.js';
import type {
  Approval,
  ApprovalKind,
  ApprovalMode,
  ApprovalStatus,
  Attachment,
  Channel,
  Conversation,
  Delivery,
  GatewayEvent,
  GatewayEventType,
  Member,
  MemberRole,
  MemberState,
  Message,
  MessageKind,
  Principal,
  PrincipalKind,
  Scope,
  Task,
  TaskMessage,
  TaskStatus,
} from './types.js';

// Data access only. Rules (who may do what, approvals, fan-out) live in gateway.ts.

type Row = Record<string, unknown>;
type Value = string | number | null | Uint8Array;

// The original tables; later versions extend them in migrate().
const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  description TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
  code_hash TEXT PRIMARY KEY,
  issuer_id TEXT NOT NULL REFERENCES agents(id),
  scopes TEXT NOT NULL,
  mutual INTEGER NOT NULL,
  max_uses INTEGER NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES agents(id),
  recipient_id TEXT NOT NULL REFERENCES agents(id),
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (sender_id, recipient_id)
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES agents(id),
  recipient_id TEXT NOT NULL REFERENCES agents(id),
  kind TEXT NOT NULL,
  project TEXT,
  title TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_recipient ON tasks (recipient_id, status);
CREATE INDEX IF NOT EXISTS tasks_sender ON tasks (sender_id, status);
CREATE TABLE IF NOT EXISTS task_messages (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  author_id TEXT NOT NULL REFERENCES agents(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  type TEXT NOT NULL,
  task_id TEXT,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_agent ON events (agent_id, seq);
`;

// The "agents" table holds every principal: people and agents.
const COLUMNS: [table: string, column: string, definition: string][] = [
  ['agents', 'kind', "TEXT NOT NULL DEFAULT 'agent'"],
  ['agents', 'display_name', 'TEXT'],
  ['agents', 'owner_id', 'TEXT REFERENCES agents(id)'],
  ['agents', 'password_hash', 'TEXT'],
  ['agents', 'discoverable', 'INTEGER NOT NULL DEFAULT 0'],
  ['agents', 'paused', 'INTEGER NOT NULL DEFAULT 0'],
  ['agents', 'telegram_chat_id', 'TEXT'],
  ['agents', 'telegram_notify', "TEXT NOT NULL DEFAULT 'all'"],
  ['invites', 'target_id', 'TEXT REFERENCES agents(id)'],
  ['invites', 'approval', "TEXT NOT NULL DEFAULT 'auto'"],
  ['invites', 'include_agents', 'INTEGER NOT NULL DEFAULT 0'],
  ['invites', 'grant_ttl_seconds', 'INTEGER'],
  ['channels', 'approval', "TEXT NOT NULL DEFAULT 'auto'"],
  ['channels', 'include_agents', 'INTEGER NOT NULL DEFAULT 0'],
  ['channels', 'expires_at', 'TEXT'],
  ['channels', 'granted_by', 'TEXT'],
  ['tasks', 'context_id', 'TEXT'],
  ['tasks', 'approval', "TEXT NOT NULL DEFAULT 'auto'"],
  ['tasks', 'request_message_id', 'TEXT'],
  ['tasks', 'pending_status', 'TEXT'],
  ['tasks', 'pending_result', 'TEXT'],
];

const SCHEMA_V3 = `
CREATE INDEX IF NOT EXISTS tasks_context ON tasks (context_id);
CREATE INDEX IF NOT EXISTS agents_owner ON agents (owner_id);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES agents(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  direct_key TEXT UNIQUE,
  created_by TEXT NOT NULL REFERENCES agents(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  principal_id TEXT NOT NULL REFERENCES agents(id),
  role TEXT NOT NULL,
  state TEXT NOT NULL,
  added_by TEXT,
  joined_at TEXT NOT NULL,
  last_read_seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, principal_id)
);
CREATE INDEX IF NOT EXISTS members_principal ON conversation_members (principal_id);
CREATE TABLE IF NOT EXISTS messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  author_id TEXT NOT NULL REFERENCES agents(id),
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  to_ids TEXT NOT NULL DEFAULT '[]',
  reply_to TEXT,
  task_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_conversation ON messages (conversation_id, seq);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  message_id TEXT,
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  data BLOB NOT NULL,
  created_by TEXT NOT NULL REFERENCES agents(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_message ON attachments (message_id);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  conversation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  owner_id TEXT NOT NULL REFERENCES agents(id),
  requester_id TEXT NOT NULL REFERENCES agents(id),
  body TEXT NOT NULL,
  proposed_status TEXT,
  note TEXT,
  decided_by TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS approvals_owner ON approvals (owner_id, status);
CREATE TABLE IF NOT EXISTS push_configs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  principal_id TEXT NOT NULL REFERENCES agents(id),
  url TEXT NOT NULL,
  token TEXT,
  auth_scheme TEXT,
  auth_credentials TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS telegram_links (
  code_hash TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES agents(id),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS telegram_messages (
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  conversation_id TEXT,
  approval_id TEXT,
  PRIMARY KEY (chat_id, message_id)
);
`;

export const now = () => new Date().toISOString();

const str = (v: unknown) => (v == null ? null : String(v));

export interface PrincipalRow extends Principal {
  tokenHash: string;
  passwordHash: string | null;
  telegramChatId: string | null;
}

export interface ChannelRow extends Channel {
  senderId: string;
  recipientId: string;
}

export interface InviteRow {
  issuerId: string;
  targetId: string;
  scopes: Scope[];
  mutual: boolean;
  approval: ApprovalMode;
  includeAgents: boolean;
  grantTtlSeconds: number | null;
  maxUses: number;
  uses: number;
  expiresAt: string;
}

export interface TaskRow extends Task {
  senderId: string;
  recipientId: string;
  pendingStatus: TaskStatus | null;
  pendingResult: string | null;
}

export interface ApprovalRow extends Approval {
  agentId: string;
  ownerId: string;
  requesterId: string;
}

export interface MemberRow {
  principalId: string;
  /** Who added this member (null for the creator). */
  addedBy: string | null;
  role: MemberRole;
  state: MemberState;
  lastReadSeq: number;
}

export interface PushConfigRow {
  id: string;
  taskId: string;
  principalId: string;
  url: string;
  token: string | null;
  authScheme: string | null;
  authCredentials: string | null;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;',
    );
    this.db.exec(BASE_SCHEMA);
    this.migrate();
  }

  /** Additive migrations, so databases from any earlier version keep working. */
  private migrate(): void {
    for (const [table, column, definition] of COLUMNS) {
      const cols = (this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map(
        (r) => r.name,
      );
      if (!cols.includes(column)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }
    this.db.exec(SCHEMA_V3);
    this.db.exec("UPDATE tasks SET context_id = 'ctx_' || id WHERE context_id IS NULL");
    this.db.exec('UPDATE invites SET target_id = issuer_id WHERE target_id IS NULL');

    // Tasks from before conversations existed get one conversation per context.
    const orphans = this.db
      .prepare(
        `SELECT * FROM tasks WHERE context_id NOT IN (SELECT id FROM conversations)
         ORDER BY created_at`,
      )
      .all() as Row[];
    for (const t of orphans) {
      const convId = String(t.context_id);
      if (!this.conversationRow(convId)) {
        this.db
          .prepare(
            'INSERT INTO conversations (id, title, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(
            convId,
            str(t.title),
            String(t.sender_id),
            String(t.created_at),
            String(t.updated_at),
          );
        this.setMember(convId, String(t.sender_id), 'admin', 'joined', null);
        this.setMember(convId, String(t.recipient_id), 'member', 'joined', null);
      }
      const msg = this.insertMessage({
        conversationId: convId,
        authorId: String(t.sender_id),
        kind: 'text',
        body: String(t.body),
        toIds: [String(t.recipient_id)],
        replyTo: null,
        taskId: null,
      });
      this.db
        .prepare('UPDATE tasks SET request_message_id = ? WHERE id = ?')
        .run(msg.id, String(t.id));
      if (t.result != null) {
        this.insertMessage({
          conversationId: convId,
          authorId: String(t.recipient_id),
          kind: 'reply',
          body: String(t.result),
          toIds: [],
          replyTo: msg.id,
          taskId: String(t.id),
        });
      }
    }
  }

  close(): void {
    this.db.close();
  }

  private depth = 0;

  /** Runs `fn` in a transaction; nested calls join the outer one. */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const out = fn();
      this.depth--;
      this.db.exec('COMMIT');
      this.flush();
      return out;
    } catch (err) {
      this.depth--;
      this.db.exec('ROLLBACK');
      this.pending = [];
      throw err;
    }
  }

  private get<T = Row>(sql: string, ...args: Value[]): T | undefined {
    return this.db.prepare(sql).get(...args) as T | undefined;
  }

  private all<T = Row>(sql: string, ...args: Value[]): T[] {
    return this.db.prepare(sql).all(...args) as T[];
  }

  private run(sql: string, ...args: Value[]) {
    return this.db.prepare(sql).run(...args);
  }

  // ---- principals (people and agents) ----

  createPrincipal(input: {
    kind: PrincipalKind;
    handle: string;
    displayName?: string | null;
    description?: string | null;
    ownerId?: string | null;
    tokenHash: string;
    passwordHash?: string | null;
  }): Principal {
    const id = newId(input.kind === 'human' ? 'usr' : 'agt');
    this.run(
      `INSERT INTO agents (id, kind, handle, display_name, description, owner_id, token_hash, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.kind,
      input.handle,
      input.displayName ?? null,
      input.description ?? null,
      input.ownerId ?? null,
      input.tokenHash,
      input.passwordHash ?? null,
      now(),
    );
    return this.principalById(id)!;
  }

  principalRow(id: string): PrincipalRow | null {
    const r = this.get(
      `SELECT a.*, o.handle AS owner_handle FROM agents a LEFT JOIN agents o ON o.id = a.owner_id WHERE a.id = ?`,
      id,
    );
    return r ? toPrincipalRow(r) : null;
  }

  principalById(id: string): Principal | null {
    return strip(this.principalRow(id));
  }

  principalByHandle(handle: string): Principal | null {
    const r = this.get<Row>('SELECT id FROM agents WHERE handle = ?', handle);
    return r ? this.principalById(String(r.id)) : null;
  }

  principalByTokenHash(tokenHash: string): Principal | null {
    const r = this.get<Row>(
      "SELECT id FROM agents WHERE token_hash = ? AND kind = 'agent'",
      tokenHash,
    );
    return r ? this.principalById(String(r.id)) : null;
  }

  principalByTelegramChat(chatId: string): Principal | null {
    const r = this.get<Row>('SELECT id FROM agents WHERE telegram_chat_id = ?', chatId);
    return r ? this.principalById(String(r.id)) : null;
  }

  updatePrincipal(
    id: string,
    patch: Partial<{
      displayName: string | null;
      description: string | null;
      discoverable: boolean;
      paused: boolean;
      tokenHash: string;
      passwordHash: string;
      telegramChatId: string | null;
    }>,
  ): Principal {
    const cols: Record<string, string> = {
      displayName: 'display_name',
      description: 'description',
      discoverable: 'discoverable',
      paused: 'paused',
      tokenHash: 'token_hash',
      passwordHash: 'password_hash',
      telegramChatId: 'telegram_chat_id',
    };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      const v = typeof value === 'boolean' ? (value ? 1 : 0) : value;
      this.run(`UPDATE agents SET ${cols[key]} = ? WHERE id = ?`, v, id);
    }
    return this.principalById(id)!;
  }

  agentsOwnedBy(ownerId: string): Principal[] {
    return this.all<Row>(
      'SELECT id FROM agents WHERE owner_id = ? ORDER BY created_at',
      ownerId,
    ).map((r) => this.principalById(String(r.id))!);
  }

  handleOf(id: string): string {
    return String(this.get<Row>('SELECT handle FROM agents WHERE id = ?', id)?.handle ?? id);
  }

  // ---- sessions (people) ----

  createSession(tokenHash: string, principalId: string, ttlSeconds: number): string {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    this.run(
      'INSERT INTO sessions (token_hash, principal_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      tokenHash,
      principalId,
      now(),
      expiresAt,
    );
    return expiresAt;
  }

  principalBySessionHash(tokenHash: string): Principal | null {
    const r = this.get<Row>(
      'SELECT principal_id FROM sessions WHERE token_hash = ? AND expires_at > ?',
      tokenHash,
      now(),
    );
    return r ? this.principalById(String(r.principal_id)) : null;
  }

  deleteSession(tokenHash: string): void {
    this.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
  }

  // ---- invites & channels ----

  createInvite(input: {
    code: string;
    issuerId: string;
    targetId: string;
    scopes: Scope[];
    mutual: boolean;
    approval: ApprovalMode;
    includeAgents: boolean;
    grantTtlSeconds: number | null;
    ttlSeconds: number;
    maxUses: number;
  }) {
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000).toISOString();
    this.run(
      `INSERT INTO invites (code_hash, issuer_id, target_id, scopes, mutual, approval, include_agents,
         grant_ttl_seconds, max_uses, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sha256(input.code),
      input.issuerId,
      input.targetId,
      input.scopes.join(','),
      input.mutual ? 1 : 0,
      input.approval,
      input.includeAgents ? 1 : 0,
      input.grantTtlSeconds,
      input.maxUses,
      expiresAt,
      now(),
    );
    return {
      code: input.code,
      agent: this.handleOf(input.targetId),
      scopes: input.scopes,
      mutual: input.mutual,
      approval: input.approval,
      includeAgents: input.includeAgents,
      maxUses: input.maxUses,
      expiresAt,
    };
  }

  invite(code: string): InviteRow | null {
    const r = this.get('SELECT * FROM invites WHERE code_hash = ?', sha256(code));
    if (!r) return null;
    return {
      issuerId: String(r.issuer_id),
      targetId: String(r.target_id ?? r.issuer_id),
      scopes: String(r.scopes).split(',') as Scope[],
      mutual: Boolean(r.mutual),
      approval: String(r.approval) as ApprovalMode,
      includeAgents: Boolean(r.include_agents),
      grantTtlSeconds: r.grant_ttl_seconds == null ? null : Number(r.grant_ttl_seconds),
      maxUses: Number(r.max_uses),
      uses: Number(r.uses),
      expiresAt: String(r.expires_at),
    };
  }

  consumeInvite(code: string): void {
    this.run('UPDATE invites SET uses = uses + 1 WHERE code_hash = ?', sha256(code));
  }

  upsertChannel(input: {
    senderId: string;
    recipientId: string;
    scopes: Scope[];
    approval: ApprovalMode;
    includeAgents: boolean;
    expiresAt: string | null;
    grantedBy: string | null;
  }): ChannelRow {
    this.run(
      `INSERT INTO channels (id, sender_id, recipient_id, scopes, approval, include_agents, expires_at, granted_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (sender_id, recipient_id) DO UPDATE SET scopes = excluded.scopes,
         approval = excluded.approval, include_agents = excluded.include_agents,
         expires_at = excluded.expires_at, granted_by = excluded.granted_by, revoked_at = NULL`,
      newId('chn'),
      input.senderId,
      input.recipientId,
      input.scopes.join(','),
      input.approval,
      input.includeAgents ? 1 : 0,
      input.expiresAt,
      input.grantedBy,
      now(),
    );
    return this.channelBetween(input.senderId, input.recipientId)!;
  }

  channelBetween(senderId: string, recipientId: string): ChannelRow | null {
    const r = this.get(
      'SELECT * FROM channels WHERE sender_id = ? AND recipient_id = ?',
      senderId,
      recipientId,
    );
    return r ? this.toChannel(r) : null;
  }

  channelById(id: string): ChannelRow | null {
    const r = this.get('SELECT * FROM channels WHERE id = ?', id);
    return r ? this.toChannel(r) : null;
  }

  /** Active channels where any of `principalIds` is sender or recipient. */
  channelsInvolving(principalIds: string[]): ChannelRow[] {
    if (!principalIds.length) return [];
    const marks = principalIds.map(() => '?').join(',');
    return this.all(
      `SELECT * FROM channels WHERE (sender_id IN (${marks}) OR recipient_id IN (${marks}))
       AND revoked_at IS NULL ORDER BY created_at`,
      ...principalIds,
      ...principalIds,
    ).map((r) => this.toChannel(r));
  }

  updateChannel(
    id: string,
    patch: Partial<{
      scopes: Scope[];
      approval: ApprovalMode;
      includeAgents: boolean;
      expiresAt: string | null;
    }>,
  ): ChannelRow {
    if (patch.scopes)
      this.run('UPDATE channels SET scopes = ? WHERE id = ?', patch.scopes.join(','), id);
    if (patch.approval)
      this.run('UPDATE channels SET approval = ? WHERE id = ?', patch.approval, id);
    if (patch.includeAgents !== undefined) {
      this.run(
        'UPDATE channels SET include_agents = ? WHERE id = ?',
        patch.includeAgents ? 1 : 0,
        id,
      );
    }
    if (patch.expiresAt !== undefined)
      this.run('UPDATE channels SET expires_at = ? WHERE id = ?', patch.expiresAt, id);
    return this.channelById(id)!;
  }

  revokeChannel(id: string): ChannelRow {
    this.run('UPDATE channels SET revoked_at = ? WHERE id = ?', now(), id);
    return this.channelById(id)!;
  }

  private toChannel(r: Row): ChannelRow {
    return {
      id: String(r.id),
      senderId: String(r.sender_id),
      recipientId: String(r.recipient_id),
      sender: this.handleOf(String(r.sender_id)),
      recipient: this.handleOf(String(r.recipient_id)),
      scopes: String(r.scopes).split(',') as Scope[],
      approval: String(r.approval ?? 'auto') as ApprovalMode,
      includeAgents: Boolean(r.include_agents),
      expiresAt: str(r.expires_at),
      grantedBy: r.granted_by == null ? null : this.handleOf(String(r.granted_by)),
      createdAt: String(r.created_at),
      revokedAt: str(r.revoked_at),
    };
  }

  // ---- conversations ----

  createConversation(input: {
    title: string | null;
    createdBy: string;
    directKey?: string | null;
    id?: string;
  }): string {
    const id = input.id ?? newId('cnv');
    const ts = now();
    this.run(
      'INSERT INTO conversations (id, title, direct_key, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      input.title,
      input.directKey ?? null,
      input.createdBy,
      ts,
      ts,
    );
    return id;
  }

  conversationByDirectKey(key: string): string | null {
    return str(this.get<Row>('SELECT id FROM conversations WHERE direct_key = ?', key)?.id);
  }

  conversationRow(id: string): Row | undefined {
    return this.get('SELECT * FROM conversations WHERE id = ?', id);
  }

  getConversation(id: string): Conversation | null {
    const r = this.conversationRow(id);
    if (!r) return null;
    const members = this.all(
      `SELECT m.*, a.handle, a.kind, a.display_name, o.handle AS owner_handle
       FROM conversation_members m JOIN agents a ON a.id = m.principal_id
       LEFT JOIN agents o ON o.id = a.owner_id
       WHERE m.conversation_id = ? ORDER BY m.joined_at, a.handle`,
      id,
    ).map(
      (m): Member => ({
        handle: String(m.handle),
        kind: String(m.kind) as PrincipalKind,
        displayName: str(m.display_name),
        owner: str(m.owner_handle),
        role: String(m.role) as MemberRole,
        state: String(m.state) as MemberState,
        lastReadSeq: Number(m.last_read_seq),
      }),
    );
    return {
      id,
      title: str(r.title),
      direct: r.direct_key != null,
      createdBy: this.handleOf(String(r.created_by)),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      lastSeq: Number(r.last_seq),
      members,
    };
  }

  setConversationTitle(id: string, title: string | null): void {
    this.run('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?', title, now(), id);
  }

  setMember(
    conversationId: string,
    principalId: string,
    role: MemberRole,
    state: MemberState,
    addedBy: string | null,
  ): void {
    this.run(
      `INSERT INTO conversation_members (conversation_id, principal_id, role, state, added_by, joined_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (conversation_id, principal_id) DO UPDATE SET role = excluded.role, state = excluded.state`,
      conversationId,
      principalId,
      role,
      state,
      addedBy,
      now(),
    );
  }

  removeMember(conversationId: string, principalId: string): void {
    this.run(
      'DELETE FROM conversation_members WHERE conversation_id = ? AND principal_id = ?',
      conversationId,
      principalId,
    );
  }

  member(conversationId: string, principalId: string): MemberRow | null {
    const r = this.get(
      'SELECT * FROM conversation_members WHERE conversation_id = ? AND principal_id = ?',
      conversationId,
      principalId,
    );
    return r
      ? {
          principalId,
          addedBy: str(r.added_by),
          role: String(r.role) as MemberRole,
          state: String(r.state) as MemberState,
          lastReadSeq: Number(r.last_read_seq),
        }
      : null;
  }

  members(conversationId: string): MemberRow[] {
    return this.all(
      'SELECT * FROM conversation_members WHERE conversation_id = ?',
      conversationId,
    ).map((r) => ({
      principalId: String(r.principal_id),
      addedBy: str(r.added_by),
      role: String(r.role) as MemberRole,
      state: String(r.state) as MemberState,
      lastReadSeq: Number(r.last_read_seq),
    }));
  }

  conversationIdsFor(principalId: string): string[] {
    return this.all<Row>(
      `SELECT c.id FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id
       WHERE m.principal_id = ? ORDER BY c.updated_at DESC`,
      principalId,
    ).map((r) => String(r.id));
  }

  markRead(conversationId: string, principalId: string, seq: number): void {
    this.run(
      `UPDATE conversation_members SET last_read_seq = MAX(last_read_seq, ?)
       WHERE conversation_id = ? AND principal_id = ?`,
      seq,
      conversationId,
      principalId,
    );
  }

  unreadCount(conversationId: string, principalId: string, lastReadSeq: number): number {
    return Number(
      this.get<Row>(
        "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND seq > ? AND author_id != ? AND kind != 'system'",
        conversationId,
        lastReadSeq,
        principalId,
      )?.n ?? 0,
    );
  }

  // ---- messages ----

  insertMessage(input: {
    conversationId: string;
    authorId: string;
    kind: MessageKind;
    body: string;
    toIds: string[];
    replyTo: string | null;
    taskId: string | null;
  }): Message {
    const id = newId('msg');
    const ts = now();
    const res = this.run(
      `INSERT INTO messages (id, conversation_id, author_id, kind, body, to_ids, reply_to, task_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.conversationId,
      input.authorId,
      input.kind,
      input.body,
      JSON.stringify(input.toIds),
      input.replyTo,
      input.taskId,
      ts,
    );
    this.run(
      'UPDATE conversations SET last_seq = ?, updated_at = ? WHERE id = ?',
      Number(res.lastInsertRowid),
      ts,
      input.conversationId,
    );
    return this.getMessage(id)!;
  }

  getMessage(id: string): Message | null {
    const r = this.get(
      `SELECT m.*, a.handle, a.kind AS author_kind FROM messages m JOIN agents a ON a.id = m.author_id WHERE m.id = ?`,
      id,
    );
    return r ? this.toMessage(r) : null;
  }

  messages(
    conversationId: string,
    opts: { beforeSeq?: number; afterSeq?: number; limit: number },
  ): Message[] {
    const rows = this.all(
      `SELECT m.*, a.handle, a.kind AS author_kind FROM messages m JOIN agents a ON a.id = m.author_id
       WHERE m.conversation_id = ? AND m.seq < ? AND m.seq > ? ORDER BY m.seq DESC LIMIT ?`,
      conversationId,
      opts.beforeSeq ?? Number.MAX_SAFE_INTEGER,
      opts.afterSeq ?? 0,
      opts.limit,
    );
    return rows.reverse().map((r) => this.toMessage(r));
  }

  private toMessage(r: Row): Message {
    const id = String(r.id);
    return {
      id,
      seq: Number(r.seq),
      conversationId: String(r.conversation_id),
      author: String(r.handle),
      authorKind: String(r.author_kind) as PrincipalKind,
      kind: String(r.kind) as MessageKind,
      body: String(r.body),
      to: (JSON.parse(String(r.to_ids)) as string[]).map((pid) => this.handleOf(pid)),
      replyTo: str(r.reply_to),
      taskId: str(r.task_id),
      attachments: this.attachmentsFor(id),
      deliveries: this.deliveriesFor(id),
      createdAt: String(r.created_at),
    };
  }

  private deliveriesFor(messageId: string): Delivery[] {
    return this.all<Row>(
      `SELECT t.id, t.status, a.handle FROM tasks t JOIN agents a ON a.id = t.recipient_id
       WHERE t.request_message_id = ? ORDER BY t.created_at`,
      messageId,
    ).map((r) => ({
      taskId: String(r.id),
      to: String(r.handle),
      status: String(r.status) as TaskStatus,
    }));
  }

  // ---- attachments ----

  insertAttachment(input: {
    conversationId: string;
    messageId: string | null;
    filename: string;
    mediaType: string;
    data: Uint8Array;
    createdBy: string;
    sha256: string;
  }): Attachment {
    const id = newId('fil');
    this.run(
      `INSERT INTO attachments (id, conversation_id, message_id, filename, media_type, size, sha256, data, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.conversationId,
      input.messageId,
      input.filename,
      input.mediaType,
      input.data.byteLength,
      input.sha256,
      input.data,
      input.createdBy,
      now(),
    );
    return {
      id,
      filename: input.filename,
      mediaType: input.mediaType,
      size: input.data.byteLength,
    };
  }

  attachmentsFor(messageId: string): Attachment[] {
    return this.all<Row>(
      'SELECT id, filename, media_type, size FROM attachments WHERE message_id = ? ORDER BY rowid',
      messageId,
    ).map((r) => ({
      id: String(r.id),
      filename: String(r.filename),
      mediaType: String(r.media_type),
      size: Number(r.size),
    }));
  }

  attachment(id: string): (Attachment & { conversationId: string; data: Uint8Array }) | null {
    const r = this.get('SELECT * FROM attachments WHERE id = ?', id);
    return r
      ? {
          id,
          filename: String(r.filename),
          mediaType: String(r.media_type),
          size: Number(r.size),
          conversationId: String(r.conversation_id),
          data: r.data as Uint8Array,
        }
      : null;
  }

  // ---- tasks ----

  createTask(input: {
    senderId: string;
    recipientId: string;
    kind: Scope;
    project: string | null;
    title: string | null;
    body: string;
    contextId: string;
    status: TaskStatus;
    approval: ApprovalMode | 'owner';
    requestMessageId: string | null;
  }): TaskRow {
    const id = newId('tsk');
    const ts = now();
    this.run(
      `INSERT INTO tasks (id, context_id, sender_id, recipient_id, kind, project, title, body, status,
         approval, request_message_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.contextId,
      input.senderId,
      input.recipientId,
      input.kind,
      input.project,
      input.title,
      input.body,
      input.status,
      input.approval,
      input.requestMessageId,
      ts,
      ts,
    );
    return this.taskRow(id)!;
  }

  taskRow(id: string): TaskRow | null {
    const r = this.get('SELECT * FROM tasks WHERE id = ?', id);
    return r ? this.toTask(r) : null;
  }

  getTask(id: string): Task | null {
    const t = this.taskRow(id);
    if (!t) return null;
    const { senderId: _s, recipientId: _r, pendingStatus: _ps, pendingResult: _pr, ...task } = t;
    return task;
  }

  listTasks(
    principalId: string,
    box: 'inbox' | 'outbox',
    statuses: TaskStatus[] | null,
    limit: number,
  ): Task[] {
    const col = box === 'inbox' ? 'recipient_id' : 'sender_id';
    const filter = statuses?.length ? `AND status IN (${statuses.map(() => '?').join(',')})` : '';
    return this.all<Row>(
      `SELECT id FROM tasks WHERE ${col} = ? ${filter} ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      principalId,
      ...(statuses ?? []),
      limit,
    ).map((r) => this.getTask(String(r.id))!);
  }

  /** Tasks `senderId` sent to `recipientId`, newest first, for the A2A `ListTasks` view. */
  listTasksBetween(
    senderId: string,
    recipientId: string,
    filter: { contextId?: string; status?: TaskStatus; updatedAfter?: string },
    limit: number,
    offset: number,
  ): { tasks: Task[]; total: number } {
    const where = ['sender_id = ?', 'recipient_id = ?'];
    const args: Value[] = [senderId, recipientId];
    const add = (clause: string, value: string | undefined) => {
      if (value === undefined) return;
      where.push(clause);
      args.push(value);
    };
    add('context_id = ?', filter.contextId);
    add('status = ?', filter.status);
    add('updated_at >= ?', filter.updatedAfter);
    const sql = `FROM tasks WHERE ${where.join(' AND ')}`;
    const total = Number(this.get<Row>(`SELECT COUNT(*) AS n ${sql}`, ...args)?.n ?? 0);
    const tasks = this.all<Row>(
      `SELECT id ${sql} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`,
      ...args,
      limit,
      offset,
    ).map((r) => this.getTask(String(r.id))!);
    return { tasks, total };
  }

  /** The newest task in a conversation from `senderId` to `recipientId` in one of `statuses`. */
  openTaskIn(conversationId: string, recipientId: string, statuses: TaskStatus[]): TaskRow | null {
    const r = this.get<Row>(
      `SELECT id FROM tasks WHERE context_id = ? AND recipient_id = ?
       AND status IN (${statuses.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT 1`,
      conversationId,
      recipientId,
      ...statuses,
    );
    return r ? this.taskRow(String(r.id)) : null;
  }

  setTaskStatus(id: string, status: TaskStatus, result: string | null): TaskRow {
    this.run(
      `UPDATE tasks SET status = ?, result = COALESCE(?, result), pending_status = NULL,
         pending_result = NULL, updated_at = ? WHERE id = ?`,
      status,
      result,
      now(),
      id,
    );
    return this.taskRow(id)!;
  }

  /** Holds an agent's outcome for owner review. */
  holdTaskOutcome(id: string, proposed: TaskStatus, result: string | null): TaskRow {
    this.run(
      "UPDATE tasks SET status = 'reviewing', pending_status = ?, pending_result = ?, updated_at = ? WHERE id = ?",
      proposed,
      result,
      now(),
      id,
    );
    return this.taskRow(id)!;
  }

  setTaskBody(id: string, body: string): void {
    this.run('UPDATE tasks SET body = ?, updated_at = ? WHERE id = ?', body, now(), id);
  }

  addTaskMessage(taskId: string, authorId: string, body: string): TaskMessage {
    const msg: TaskMessage = {
      id: newId('tmg'),
      taskId,
      author: this.handleOf(authorId),
      body,
      createdAt: now(),
    };
    this.run(
      'INSERT INTO task_messages (id, task_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
      msg.id,
      taskId,
      authorId,
      body,
      msg.createdAt,
    );
    return msg;
  }

  taskMessages(taskId: string): TaskMessage[] {
    return this.all<Row>(
      `SELECT m.*, a.handle FROM task_messages m JOIN agents a ON a.id = m.author_id
       WHERE task_id = ? ORDER BY m.created_at, m.rowid`,
      taskId,
    ).map((r) => ({
      id: String(r.id),
      taskId: String(r.task_id),
      author: String(r.handle),
      body: String(r.body),
      createdAt: String(r.created_at),
    }));
  }

  private toTask(r: Row): TaskRow {
    return {
      id: String(r.id),
      contextId: String(r.context_id ?? `ctx_${String(r.id)}`),
      senderId: String(r.sender_id),
      recipientId: String(r.recipient_id),
      from: this.handleOf(String(r.sender_id)),
      to: this.handleOf(String(r.recipient_id)),
      kind: String(r.kind) as Scope,
      project: str(r.project),
      title: str(r.title),
      body: String(r.body),
      status: String(r.status) as TaskStatus,
      result: str(r.result),
      approval: String(r.approval ?? 'auto') as ApprovalMode,
      requestMessageId: str(r.request_message_id),
      pendingStatus: str(r.pending_status) as TaskStatus | null,
      pendingResult: str(r.pending_result),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  // ---- approvals ----

  createApproval(input: {
    kind: ApprovalKind;
    taskId: string;
    conversationId: string;
    agentId: string;
    ownerId: string;
    requesterId: string;
    body: string;
    proposedStatus: TaskStatus | null;
  }): ApprovalRow {
    const id = newId('apr');
    this.run(
      `INSERT INTO approvals (id, kind, status, task_id, conversation_id, agent_id, owner_id, requester_id, body,
         proposed_status, created_at)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.kind,
      input.taskId,
      input.conversationId,
      input.agentId,
      input.ownerId,
      input.requesterId,
      input.body,
      input.proposedStatus,
      now(),
    );
    return this.approval(id)!;
  }

  approval(id: string): ApprovalRow | null {
    const r = this.get('SELECT * FROM approvals WHERE id = ?', id);
    return r ? this.toApproval(r) : null;
  }

  approvalsForOwner(ownerId: string, status: ApprovalStatus | null, limit = 100): ApprovalRow[] {
    return this.all(
      `SELECT * FROM approvals WHERE owner_id = ? ${status ? 'AND status = ?' : ''}
       ORDER BY created_at DESC LIMIT ?`,
      ...(status ? [ownerId, status, limit] : [ownerId, limit]),
    ).map((r) => this.toApproval(r));
  }

  pendingApprovalForTask(taskId: string): ApprovalRow | null {
    const r = this.get("SELECT * FROM approvals WHERE task_id = ? AND status = 'pending'", taskId);
    return r ? this.toApproval(r) : null;
  }

  latestApproval(taskId: string, kind: ApprovalKind): ApprovalRow | null {
    const r = this.get(
      'SELECT * FROM approvals WHERE task_id = ? AND kind = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
      taskId,
      kind,
    );
    return r ? this.toApproval(r) : null;
  }

  decideApproval(
    id: string,
    status: ApprovalStatus,
    decidedBy: string,
    note: string | null,
    body?: string,
  ): ApprovalRow {
    this.run(
      'UPDATE approvals SET status = ?, decided_by = ?, decided_at = ?, note = ?, body = COALESCE(?, body) WHERE id = ?',
      status,
      decidedBy,
      now(),
      note,
      body ?? null,
      id,
    );
    return this.approval(id)!;
  }

  private toApproval(r: Row): ApprovalRow {
    return {
      id: String(r.id),
      kind: String(r.kind) as ApprovalKind,
      status: String(r.status) as ApprovalStatus,
      taskId: String(r.task_id),
      conversationId: String(r.conversation_id),
      agentId: String(r.agent_id),
      ownerId: String(r.owner_id),
      requesterId: String(r.requester_id),
      agent: this.handleOf(String(r.agent_id)),
      requester: this.handleOf(String(r.requester_id)),
      body: String(r.body),
      proposedStatus: str(r.proposed_status) as TaskStatus | null,
      note: str(r.note),
      decidedBy: r.decided_by == null ? null : this.handleOf(String(r.decided_by)),
      createdAt: String(r.created_at),
      decidedAt: str(r.decided_at),
    };
  }

  // ---- A2A push notification configs ----

  createPushConfig(input: Omit<PushConfigRow, 'id'> & { id?: string }): PushConfigRow {
    const id = input.id || newId('psh');
    this.run(
      `INSERT INTO push_configs (id, task_id, principal_id, url, token, auth_scheme, auth_credentials, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.taskId,
      input.principalId,
      input.url,
      input.token,
      input.authScheme,
      input.authCredentials,
      now(),
    );
    return this.pushConfig(id)!;
  }

  pushConfig(id: string): PushConfigRow | null {
    const r = this.get('SELECT * FROM push_configs WHERE id = ?', id);
    return r ? toPushConfig(r) : null;
  }

  pushConfigsForTask(taskId: string): PushConfigRow[] {
    return this.all('SELECT * FROM push_configs WHERE task_id = ? ORDER BY created_at', taskId).map(
      toPushConfig,
    );
  }

  deletePushConfig(id: string): void {
    this.run('DELETE FROM push_configs WHERE id = ?', id);
  }

  // ---- Telegram ----

  createTelegramLink(codeHash: string, principalId: string, ttlSeconds: number): void {
    this.run(
      'INSERT INTO telegram_links (code_hash, principal_id, expires_at) VALUES (?, ?, ?)',
      codeHash,
      principalId,
      new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    );
  }

  consumeTelegramLink(codeHash: string): string | null {
    const r = this.get<Row>(
      'SELECT * FROM telegram_links WHERE code_hash = ? AND expires_at > ?',
      codeHash,
      now(),
    );
    this.run('DELETE FROM telegram_links WHERE code_hash = ?', codeHash);
    return r ? String(r.principal_id) : null;
  }

  mapTelegramMessage(
    chatId: string,
    messageId: number,
    ref: { conversationId?: string; approvalId?: string },
  ): void {
    this.run(
      `INSERT OR REPLACE INTO telegram_messages (chat_id, message_id, conversation_id, approval_id) VALUES (?, ?, ?, ?)`,
      chatId,
      messageId,
      ref.conversationId ?? null,
      ref.approvalId ?? null,
    );
  }

  telegramMessagesForApproval(approvalId: string): { chatId: string; messageId: number }[] {
    return this.all<Row>(
      'SELECT chat_id, message_id FROM telegram_messages WHERE approval_id = ?',
      approvalId,
    ).map((r) => ({
      chatId: String(r.chat_id),
      messageId: Number(r.message_id),
    }));
  }

  telegramPrefs(principalId: string): { chatId: string | null; notify: 'all' | 'approvals' } {
    const r = this.get<Row>(
      'SELECT telegram_chat_id, telegram_notify FROM agents WHERE id = ?',
      principalId,
    );
    return {
      chatId: str(r?.telegram_chat_id),
      notify: r?.telegram_notify === 'approvals' ? 'approvals' : 'all',
    };
  }

  setTelegramNotify(principalId: string, notify: 'all' | 'approvals'): void {
    this.run('UPDATE agents SET telegram_notify = ? WHERE id = ?', notify, principalId);
  }

  telegramMessage(
    chatId: string,
    messageId: number,
  ): { conversationId: string | null; approvalId: string | null } | null {
    const r = this.get(
      'SELECT * FROM telegram_messages WHERE chat_id = ? AND message_id = ?',
      chatId,
      messageId,
    );
    return r ? { conversationId: str(r.conversation_id), approvalId: str(r.approval_id) } : null;
  }

  // ---- events ----

  /** Notified after each event is committed; the hub wires this to live streams. */
  onEvent: ((principalId: string, event: GatewayEvent) => void) | null = null;
  private pending: [string, GatewayEvent][] = [];

  /**
   * Records an event for each principal. The per-principal log drives live streams, lets
   * clients resume with Last-Event-ID, and doubles as the audit trail.
   */
  emit(
    principalIds: Iterable<string>,
    type: GatewayEventType,
    taskId: string | null,
    data: unknown,
  ): void {
    const createdAt = now();
    const json = JSON.stringify(data);
    for (const pid of new Set(principalIds)) {
      const res = this.run(
        'INSERT INTO events (agent_id, type, task_id, data, created_at) VALUES (?, ?, ?, ?, ?)',
        pid,
        type,
        taskId,
        json,
        createdAt,
      );
      this.pending.push([pid, { seq: Number(res.lastInsertRowid), type, taskId, data, createdAt }]);
    }
    if (this.depth === 0) this.flush();
  }

  /** Delivers queued events once their transaction has committed. */
  private flush(): void {
    const batch = this.pending;
    this.pending = [];
    if (batch.length) queueMicrotask(() => batch.forEach(([pid, e]) => this.onEvent?.(pid, e)));
  }

  eventsSince(principalId: string, seq: number, limit = 500): GatewayEvent[] {
    return this.all(
      'SELECT * FROM events WHERE agent_id = ? AND seq > ? ORDER BY seq LIMIT ?',
      principalId,
      seq,
      limit,
    ).map((r) => ({
      seq: Number(r.seq),
      type: String(r.type) as GatewayEventType,
      taskId: str(r.task_id),
      data: JSON.parse(String(r.data)),
      createdAt: String(r.created_at),
    }));
  }

  latestEventSeq(principalId: string): number {
    return Number(
      this.get<Row>('SELECT MAX(seq) AS seq FROM events WHERE agent_id = ?', principalId)?.seq ?? 0,
    );
  }
}

function toPrincipalRow(r: Row): PrincipalRow {
  return {
    id: String(r.id),
    kind: String(r.kind ?? 'agent') as PrincipalKind,
    handle: String(r.handle),
    displayName: str(r.display_name),
    description: str(r.description),
    owner: str(r.owner_handle),
    ownerId: str(r.owner_id),
    discoverable: Boolean(r.discoverable),
    paused: Boolean(r.paused),
    createdAt: String(r.created_at),
    tokenHash: String(r.token_hash),
    passwordHash: str(r.password_hash),
    telegramChatId: str(r.telegram_chat_id),
  };
}

function strip(r: PrincipalRow | null): Principal | null {
  if (!r) return null;
  const { tokenHash: _t, passwordHash: _p, telegramChatId: _c, ...p } = r;
  return p;
}

function toPushConfig(r: Row): PushConfigRow {
  return {
    id: String(r.id),
    taskId: String(r.task_id),
    principalId: String(r.principal_id),
    url: String(r.url),
    token: str(r.token),
    authScheme: str(r.auth_scheme),
    authCredentials: str(r.auth_credentials),
  };
}
