// Shared wire types for the gateway server, client, MCP server, runner and web app.

/** What access to an agent allows. `message` = questions and conversation, `task` = work that may change things. */
export type Scope = 'message' | 'task';
export const SCOPES: readonly Scope[] = ['message', 'task'];

/**
 * How much the agent's owner reviews when someone else uses the agent:
 * - `auto`: requests go straight to the agent ("full control" for the grantee)
 * - `requests`: the owner approves each request before the agent sees it
 * - `all`: the owner approves each request and each reply before it is sent back
 */
export type ApprovalMode = 'auto' | 'requests' | 'all';
export const APPROVAL_MODES: readonly ApprovalMode[] = ['auto', 'requests', 'all'];

/** Task lifecycle, modelled on A2A's task states, plus the two owner-review holds. */
export type TaskStatus =
  | 'pending_approval'
  | 'submitted'
  | 'working'
  | 'input_required'
  | 'reviewing'
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

export type PrincipalKind = 'human' | 'agent';

/** A person or an agent. Both can be in conversations; only agents receive tasks. */
export interface Principal {
  id: string;
  kind: PrincipalKind;
  handle: string;
  displayName: string | null;
  description: string | null;
  /** Owner's handle, for agents that belong to a person. */
  owner: string | null;
  ownerId: string | null;
  /** Whether the agent's A2A card is public. */
  discoverable: boolean;
  /** A paused agent receives nothing until its owner approves it. */
  paused: boolean;
  createdAt: string;
}

/** Kept for readability where only agents are meant. */
export type Agent = Principal;

/** Access from `sender` (person or agent) to agent `recipient`. */
export interface Channel {
  id: string;
  sender: string;
  recipient: string;
  scopes: Scope[];
  approval: ApprovalMode;
  /** For a person: their own agents may use this access too. */
  includeAgents: boolean;
  expiresAt: string | null;
  grantedBy: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface Task {
  id: string;
  /** Conversation this task belongs to (A2A `contextId`). */
  contextId: string;
  /** Sender handle. */
  from: string;
  /** Recipient agent handle. */
  to: string;
  kind: Scope;
  project: string | null;
  title: string | null;
  body: string;
  status: TaskStatus;
  result: string | null;
  /** Owner review applied to this task. */
  approval: ApprovalMode | 'owner';
  /** Conversation message that started it. */
  requestMessageId: string | null;
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

export type MemberRole = 'admin' | 'member' | 'overseer';
export type MemberState = 'joined' | 'invited';

export interface Member {
  handle: string;
  kind: PrincipalKind;
  displayName: string | null;
  owner: string | null;
  role: MemberRole;
  state: MemberState;
  lastReadSeq: number;
}

export interface Conversation {
  id: string;
  title: string | null;
  direct: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastSeq: number;
  members: Member[];
}

export interface ConversationSummary extends Conversation {
  myState: MemberState;
  myRole: MemberRole;
  unread: number;
  lastMessage: Message | null;
}

export interface Attachment {
  id: string;
  filename: string;
  mediaType: string;
  size: number;
}

export interface Delivery {
  taskId: string;
  to: string;
  status: TaskStatus;
}

export type MessageKind = 'text' | 'reply' | 'system';

export interface Message {
  id: string;
  seq: number;
  conversationId: string;
  author: string;
  authorKind: PrincipalKind;
  kind: MessageKind;
  body: string;
  /** Agents this message was addressed to. */
  to: string[];
  replyTo: string | null;
  /** For agent replies: the task they answer. */
  taskId: string | null;
  attachments: Attachment[];
  /** Tasks this message started, with their state (e.g. waiting for owner approval). */
  deliveries: Delivery[];
  createdAt: string;
}

export type ApprovalKind = 'request' | 'reply';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Approval {
  id: string;
  kind: ApprovalKind;
  status: ApprovalStatus;
  taskId: string;
  conversationId: string;
  /** Agent being protected. */
  agent: string;
  /** Who asked (request) or who will receive the reply. */
  requester: string;
  /** Text awaiting the decision: the request, or the agent's proposed reply. */
  body: string;
  /** For replies: the outcome the agent proposed. */
  proposedStatus: TaskStatus | null;
  note: string | null;
  decidedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export type GatewayEventType =
  | 'task.created'
  | 'task.updated'
  | 'task.message'
  | 'channel.created'
  | 'channel.revoked'
  | 'channel.updated'
  | 'conversation.updated'
  | 'conversation.invited'
  | 'message.created'
  | 'approval.requested'
  | 'approval.resolved'
  | 'agent.updated';

export interface GatewayEvent {
  seq: number;
  type: GatewayEventType;
  taskId: string | null;
  data: unknown;
  createdAt: string;
}
