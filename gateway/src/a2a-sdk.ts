import { readFileSync } from 'node:fs';
import {
  CancelTaskRequest,
  DeleteTaskPushNotificationConfigRequest,
  GetTaskPushNotificationConfigRequest,
  GetTaskRequest,
  ListTaskPushNotificationConfigsRequest,
  ListTaskPushNotificationConfigsResponse,
  ListTasksRequest,
  ListTasksResponse,
  SendMessageRequest,
  StreamResponse,
  SubscribeToTaskRequest,
  Task,
  TaskPushNotificationConfig,
} from '@a2a-js/sdk';
import { AgentCard as AgentCardCodec } from '@a2a-js/sdk';
import type { AgentCard } from '@a2a-js/sdk';
import {
  ExtendedAgentCardNotConfiguredError,
  PushNotificationNotSupportedError,
  RequestMalformedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
  VersionNotSupportedError,
} from '@a2a-js/sdk/errors';
import type { A2ARequestHandler, ServerCallContext, User } from '@a2a-js/sdk/server';
import { restHandler } from '@a2a-js/sdk/server/express';
import { A2AService as GrpcServiceDefinition, grpcService } from '@a2a-js/sdk/server/grpc';
import * as grpc from '@grpc/grpc-js';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { A2A_ERRORS, A2AFault } from './a2a.js';
import type { A2AService } from './a2a.js';
import type { Principal } from './types.js';

/**
 * The HTTP+JSON and gRPC bindings of A2A, served through the official SDK's transport
 * adapters on top of the same {@link A2AService} as the JSON-RPC binding. One endpoint
 * serves every agent: the agent is the A2A `tenant` (its handle), which SDK clients take
 * from the agent card automatically.
 */

class GatewayUser implements User {
  constructor(readonly principal: Principal) {}
  get isAuthenticated() {
    return true;
  }
  get userName() {
    return this.principal.handle;
  }
}

const unauthenticated: User = { isAuthenticated: false, userName: '' };

function sdkError(err: unknown): Error {
  if (!(err instanceof A2AFault)) return err as Error;
  const message = err.message;
  switch (err.code) {
    case A2A_ERRORS.taskNotFound:
      return new TaskNotFoundError(message);
    case A2A_ERRORS.taskNotCancelable:
      return new TaskNotCancelableError(message);
    case A2A_ERRORS.pushNotSupported:
      return new PushNotificationNotSupportedError(message);
    case A2A_ERRORS.unsupportedOperation:
      return new UnsupportedOperationError(message);
    case A2A_ERRORS.extendedCardNotConfigured:
      return new ExtendedAgentCardNotConfiguredError(message);
    case A2A_ERRORS.versionNotSupported:
      return new VersionNotSupportedError(message);
    default:
      return new RequestMalformedError(message);
  }
}

/** Implements the SDK's request handler by converting to wire JSON and calling A2AService. */
export class GatewayRequestHandler implements A2ARequestHandler {
  constructor(private readonly svc: A2AService) {}

  private who(params: { tenant?: string }, ctx: ServerCallContext) {
    const user = ctx.user;
    if (!(user instanceof GatewayUser)) throw new RequestMalformedError('Unauthorized: gateway bearer token required');
    try {
      return { caller: user.principal, target: this.svc.agent(params.tenant || ctx.tenant) };
    } catch (err) {
      throw sdkError(err);
    }
  }

