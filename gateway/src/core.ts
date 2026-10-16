import { sha256 } from './auth.js';
import type { Store } from './store.js';
import { TERMINAL_STATUSES } from './types.js';
import type { Agent, GatewayEvent, Scope, Task, TaskMessage } from './types.js';

// Rules shared by every way into the gateway (REST API, A2A endpoint), so permissions
// can't differ between them.

/** Fans store events out to live listeners (event streams, A2A streams, blocking calls). */
export class Hub {
  private listeners = new Map<string, Set<(e: GatewayEvent) => void>>();

  constructor(store: Store) {
    store.onEvent = (agentId, event) => this.listeners.get(agentId)?.forEach((fn) => fn(event));
  }

  subscribe(agentId: string, fn: (e: GatewayEvent) => void): () => void {
    let set = this.listeners.get(agentId);
    if (!set) this.listeners.set(agentId, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (!set.size) this.listeners.delete(agentId);
    };
  }

  /**
   * Resolves with the task once `done(task)` holds, or with its latest state after
   * `timeoutMs` or when `signal` aborts.
   */
  waitForTask(
    store: Store,
    agentId: string,
    taskId: string,
    done: (t: Task) => boolean,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Task> {
    return new Promise((resolve) => {
      const finish = () => {
        unsubscribe();
        clearTimeout(timer);
        signal?.removeEventListener('abort', finish);
        resolve(store.getTask(taskId)!);
      };
      const unsubscribe = this.subscribe(agentId, (e) => {
        if (e.taskId === taskId && done(store.getTask(taskId)!)) finish();
      });
      const timer = setTimeout(finish, timeoutMs);
      signal?.addEventListener('abort', finish);
      if (done(store.getTask(taskId)!)) finish();
    });
  }
}

export function authenticate(store: Store, authorization: string | undefined): Agent | null {
  const header = authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return token ? store.agentByTokenHash(sha256(token)) : null;
}

export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(private readonly perMinute: number) {}

  allow(key: string): boolean {
    const t = Date.now();
    const w = this.windows.get(key);
    if (!w || t - w.start > 60_000) {
      this.windows.set(key, { start: t, count: 1 });
      return true;
    }
    return ++w.count <= this.perMinute;
  }
}

export type OpenTaskResult =
  | { task: Task }
  | { error: 'no_channel' }
  | { error: 'scope_not_allowed'; allowed: Scope[] };

/** Create a task from `sender` to `recipient`, if a live channel with the right scope exists. */
export function openTask(
  store: Store,
  sender: Agent,
  recipient: Agent | null,
  input: {
    kind: Scope;
    project: string | null;
    title: string | null;
    body: string;
    contextId?: string | null;
  },
): OpenTaskResult {
  const ch = recipient ? store.channelBetween(sender.id, recipient.id) : null;
  // Same error for "no such agent" and "no channel".
  if (!recipient || !ch || ch.revokedAt) return { error: 'no_channel' };
  if (!ch.scopes.includes(input.kind)) return { error: 'scope_not_allowed', allowed: ch.scopes };
  return {
    task: store.createTask({ senderId: sender.id, recipientId: recipient.id, ...input }),
  };
}

/** Add to a task's thread. The sender answering `input_required` resubmits the task. */
export function postMessage(
  store: Store,
  task: Task,
  author: Agent,
  isSender: boolean,
  body: string,
): { message: TaskMessage; task: Task } | { error: 'task_closed' } {
  if (TERMINAL_STATUSES.includes(task.status)) return { error: 'task_closed' };
  const message = store.addTaskMessage(task.id, author.id, body);
  const updated =
    isSender && task.status === 'input_required'
      ? store.updateTaskStatus(task.id, 'submitted', null)
      : task;
  return { message, task: updated };
}
