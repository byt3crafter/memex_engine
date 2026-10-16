import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { GatewayClient } from '../src/client.js';
import type { ServerOptions } from '../src/server.js';
import { createApp } from '../src/server.js';
import { Store } from '../src/store.js';

export async function startGateway(opts: ServerOptions = {}) {
  const store = new Store(':memory:');
  const app = createApp(store, {
    heartbeatSeconds: 1,
    allowPrivateWebhooks: true,
    signInAttemptsPerMinute: 10_000,
    ...opts,
  });
  const url = await new Promise<string>((resolve) => {
    const server = serve(
      { fetch: app.fetch, port: 0, hostname: '127.0.0.1' },
      (info: AddressInfo) => resolve(`http://127.0.0.1:${info.port}`),
    );
    closers.push(() => server.close());
  });
  let n = 0;
  return {
    url,
    app,
    store,
    async person(name: string) {
      const handle = `${name}-${++n}`;
      const { token, person } = await new GatewayClient(url).signUp(
        handle,
        'correct horse battery',
        name,
      );
      return { client: new GatewayClient(url, token), handle, token, person };
    },
    async agent(name: string, owner?: { client: GatewayClient }) {
      const handle = `${name}-${++n}`;
      const { token, agent } = await (owner?.client ?? new GatewayClient(url)).register(
        handle,
        `${name} agent`,
      );
      return {
        client: new GatewayClient(url, token),
        handle,
        token,
        agent,
        a2a: `${url}/a2a/${handle}`,
      };
    },
  };
}

const closers: (() => void)[] = [];
export const stopAll = () => closers.splice(0).forEach((c) => c());

export type TestGateway = Awaited<ReturnType<typeof startGateway>>;

export const errorCode = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string }) => e.code ?? String(e),
  );

export async function eventually<T>(
  fn: () => Promise<T | undefined | null | false>,
  what = 'condition',
): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`timed out waiting for ${what}`);
}