  private call<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      throw sdkError(err);
    }
  }

  /**
   * The SDK reads this on every call to check capabilities, without saying which agent, so
   * it gets a gateway-wide card. Per-agent cards are at /a2a/{handle}/.well-known/agent-card.json.
   */
  async getAgentCard(): Promise<AgentCard> {
    const generic = this.svc.card(
      {
        id: '',
        kind: 'agent',
        handle: 'agent-gateway',
        displayName: null,
        description: 'Agent Gateway: set the tenant to the agent\u2019s handle.',
        owner: null,
        ownerId: null,
        discoverable: true,
        paused: false,
        createdAt: '',
      },
      (this.svc.opts.publicUrl ?? '').replace(/\/$/, ''),
    );
    return AgentCardCodec.fromJSON(generic);
  }

  async getAuthenticatedExtendedAgentCard(): Promise<AgentCard> {
    throw new ExtendedAgentCardNotConfiguredError('No extended agent card');
  }

  async sendMessage(params: SendMessageRequest, ctx: ServerCallContext) {
    const { caller, target } = this.who(params, ctx);
    try {
      const { task } = await this.svc.send(caller, target, SendMessageRequest.toJSON(params));
      return Task.fromJSON(task);
    } catch (err) {
      throw sdkError(err);
    }
  }

  async *sendMessageStream(params: SendMessageRequest, ctx: ServerCallContext) {
    const { caller, target } = this.who(params, ctx);
    const { taskId, historyLength } = this.call(() => this.svc.begin(caller, target, SendMessageRequest.toJSON(params)));
    for await (const event of this.svc.events(caller, taskId, historyLength)) {
      if (event) yield StreamResponse.fromJSON(event);
    }
  }

  async *resubscribe(params: SubscribeToTaskRequest, ctx: ServerCallContext) {
    const { caller, target } = this.who(params, ctx);
    const taskId = this.call(() => this.svc.subscribeCheck(caller, target, SubscribeToTaskRequest.toJSON(params)));
    for await (const event of this.svc.events(caller, taskId, undefined)) {
      if (event) yield StreamResponse.fromJSON(event);
    }
  }

  async getTask(params: GetTaskRequest, ctx: ServerCallContext) {
    const { caller, target } = this.who(params, ctx);
    return Task.fromJSON(this.call(() => this.svc.getTask(caller, target, GetTaskRequest.toJSON(params))));
  }

  async listTasks(params: ListTasksRequest, ctx: ServerCallContext) {
    const { caller, target } = this.who(params, ctx);
    return ListTasksResponse.fromJSON(this.call(() => this.svc.listTasks(caller, target, ListTasksRequest.toJSON(params))));
  }

  async cancelTask(params: CancelTaskRequest, ctx: ServerCallContext) {
    const { caller, target } = this.who(params, ctx);
    return Task.fromJSON(this.call(() => this.svc.cancel(caller, target, CancelTaskRequest.toJSON(params))));
  }

  async createTaskPushNotificationConfig(params: TaskPushNotificationConfig, ctx: ServerCallContext) {
    const { caller, target } = this.who(params, ctx);
    return TaskPushNotificationConfig.fromJSON(
      this.call(() => this.svc.createPush(caller, target, TaskPushNotificationConfig.toJSON(params))),
    );
  }

  async getTaskPushNotificationConfig(params: GetTaskPushNotificationConfigRequest, ctx: ServerCallContext) {
    const { caller, target } = this.who(params, ctx);
    return TaskPushNotificationConfig.fromJSON(
      this.call(() => this.svc.getPush(caller, target, GetTaskPushNotificationConfigRequest.toJSON(params))),
    );
  }

  async listTaskPushNotificationConfigs(params: ListTaskPushNotificationConfigsRequest, ctx: ServerCallContext) {
    const { caller, target } = this.who(params, ctx);
    return ListTaskPushNotificationConfigsResponse.fromJSON(
      this.call(() => this.svc.listPush(caller, target, ListTaskPushNotificationConfigsRequest.toJSON(params))),
    );
  }

  async deleteTaskPushNotificationConfig(params: DeleteTaskPushNotificationConfigRequest, ctx: ServerCallContext) {
    const { caller, target } = this.who(params, ctx);
    this.call(() => this.svc.deletePush(caller, target, DeleteTaskPushNotificationConfigRequest.toJSON(params)));
  }
}

const bearer = (value: string | string[] | undefined) => {
  const h = Array.isArray(value) ? value[0] : value;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
};

/** Express app serving the HTTP+JSON binding under `/a2a-rest`. */
export function createRestBinding(svc: A2AService) {
  const app = express();
  app.disable('x-powered-by');
  const handler = new GatewayRequestHandler(svc);
  app.use(
    '/a2a-rest',
    (req: Request, res: Response, next: NextFunction) => {
      const principal = svc.gateway.authenticate(bearer(req.headers.authorization));
      if (!principal) {
        res
          .status(401)
          .set('WWW-Authenticate', 'Bearer')
          .json({ error: { code: 401, status: 'UNAUTHENTICATED', message: 'gateway bearer token required' } });
        return;
      }
      (req as Request & { agw?: Principal }).agw = principal;
      next();
    },
    restHandler({
      requestHandler: handler,
      userBuilder: async (req) => {
        const p = (req as Request & { agw?: Principal }).agw;
        return p ? new GatewayUser(p) : unauthenticated;
      },
    }),
  );
  return app;
}

export interface GrpcBindingOptions {
  port: number;
  host: string;
  /** PEM files; without them the server is plaintext (put it behind a TLS proxy). */
  tlsCertFile?: string | undefined;
  tlsKeyFile?: string | undefined;
}

/** gRPC binding; resolves with the bound port. */
export async function startGrpcBinding(
  svc: A2AService,
  opts: GrpcBindingOptions,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = new grpc.Server();
  server.addService(
    GrpcServiceDefinition,
    grpcService({
      requestHandler: new GatewayRequestHandler(svc),
      userBuilder: async (call) => {
        const auth = call.metadata.get('authorization')[0];
        const p = svc.gateway.authenticate(bearer(typeof auth === 'string' ? auth : auth?.toString()));
        return p ? new GatewayUser(p) : unauthenticated;
      },
    }),
  );
  const creds =
    opts.tlsCertFile && opts.tlsKeyFile
      ? grpc.ServerCredentials.createSsl(null, [
          { cert_chain: readFileSync(opts.tlsCertFile), private_key: readFileSync(opts.tlsKeyFile) },
        ])
      : grpc.ServerCredentials.createInsecure();
  const port = await new Promise<number>((resolve, reject) =>
    server.bindAsync(`${opts.host}:${opts.port}`, creds, (err, p) => (err ? reject(err) : resolve(p))),
  );
  return {
    port,
    close: () => new Promise<void>((resolve) => server.tryShutdown(() => resolve())),
  };
}
