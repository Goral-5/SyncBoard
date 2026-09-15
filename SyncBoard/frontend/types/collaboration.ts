export interface CollaboratorUser {
  clientId: string;
  userId: string;
  username: string;
  color: string;
  cursor?: { x: number; y: number };
  selectedElementId?: string;
  lastSeen?: number;
}

export type OperationType =
  | 'element:create'
  | 'element:update'
  | 'element:delete'
  | 'element:move-preview'
  | 'element:move-commit';

export interface ElementOperation {
  type: OperationType;
  operationId: string;
  roomId: string;
  clientId: string;
  elementId: string;
  element: any;
  revision?: number;
  timestamp?: number;
}

// Client -> Server messages
export interface JoinRoomMessage {
  type: 'room:join';
  roomId: string;
  lastKnownVersion?: number;
}

export interface SyncRequestMessage {
  type: 'room:sync-request';
  roomId: string;
  lastKnownVersion: number;
}

export interface PresenceUpdateMessage {
  type: 'presence:update';
  roomId: string;
  cursor?: { x: number; y: number };
  selectedElementId?: string;
}

export interface ChatMessage {
  type: 'chat';
  roomId: string;
  content: string;
}

// Server -> Client messages
export interface RoomStateMessage {
  type: 'room:state';
  roomId: string;
  revision: number;
  elements: any[];
  users: CollaboratorUser[];
}

export interface OperationBroadcastMessage {
  type: 'operation:broadcast';
  roomId: string;
  revision: number;
  operation: ElementOperation;
}

export interface RoomSyncMessage {
  type: 'room:sync';
  roomId: string;
  revision: number;
  fullSync: boolean;
  operations?: ElementOperation[];
  elements?: any[];
}

export interface PresenceBroadcastMessage {
  type: 'presence:update';
  roomId: string;
  clientId: string;
  userId: string;
  username: string;
  color: string;
  cursor?: { x: number; y: number };
  selectedElementId?: string;
}

export interface UserJoinedMessage {
  type: 'user:joined';
  roomId: string;
  user: CollaboratorUser;
}

export interface UserLeftMessage {
  type: 'user:left';
  roomId: string;
  clientId: string;
  userId: string;
}

export interface ChatBroadcastMessage {
  type: 'chat';
  roomId: string;
  message: any;
}
