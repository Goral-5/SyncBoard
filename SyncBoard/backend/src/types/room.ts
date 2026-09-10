/**
 * Room & Real-Time Collaboration Type Definitions
 *
 * Implements the domain types for SyncBoard:
 * - Persistent Room Snapshot & Monotonic Revision
 * - Element-level operations (Create, Update, Delete, Move Preview, Move Commit)
 * - Ephemeral Presence and Cursor Synchronization
 * - Strongly-typed WebSocket message contracts
 */

// ==========================================
// 1. Revision & Snapshot Types
// ==========================================

export type RoomRevision = number;

export interface RoomSnapshot {
  roomId: string;
  revision: RoomRevision;
  elements: any[];
}

export interface ElementMutationResult {
  success: boolean;
  revision: RoomRevision;
  element?: any;
  ignored?: boolean;
  error?: string;
}

// ==========================================
// 2. Element Operation Types
// ==========================================

export interface BaseOperation {
  operationId: string;
  clientId: string;
  roomId: string;
  timestamp?: number;
}

export interface CreateElementOperation extends BaseOperation {
  type: 'element:create';
  element: any;
}

export interface UpdateElementOperation extends BaseOperation {
  type: 'element:update';
  elementId: string;
  element: any;
}

export interface DeleteElementOperation extends BaseOperation {
  type: 'element:delete';
  elementId: string;
}

export interface MovePreviewOperation extends BaseOperation {
  type: 'element:move-preview';
  elementId: string;
  element: any;
}

export interface MoveCommitOperation extends BaseOperation {
  type: 'element:move-commit';
  elementId: string;
  element: any;
}

export type ElementOperation =
  | CreateElementOperation
  | UpdateElementOperation
  | DeleteElementOperation
  | MovePreviewOperation
  | MoveCommitOperation;

// ==========================================
// 3. Ephemeral Presence & Cursor Types
// ==========================================

export interface CursorCoordinates {
  x: number;
  y: number;
}

export interface UserPresence {
  userId: string;
  clientId: string;
  username: string;
  color: string;
  cursor?: CursorCoordinates | null;
  selectedElementId?: string | null;
  lastActive?: number;
}

// ==========================================
// 4. Client -> Server WebSocket Messages
// ==========================================

export interface ClientJoinRoomMessage {
  type: 'room:join';
  roomId: string;
  token?: string;
  lastKnownVersion?: number;
}

export interface ClientSyncRequestMessage {
  type: 'room:sync-request';
  roomId: string;
  lastKnownVersion: number;
}

export interface ClientPresenceUpdateMessage {
  type: 'presence:update';
  roomId: string;
  cursor?: CursorCoordinates | null;
  selectedElementId?: string | null;
}

export type ClientWebSocketMessage =
  | ClientJoinRoomMessage
  | ClientSyncRequestMessage
  | ClientPresenceUpdateMessage
  | ElementOperation;

// ==========================================
// 5. Server -> Client WebSocket Messages
// ==========================================

export interface ServerRoomStateMessage {
  type: 'room:state';
  roomId: string;
  revision: RoomRevision;
  elements: any[];
}

export interface ServerOperationBroadcastMessage {
  type: 'operation:broadcast';
  roomId: string;
  revision: RoomRevision;
  operation: ElementOperation;
}

export interface ServerSyncResponseMessage {
  type: 'room:sync';
  roomId: string;
  revision: RoomRevision;
  operations?: ElementOperation[];
  fullSync?: boolean;
  elements?: any[];
}

export interface ServerPresenceUpdateMessage {
  type: 'presence:update';
  roomId: string;
  presence: UserPresence;
}

export interface ServerUserJoinedMessage {
  type: 'user:joined';
  roomId: string;
  user: UserPresence;
}

export interface ServerUserLeftMessage {
  type: 'user:left';
  roomId: string;
  clientId: string;
  userId: string;
}

export interface ServerErrorMessage {
  type: 'error';
  message: string;
  code?: string;
}

export type ServerWebSocketMessage =
  | ServerRoomStateMessage
  | ServerOperationBroadcastMessage
  | ServerSyncResponseMessage
  | ServerPresenceUpdateMessage
  | ServerUserJoinedMessage
  | ServerUserLeftMessage
  | ServerErrorMessage;
