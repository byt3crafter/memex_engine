import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { newId, sha256 } from './auth.js';
import type {
  Agent,
  Channel,
  GatewayEvent,
  GatewayEventType,
  Scope,
  Task,
  TaskMessage,
  TaskStatus,
} from './types.js';

type Row = Record<string, unknown>;

const SCHEMA = `
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
-- Per-agent event log: drives the live stream, lets runners resume with Last-Event-ID,
-- and doubles as the audit trail.
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

const now = () => new Date().toISOString();

export class Store {
  readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---- agents ----

  createAgent(handle: string, tokenHash: string, description: string | null): Agent {
    const agent: Agent = { id: newId('agt'), handle, description, createdAt: now() };
    this.db
      .prepare(
        'INSERT INTO agents (id, handle, description, token_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(agent.id, handle, description, tokenHash, agent.createdAt);
    return agent;
  }

  agentByTokenHash(tokenHash: string): Agent | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE token_hash = ?').get(tokenHash) as
      | Row
      | undefined;
    return row ? toAgent(row) : null;
  }

  agentByHandle(handle: string): Agent | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE handle = ?').get(handle) as
      | Row
      | undefined;
    return row ? toAgent(row) : null;
  }

  private handleOf(id: string): string {
    const row = this.db.prepare('SELECT handle FROM agents WHERE id = ?').get(id) as
      | Row
      | undefined;
    return String(row?.handle ?? id);
  }

  // ---- invites & channels ----

  createInvite(
    code: string,
    issuerId: string,
    scopes: Scope[],
    mutual: boolean,
    ttlSeconds: number,
    maxUses: number,
  ) {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    this.db
      .prepare(
        'INSERT INTO invites (code_hash, issuer_id, scopes, mutual, max_uses, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(sha256(code), issuerId, scopes.join(','), mutual ? 1 : 0, maxUses, expiresAt, now());
    return { code, scopes, mutual, maxUses, expiresAt };
  }

  /**
   * Redeeming an invite opens a channel redeemer → issuer (the redeemer may now send to the issuer).
   * A mutual invite also opens issuer → redeemer with the same scopes.
   */
  redeemInvite(code: string, redeemerId: string): { channels: Channel[] } | { error: string } {
    return this.tx(() => {
      const row = this.db.prepare('SELECT * FROM invites WHERE code_hash = ?').get(sha256(code)) as
        | Row
        | undefined;
      if (!row) return { error: 'invalid_code' };
      if (String(row.expires_at) < now()) return { error: 'code_expired' };
      if (Number(row.uses) >= Number(row.max_uses)) return { error: 'code_used' };
      const issuerId = String(row.issuer_id);
      if (issuerId === redeemerId) return { error: 'cannot_redeem_own_code' };

      this.db.prepare('UPDATE invites SET uses = uses + 1 WHERE code_hash = ?').run(sha256(code));
      const scopes = String(row.scopes).split(',') as Scope[];
      const channels = [this.upsertChannel(redeemerId, issuerId, scopes)];
      if (Number(row.mutual)) channels.push(this.upsertChannel(issuerId, redeemerId, scopes));
      for (const ch of channels) {
        this.addEvent(issuerId, 'channel.created', null, ch);
        this.addEvent(redeemerId, 'channel.created', null, ch);
      }
      return { channels };
    });
  }

  private upsertChannel(senderId: string, recipientId: string, scopes: Scope[]): Channel {
    this.db
      .prepare(
        `INSERT INTO channels (id, sender_id, recipient_id, scopes, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (sender_id, recipient_id) DO UPDATE SET scopes = excluded.scopes, revoked_at = NULL`,
      )
      .run(newId('chn'), senderId, recipientId, scopes.join(','), now());
    return this.channelBetween(senderId, recipientId)!;
  }

  channelBetween(senderId: string, recipientId: string): Channel | null {
    const row = this.db
      .prepare('SELECT * FROM channels WHERE sender_id = ? AND recipient_id = ?')
      .get(senderId, recipientId) as Row | undefined;
    return row ? this.toChannel(row) : null;
  }

  channelsFor(agentId: string): Channel[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM channels WHERE (sender_id = ? OR recipient_id = ?) AND revoked_at IS NULL ORDER BY created_at',
      )
      .all(agentId, agentId) as Row[];
    return rows.map((r) => this.toChannel(r));
  }

  /** Either end of a channel may revoke it. */
  revokeChannel(channelId: string, agentId: string): Channel | null {
    const row = this.db
      .prepare('SELECT * FROM channels WHERE id = ? AND (sender_id = ? OR recipient_id = ?)')
      .get(channelId, agentId, agentId) as Row | undefined;
    if (!row) return null;
    this.db.prepare('UPDATE channels SET revoked_at = ? WHERE id = ?').run(now(), channelId);
    const ch = this.toChannel({ ...row, revoked_at: now() });
    this.addEvent(String(row.sender_id), 'channel.revoked', null, ch);
    this.addEvent(String(row.recipient_id), 'channel.revoked', null, ch);
    return ch;
  }

  // ---- tasks ----

  createTask(input: {
    senderId: string;
    recipientId: string;
    kind: Scope;
    project: string | null;
    title: string | null;
    body: string;
  }): Task {
    return this.tx(() => {
      const id = newId('tsk');
      const ts = now();
      this.db
        .prepare(
          `INSERT INTO tasks (id, sender_id, recipient_id, kind, project, title, body, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)`,
        )
        .run(
          id,
          input.senderId,
          input.recipientId,
          input.kind,
          input.project,
          input.title,
          input.body,
          ts,
          ts,
        );
      const task = this.getTask(id)!;
      this.addEvent(input.recipientId, 'task.created', id, task);
      this.addEvent(input.senderId, 'task.created', id, task);
      return task;
    });
  }

  getTask(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined;
    return row ? this.toTask(row) : null;
  }

  /** Raw participant ids, for authorization checks. */
  taskParties(id: string): { senderId: string; recipientId: string } | null {
    const row = this.db
      .prepare('SELECT sender_id, recipient_id FROM tasks WHERE id = ?')
      .get(id) as Row | undefined;
    return row ? { senderId: String(row.sender_id), recipientId: String(row.recipient_id) } : null;
  }

  listTasks(
    agentId: string,
    box: 'inbox' | 'outbox',
    statuses: TaskStatus[] | null,
    limit: number,
  ): Task[] {
    const col = box === 'inbox' ? 'recipient_id' : 'sender_id';
    const filter = statuses?.length ? `AND status IN (${statuses.map(() => '?').join(',')})` : '';
    const rows = this.db
      .prepare(`SELECT * FROM tasks WHERE ${col} = ? ${filter} ORDER BY created_at DESC LIMIT ?`)
      .all(agentId, ...(statuses ?? []), limit) as Row[];
    return rows.map((r) => this.toTask(r));
  }

  updateTaskStatus(id: string, status: TaskStatus, result: string | null): Task {
    return this.tx(() => {
      this.db
        .prepare(
          'UPDATE tasks SET status = ?, result = COALESCE(?, result), updated_at = ? WHERE id = ?',
        )
        .run(status, result, now(), id);
      const task = this.getTask(id)!;
      const parties = this.taskParties(id)!;
      this.addEvent(parties.recipientId, 'task.updated', id, task);
      this.addEvent(parties.senderId, 'task.updated', id, task);
      return task;
    });
  }

  addTaskMessage(taskId: string, authorId: string, body: string): TaskMessage {
    return this.tx(() => {
      const msg: TaskMessage = {
        id: newId('msg'),
        taskId,
        author: this.handleOf(authorId),
        body,
        createdAt: now(),
      };
      this.db
        .prepare(
          'INSERT INTO task_messages (id, task_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(msg.id, taskId, authorId, body, msg.createdAt);
      const parties = this.taskParties(taskId)!;
      this.addEvent(parties.recipientId, 'task.message', taskId, msg);
      this.addEvent(parties.senderId, 'task.message', taskId, msg);
      return msg;
    });
  }

  taskMessages(taskId: string): TaskMessage[] {
    const rows = this.db
      .prepare(
        `SELECT m.*, a.handle FROM task_messages m JOIN agents a ON a.id = m.author_id
         WHERE task_id = ? ORDER BY m.created_at, m.rowid`,
      )
      .all(taskId) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      taskId: String(r.task_id),
      author: String(r.handle),
      body: String(r.body),
      createdAt: String(r.created_at),
    }));
  }

  // ---- events ----

  /** Listeners are notified after an event is written; the server wires these to live streams. */
  onEvent: ((agentId: string, event: GatewayEvent) => void) | null = null;

  private addEvent(
    agentId: string,
    type: GatewayEventType,
    taskId: string | null,
    data: unknown,
  ): void {
    const createdAt = now();
    const res = this.db
      .prepare(
        'INSERT INTO events (agent_id, type, task_id, data, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(agentId, type, taskId, JSON.stringify(data), createdAt);
    const event: GatewayEvent = { seq: Number(res.lastInsertRowid), type, taskId, data, createdAt };
    // Defer so listeners never observe an uncommitted transaction.
    queueMicrotask(() => this.onEvent?.(agentId, event));
  }

  eventsSince(agentId: string, seq: number, limit = 500): GatewayEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE agent_id = ? AND seq > ? ORDER BY seq LIMIT ?')
      .all(agentId, seq, limit) as Row[];
    return rows.map((r) => ({
      seq: Number(r.seq),
      type: String(r.type) as GatewayEventType,
      taskId: r.task_id == null ? null : String(r.task_id),
      data: JSON.parse(String(r.data)),
      createdAt: String(r.created_at),
    }));
  }

  latestEventSeq(agentId: string): number {
    const row = this.db
      .prepare('SELECT MAX(seq) AS seq FROM events WHERE agent_id = ?')
      .get(agentId) as Row;
    return Number(row.seq ?? 0);
  }

  // ---- row mapping ----

  private toChannel(r: Row): Channel {
    return {
      id: String(r.id),
      sender: this.handleOf(String(r.sender_id)),
      recipient: this.handleOf(String(r.recipient_id)),
      scopes: String(r.scopes).split(',') as Scope[],
      createdAt: String(r.created_at),
      revokedAt: r.revoked_at == null ? null : String(r.revoked_at),
    };
  }

  private toTask(r: Row): Task {
    return {
      id: String(r.id),
      from: this.handleOf(String(r.sender_id)),
      to: this.handleOf(String(r.recipient_id)),
      kind: String(r.kind) as Scope,
      project: r.project == null ? null : String(r.project),
      title: r.title == null ? null : String(r.title),
      body: String(r.body),
      status: String(r.status) as TaskStatus,
      result: r.result == null ? null : String(r.result),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }
}

function toAgent(r: Row): Agent {
  return {
    id: String(r.id),
    handle: String(r.handle),
    description: r.description == null ? null : String(r.description),
    createdAt: String(r.created_at),
  };
}
