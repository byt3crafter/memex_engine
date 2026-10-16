// Shared wire types for the gateway server, client, MCP server and runner.

/** What a channel lets the sender do. `message` = questions and conversation, `task` = work that may change things. */
export type Scope = 'message' | 'task';
export const SCOPES: readonly Scope[] = ['message', 'task'];

/** Task lifecycle, modelled on A2A's task states. */
export type TaskStatus =
  | 'submitted'
  | 'working'
  | 'input_required'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'canceled';

export const TERMINAL_STATUSES: readonly TaskStatus[] = [
  'completed',
  'failed',
  'rejected',
  'canceled',
];

export interface Agent {
  id: string;
  handle: string;
  description: string | null;
  createdAt: string;
}

export interface Channel {
  id: string;
  /** Agent allowed to send. */
  sender: string;
  /** Agent that receives. */
  recipient: string;
  scopes: Scope[];
  createdAt: string;
  revokedAt: string | null;
}

export interface Task {
  id: string;
  /** Sender handle. */
  from: string;
  /** Recipient handle. */
  to: string;
  kind: Scope;
  project: string | null;
  title: string | null;
  body: string;
  status: TaskStatus;
  result: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskMessage {
  id: string;
  taskId: string;
  author: string;
  body: string;
  createdAt: string;
}

export type GatewayEventType =
  | 'task.created'
  | 'task.updated'
  | 'task.message'
  | 'channel.created'
  | 'channel.revoked';

export interface GatewayEvent {
  seq: number;
  type: GatewayEventType;
  taskId: string | null;
  data: unknown;
  createdAt: string;
}
