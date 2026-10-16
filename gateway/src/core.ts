import type { Store } from './store.js';
import type { GatewayEvent, Task } from './types.js';

/** Fans store events out to live listeners (event streams, A2A streams, blocking calls). */
export class Hub {
  private listeners = new Map<string, Set<(e: GatewayEvent) => void>>();

  constructor(private readonly store: Store) {
    store.onEvent = (principalId, event) => this.listeners.get(principalId)?.forEach((fn) => fn(event));
  }

  subscribe(principalId: string, fn: (e: GatewayEvent) => void): () => void {
    let set = this.listeners.get(principalId);
    if (!set) this.listeners.set(principalId, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (!set.size) this.listeners.delete(principalId);
    };
  }

  /**
   * Resolves with the task once `done(task)` holds, when `signal` aborts, or after
   * `timeoutMs` (no limit when omitted).
   */
  waitForTask(
    principalId: string,
    taskId: string,
    done: (t: Task) => boolean,
    opts: { timeoutMs?: number | undefined; signal?: AbortSignal | undefined } = {},
  ): Promise<Task> {
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const finish = () => {
        unsubscribe();
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener('abort', finish);
        resolve(this.store.getTask(taskId)!);
      };
      const unsubscribe = this.subscribe(principalId, (e) => {
        if (e.taskId === taskId && done(this.store.getTask(taskId)!)) finish();
      });
      if (opts.timeoutMs) timer = setTimeout(finish, opts.timeoutMs);
      opts.signal?.addEventListener('abort', finish);
      if (opts.signal?.aborted || done(this.store.getTask(taskId)!)) finish();
    });
  }
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
