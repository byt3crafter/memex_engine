import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getRequestListener } from '@hono/node-server';
import { createRestBinding, startGrpcBinding } from './a2a-sdk.js';
import { createApp } from './server.js';
import type { ServerOptions } from './server.js';
import type { Store } from './store.js';

export interface ListenOptions extends ServerOptions {
  port: number;
  host: string;
  /** Serve the A2A HTTP+JSON binding at /a2a-rest. Default true. */
  rest?: boolean;
  /** Port for the A2A gRPC binding; omit or null to disable. 0 picks a free port. */
  grpcPort?: number | null;
  grpcTlsCertFile?: string | undefined;
  grpcTlsKeyFile?: string | undefined;
}

/** Runs the gateway: REST API, web app, A2A over JSON-RPC, HTTP+JSON and (optionally) gRPC. */
export async function startServer(store: Store, opts: ListenOptions) {
  const app = createApp(store, opts);
  const hono = getRequestListener(app.fetch);
  const rest = opts.rest === false ? null : createRestBinding(app.a2a);

  const server = createServer((req, res) => {
    if (rest && req.url?.startsWith('/a2a-rest')) rest(req, res);
    else void hono(req, res);
  });
  const port = await new Promise<number>((resolve) =>
    server.listen(opts.port, opts.host, () => resolve((server.address() as AddressInfo).port)),
  );
  const url = `http://${opts.host.includes(':') ? `[${opts.host}]` : opts.host}:${port}`;
  app.a2a.bindings.rest = Boolean(rest);

  let grpc: Awaited<ReturnType<typeof startGrpcBinding>> | null = null;
  if (opts.grpcPort !== undefined && opts.grpcPort !== null) {
    grpc = await startGrpcBinding(app.a2a, {
      port: opts.grpcPort,
      host: opts.host,
      tlsCertFile: opts.grpcTlsCertFile,
      tlsKeyFile: opts.grpcTlsKeyFile,
    });
    const publicHost = opts.publicUrl ? new URL(opts.publicUrl).hostname : opts.host;
    app.a2a.bindings.grpcAddress = `${publicHost}:${grpc.port}`;
  }

  return {
    app,
    gateway: app.gateway,
    url,
    port,
    grpcPort: grpc?.port ?? null,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await grpc?.close();
    },
  };
}
