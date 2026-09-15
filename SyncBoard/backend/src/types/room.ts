import { WebSocket } from 'ws';

export interface ClientSession {
  ws: WebSocket;
  clientId: string;
  userId: string;
  username: string;
  color: string;
  isAlive: boolean;
  cursor?: { x: number; y: number };
  selectedElementId?: string;
  joinedRooms: Set<string>;
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

export interface UserSummary {
  clientId: string;
  userId: string;
  username: string;
  color: string;
}

export interface RoomStateDTO {
  type: 'room:state';
  roomId: string;
  revision: number;
  elements: any[];
  users: UserSummary[];
}

export interface OperationBroadcastDTO {
  type: 'operation:broadcast';
  roomId: string;
  revision: number;
  operation: ElementOperation;
}

export interface RoomSyncDTO {
  type: 'room:sync';
  roomId: string;
  revision: number;
  fullSync: boolean;
  operations?: ElementOperation[];
  elements?: any[];
}

export interface PresenceBroadcastDTO {
  type: 'presence:update';
  roomId: string;
  clientId: string;
  userId: string;
  username: string;
  color: string;
  cursor?: { x: number; y: number };
  selectedElementId?: string;
}

export interface UserJoinedDTO {
  type: 'user:joined';
  roomId: string;
  user: UserSummary;
}

export interface UserLeftDTO {
  type: 'user:left';
  roomId: string;
  clientId: string;
  userId: string;
}

export interface ChatBroadcastDTO {
  type: 'chat';
  roomId: string;
  message: any;
}

export interface ErrorDTO {
  type: 'error';
  message: string;
}
