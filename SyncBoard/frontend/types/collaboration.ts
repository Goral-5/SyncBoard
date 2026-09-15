/**
 * collaboration.ts
 *
 * Authoritative TypeScript specifications for SyncBoard collaboration protocol.
 * Strictly adheres to COLLABORATION_CONTRACT.md.
 */

export type ElementOperationType =
  | 'element:create'
  | 'element:update'
  | 'element:delete'
  | 'element:move-preview'
  | 'element:move-commit';

export interface CollaboratorUser {
  clientId: string;
  userId: string;
  username: string;
  color: string;
}

export interface RemoteCursor {
  clientId: string;
  userId?: string;
  username: string;
  color: string;
  x: number; // World / canvas x-coordinate
  y: number; // World / canvas y-coordinate
  lastUpdated: number;
}

export interface ElementOperation {
  type: ElementOperationType;
  operationId: string;
  roomId: string;
  clientId: string;
  elementId: string;
  element: any; // Excalidraw element object
}

// ── Client -> Server Messages ───────────────────────────────────────────────────

export interface RoomJoinMessage {
  type: 'room:join';
  roomId: string;
  lastKnownVersion?: number;
}

export interface RoomSyncRequestMessage {
  type: 'room:sync-request';
  roomId: string;
  lastKnownVersion: number;
}

export type ElementOperationClientMessage = ElementOperation;

export interface PresenceUpdateClientMessage {
  type: 'presence:update';
  roomId: string;
  cursor: {
    x: number;
    y: number;
  } | null;
  selectedElementId?: string | null;
}

export type ClientCollaborationMessage =
  | RoomJoinMessage
  | RoomSyncRequestMessage
  | ElementOperationClientMessage
  | PresenceUpdateClientMessage;

// ── Server -> Client Messages ───────────────────────────────────────────────────

export interface RoomStateServerMessage {
  type: 'room:state';
  roomId: string;
  revision: number;
  elements: any[];
  users: CollaboratorUser[];
}

export interface OperationBroadcastServerMessage {
  type: 'operation:broadcast';
  roomId: string;
  revision: number;
  operation: ElementOperation;
}

export interface RoomSyncServerMessage {
  type: 'room:sync';
  roomId: string;
  revision: number;
  fullSync: boolean;
  operations?: ElementOperation[];
  elements?: any[];
}

export interface PresenceUpdateServerMessage {
  type: 'presence:update';
  roomId: string;
  clientId: string;
  userId: string;
  username: string;
  color: string;
  cursor: {
    x: number;
    y: number;
  } | null;
  selectedElementId?: string | null;
}

export interface UserJoinedServerMessage {
  type: 'user:joined';
  roomId: string;
  user: CollaboratorUser;
}

export interface UserLeftServerMessage {
  type: 'user:left';
  roomId: string;
  clientId: string;
  userId: string;
}

export type ServerCollaborationMessage =
  | RoomStateServerMessage
  | OperationBroadcastServerMessage
  | RoomSyncServerMessage
  | PresenceUpdateServerMessage
  | UserJoinedServerMessage
  | UserLeftServerMessage;

// ── REST API Responses ──────────────────────────────────────────────────────────

export interface RoomData {
  _id: string;
  slug: string;
  adminId: { _id: string; name?: string } | string;
  collaborators: Array<{ _id: string; name?: string } | string>;
  elements: any[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoomResponse {
  room: RoomData;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
