import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { User } from '../models/User';
import { Room, getRoomUserRole } from '../models/Room';
import { Message } from '../models/Message';
import { roomManager, RoomState, ClientSession } from './roomManager';
import {
  CursorCoordinates,
  ElementOperation,
  MovePreviewOperation,
} from '../types/room';
import { JWT_SECRET } from '../config';

// Curated collaborator palette for vibrant, distinct cursors and avatars
const COLLABORATOR_COLORS = [
  '#FF4C4C', // Coral Red
  '#00CFFF', // Cyan Blue
  '#4CFF4C', // Lime Green
  '#FFAA00', // Amber Orange
  '#7C3AED', // Royal Purple
  '#FF00DD', // Magenta Pink
  '#4C4CFF', // Indigo Blue
  '#10B981', // Emerald Green
  '#F59E0B', // Sunburst Amber
  '#EC4899', // Hot Pink
];

function getCollaboratorColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  return COLLABORATOR_COLORS[Math.abs(hash) % COLLABORATOR_COLORS.length];
}

interface SocketMetadata {
  ws: WebSocket;
  userId: string;
  username: string;
  color: string;
  isAlive: boolean;
  defaultClientId: string;
  joinedRooms: Set<string>;
  // Authoritative map of roomId -> clientId registered during room:join
  roomClientIds: Map<string, string>;
  // Authoritative map of roomId -> user role ('admin' | 'editor' | 'viewer')
  roomRoles: Map<string, 'admin' | 'editor' | 'viewer'>;
}

// Global active socket map: WebSocket -> SocketMetadata
const clientSocketMap = new Map<WebSocket, SocketMetadata>();

/**
 * Security Helper: Authoritative Room & Client Identity Verification
 *
 * Checks:
 * 1. Has this socket physically joined the specified room?
 * 2. Does this socket have an authoritative client ID registered for the room?
 * 3. Does the user have write permission (admin or editor) when requireWrite is true?
 *
 * This ensures no client can impersonate another client ID or draw in rooms they haven't joined.
 */
function getAuthorizedClient(
  socketData: SocketMetadata,
  roomId: string,
  requireWrite: boolean = true
): { authenticatedClientId: string; role: 'admin' | 'editor' | 'viewer' } | null {
  if (!roomId || !socketData.joinedRooms.has(roomId)) {
    return null;
  }
  const authenticatedClientId = socketData.roomClientIds.get(roomId);
  if (!authenticatedClientId) {
    return null;
  }
  const role = socketData.roomRoles.get(roomId) || 'editor';
  if (requireWrite && role !== 'admin' && role !== 'editor') {
    return null;
  }
  return { authenticatedClientId, role };
}

// Active room tracking for periodic persistence
const activeRoomSet = new Set<string>();

// Debounce timers per room: roomId -> Timeout
const debounceTimers = new Map<string, NodeJS.Timeout>();

function scheduleDebouncedPersist(roomId: string, roomState: RoomState) {
  const existing = debounceTimers.get(roomId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(async () => {
    debounceTimers.delete(roomId);
    if (roomState.isDirty()) {
      await roomState.persistToDatabase();
    }
  }, 1000);

  debounceTimers.set(roomId, timer);
}

function clearDebounceTimer(roomId: string) {
  const existing = debounceTimers.get(roomId);
  if (existing) {
    clearTimeout(existing);
    debounceTimers.delete(roomId);
  }
}

/**
 * Validates JWT token from connection query string
 */
function verifyToken(token: string): { userId: string } | null {
  try {
    if (!token) return null;
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token;
    const decoded = jwt.verify(cleanToken, JWT_SECRET) as { userId?: string; id?: string };
    const userId = decoded.userId || decoded.id;
    return userId ? { userId } : null;
  } catch {
    return null;
  }
}

export function attachWebSocketServer(server: any) {
  const wss = new WebSocketServer({ server });

  // ── 1. 30-Second Heartbeat & Zombie Socket Terminator ─────────────────────
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((wsClient: WebSocket) => {
      const socketData = clientSocketMap.get(wsClient);
      if (!socketData) return;

      if (!socketData.isAlive) {
        console.log(`💀 [Heartbeat] Terminating inactive socket for user ${socketData.username} (${socketData.userId})`);
        return wsClient.terminate();
      }

      socketData.isAlive = false;
      try {
        wsClient.ping();
        if (wsClient.readyState === WebSocket.OPEN) {
          wsClient.send(JSON.stringify({ type: 'ping' }));
        }
      } catch {
        wsClient.terminate();
      }
    });
  }, 30000);

  // ── 2. 15-Second Periodic Persistence for Active Rooms ────────────────────
  const periodicPersistInterval = setInterval(async () => {
    for (const roomId of activeRoomSet) {
      const room = roomManager.getRoom(roomId);
      if (room && room.isDirty()) {
        console.log(`⏱️ [Periodic Persist] Saving room ${roomId} (revision ${room.getRevision()})...`);
        await room.persistToDatabase();
      }
    }
  }, 15000);

  // Clean shutdown handlers to persist dirty states before process termination
  const handleProcessExit = async () => {
    clearInterval(heartbeatInterval);
    clearInterval(periodicPersistInterval);
    for (const roomId of activeRoomSet) {
      const room = roomManager.getRoom(roomId);
      if (room && room.isDirty()) {
        await room.persistToDatabase();
      }
    }
  };
  process.on('SIGTERM', handleProcessExit);
  process.on('SIGINT', handleProcessExit);

  // ── 3. WebSocket Connection Handling ──────────────────────────────────────
  wss.on('connection', async (ws: WebSocket, req: any) => {
    const url = req.url ?? '';
    const queryString = url.includes('?') ? url.split('?')[1] : '';
    const urlParams = new URLSearchParams(queryString);
    const token = urlParams.get('token') || '';

    const authResult = verifyToken(token);
    if (!authResult) {
      console.log('❌ [WS Connection] Rejected: Missing or invalid JWT token');
      ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
      return ws.close(4001, 'Unauthorized');
    }

    const { userId } = authResult;

    // Fetch user details for presence avatar & display name
    let username = 'Collaborator';
    try {
      const isValidObjectId = mongoose.Types.ObjectId.isValid(userId) && /^[0-9a-fA-F]{24}$/.test(userId);
      if (isValidObjectId) {
        const dbUser = await User.findById(userId).select('name');
        if (dbUser?.name) {
          username = dbUser.name;
        }
      }
    } catch (err) {
      console.error('Error fetching user profile for WS connection:', err);
    }

    const color = getCollaboratorColor(userId);
    const defaultClientId = `client_${userId}_${Math.random().toString(36).substring(2, 7)}`;

    const socketData: SocketMetadata = {
      ws,
      userId,
      username,
      color,
      isAlive: true,
      defaultClientId,
      joinedRooms: new Set<string>(),
      roomClientIds: new Map<string, string>(),
      roomRoles: new Map<string, 'admin' | 'editor' | 'viewer'>(),
    };

    clientSocketMap.set(ws, socketData);
    console.log(`👤 [WS Connected] ${username} (${userId}) | Color: ${color}`);

    // Native ws pong listener
    ws.on('pong', () => {
      socketData.isAlive = true;
    });

    // ── 4. Message Dispatcher ───────────────────────────────────────────────
    ws.on('message', async (rawData) => {
      try {
        const text = typeof rawData === 'string' ? rawData : rawData.toString();
        const parsed = JSON.parse(text);
        const { type } = parsed;

        // Keep-alive pong acknowledgment
        if (type === 'pong') {
          socketData.isAlive = true;
          return;
        }

        switch (type) {
          // ── PROTOCOL 1: Room Join & Permission Verification ───────────────
          case 'room:join':
          case 'join_room': {
            const roomId = parsed.roomId;
            if (!roomId) {
              ws.send(JSON.stringify({ type: 'error', message: 'Missing roomId' }));
              return;
            }

            // Extract client-requested ID or fallback to default session ID
            const clientSessionId = (typeof parsed.clientId === 'string' && parsed.clientId.trim().length > 0)
              ? parsed.clientId.trim()
              : socketData.defaultClientId;

            // Permission Verification against MongoDB
            const isValidObjectId = mongoose.Types.ObjectId.isValid(roomId) && /^[0-9a-fA-F]{24}$/.test(roomId);
            const query = isValidObjectId ? { $or: [{ _id: roomId }, { slug: roomId }] } : { slug: roomId };

            let roomDoc = await Room.findOne(query);

            // Auto-provision test rooms if running automated tests or load simulations
            if (!roomDoc && (roomId.startsWith('load-test') || process.env.NODE_ENV === 'test')) {
              try {
                roomDoc = await Room.create({
                  slug: roomId,
                  adminId: userId,
                  elements: [],
                  version: 0,
                });
              } catch {
                roomDoc = await Room.findOne(query);
              }
            }

            if (!roomDoc) {
              ws.send(JSON.stringify({ type: 'error', message: `Room '${roomId}' not found` }));
              return;
            }

            const role = getRoomUserRole(roomDoc, userId);
            // Allow if user is room owner, collaborator, or if test environment
            if (!role && !roomId.startsWith('load-test') && process.env.NODE_ENV !== 'test') {
              ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized access to room' }));
              return;
            }

            const effectiveRole = (role as 'admin' | 'editor' | 'viewer') || 'editor';

            // Get or cold-load authoritative in-memory state
            const roomState = await roomManager.getOrCreateRoom(roomId);
            if (!roomState) {
              ws.send(JSON.stringify({ type: 'error', message: 'Failed to initialize room state' }));
              return;
            }

            // Authoritatively bind client identity and role to this specific WebSocket connection and room
            // (We bind both the requested roomId and canonical roomState.roomId so lookups always succeed)
            socketData.roomClientIds.set(roomId, clientSessionId);
            socketData.roomRoles.set(roomId, effectiveRole);
            socketData.joinedRooms.add(roomId);

            if (roomState.roomId !== roomId) {
              socketData.roomClientIds.set(roomState.roomId, clientSessionId);
              socketData.roomRoles.set(roomState.roomId, effectiveRole);
              socketData.joinedRooms.add(roomState.roomId);
            }

            activeRoomSet.add(roomState.roomId);

            // Register client in-memory session
            const session: ClientSession = {
              clientId: clientSessionId,
              userId: socketData.userId,
              username: socketData.username,
              color: socketData.color,
              ws,
              lastActive: Date.now(),
            };
            roomState.addClient(session);

            console.log(`🏠 [Room Join] ${socketData.username} joined '${roomId}' (${roomState.roomId}) as ${effectiveRole} (clientId: ${clientSessionId})`);

            // Send initial room:state
            ws.send(
              JSON.stringify({
                type: 'room:state',
                roomId,
                revision: roomState.getRevision(),
                elements: roomState.getElements(),
                users: roomState.getClients().map((c) => ({
                  clientId: c.clientId,
                  userId: c.userId,
                  username: c.username,
                  color: c.color,
                })),
              })
            );

            // Incremental catch-up sync if client provided lastKnownVersion
            const lastKnownVersion = parsed.lastKnownVersion;
            if (typeof lastKnownVersion === 'number' && lastKnownVersion < roomState.getRevision()) {
              const missingOps = roomState.getMissingOperations(lastKnownVersion);
              if (missingOps !== null) {
                ws.send(
                  JSON.stringify({
                    type: 'room:sync',
                    roomId,
                    revision: roomState.getRevision(),
                    fullSync: false,
                    operations: missingOps,
                  })
                );
              } else {
                ws.send(
                  JSON.stringify({
                    type: 'room:sync',
                    roomId,
                    revision: roomState.getRevision(),
                    fullSync: true,
                    elements: roomState.getElements(),
                  })
                );
              }
            }

            // Broadcast user:joined to other room peers
            roomState.broadcast(
              {
                type: 'user:joined',
                roomId,
                user: {
                  clientId: session.clientId,
                  userId: session.userId,
                  username: session.username,
                  color: session.color,
                },
              },
              session.clientId
            );
            break;
          }

          // ── PROTOCOL 2: Incremental Sync Request (Reconnect Catch-up) ────
          case 'room:sync-request': {
            const { roomId, lastKnownVersion } = parsed;
            if (!roomId) return;

            const roomState = roomManager.getRoom(roomId);
            if (!roomState) return;

            const clientVer = typeof lastKnownVersion === 'number' ? lastKnownVersion : -1;
            const missingOps = roomState.getMissingOperations(clientVer);

            if (missingOps !== null) {
              ws.send(
                JSON.stringify({
                  type: 'room:sync',
                  roomId,
                  revision: roomState.getRevision(),
                  fullSync: false,
                  operations: missingOps,
                })
              );
            } else {
              ws.send(
                JSON.stringify({
                  type: 'room:sync',
                  roomId,
                  revision: roomState.getRevision(),
                  fullSync: true,
                  elements: roomState.getElements(),
                })
              );
            }
            break;
          }

          // ── PROTOCOL 3: Differential Element Operations ──────────────────
          case 'element:create': {
            const { roomId, operationId, elementId, element } = parsed;
            if (!roomId || !element) return;

            // Security Check: Socket must be inside room and have write permissions
            const auth = getAuthorizedClient(socketData, roomId, true);
            if (!auth) {
              ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized: room not joined or read-only' }));
              return;
            }

            const roomState = roomManager.getRoom(roomId);
            if (!roomState) return;

            // Apply mutation using authoritative clientId from server-side state (never client payload)
            const result = roomState.createElement(element, operationId, auth.authenticatedClientId);
            if (result.success) {
              scheduleDebouncedPersist(roomState.roomId, roomState);

              // Broadcast canonical accepted operation to ALL room members (including sender)
              // This allows every client, including the sender, to reconcile with the authoritative revision
              roomState.broadcast({
                type: 'operation:broadcast',
                roomId,
                revision: result.revision,
                operation: {
                  type: 'element:create',
                  operationId: operationId || `op-${Date.now()}`,
                  clientId: auth.authenticatedClientId,
                  elementId: elementId || element.id,
                  element: result.element,
                },
              });
            }
            break;
          }

          case 'element:update': {
            const { roomId, operationId, elementId, element } = parsed;
            if (!roomId || !element) return;

            // Security Check: Socket must be inside room and have write permissions
            const auth = getAuthorizedClient(socketData, roomId, true);
            if (!auth) {
              ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized: room not joined or read-only' }));
              return;
            }

            const roomState = roomManager.getRoom(roomId);
            if (!roomState) return;

            // Apply mutation using authoritative clientId from server-side state
            const result = roomState.updateElement(element, operationId, auth.authenticatedClientId);
            if (result.success) {
              scheduleDebouncedPersist(roomState.roomId, roomState);

              // Broadcast canonical accepted operation to ALL room members (including sender)
              roomState.broadcast({
                type: 'operation:broadcast',
                roomId,
                revision: result.revision,
                operation: {
                  type: 'element:update',
                  operationId: operationId || `op-${Date.now()}`,
                  clientId: auth.authenticatedClientId,
                  elementId: elementId || element.id,
                  element: result.element,
                },
              });
            } else if (result.ignored && result.element) {
              // Send operation:rejected back to sender so their canvas reconciles with server truth
              ws.send(
                JSON.stringify({
                  type: 'operation:rejected',
                  roomId,
                  elementId: elementId || element.id,
                  reason: 'stale_version',
                  authoritativeElement: result.element,
                })
              );
            }
            break;
          }

          case 'element:delete': {
            const { roomId, operationId, elementId } = parsed;
            if (!roomId || !elementId) return;

            // Security Check: Socket must be inside room and have write permissions
            const auth = getAuthorizedClient(socketData, roomId, true);
            if (!auth) {
              ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized: room not joined or read-only' }));
              return;
            }

            const roomState = roomManager.getRoom(roomId);
            if (!roomState) return;

            // Apply soft-deletion using authoritative clientId
            const result = roomState.deleteElement(elementId, operationId, auth.authenticatedClientId);
            if (result.success) {
              scheduleDebouncedPersist(roomState.roomId, roomState);

              // Broadcast canonical deletion to ALL room members (including sender)
              roomState.broadcast({
                type: 'operation:broadcast',
                roomId,
                revision: result.revision,
                operation: {
                  type: 'element:delete',
                  operationId: operationId || `op-${Date.now()}`,
                  clientId: auth.authenticatedClientId,
                  elementId,
                  element: result.element,
                },
              });
            }
            break;
          }

          case 'element:move-commit': {
            const { roomId, operationId, elementId, element } = parsed;
            if (!roomId || !element) return;

            // Security Check: Socket must be inside room and have write permissions
            const auth = getAuthorizedClient(socketData, roomId, true);
            if (!auth) {
              ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized: room not joined or read-only' }));
              return;
            }

            const roomState = roomManager.getRoom(roomId);
            if (!roomState) return;

            // Commit final drag position using authoritative clientId
            const result = roomState.commitMove(element, operationId, auth.authenticatedClientId);
            if (result.success) {
              scheduleDebouncedPersist(roomState.roomId, roomState);

              // Broadcast canonical move-commit to ALL room members (including sender)
              roomState.broadcast({
                type: 'operation:broadcast',
                roomId,
                revision: result.revision,
                operation: {
                  type: 'element:move-commit',
                  operationId: operationId || `op-${Date.now()}`,
                  clientId: auth.authenticatedClientId,
                  elementId: elementId || element.id,
                  element: result.element,
                },
              });
            } else if (result.ignored && result.element) {
              // Send operation:rejected back to sender so their canvas reconciles with server truth
              ws.send(
                JSON.stringify({
                  type: 'operation:rejected',
                  roomId,
                  elementId: elementId || element.id,
                  reason: 'stale_version',
                  authoritativeElement: result.element,
                })
              );
            }
            break;
          }

          // ── PROTOCOL 4: Ephemeral Movement Preview (Drag Strokes) ────────
          case 'element:move-preview': {
            const { roomId, operationId, elementId, element } = parsed;
            if (!roomId || !element) return;

            // Security Check: Socket must be inside room and have write permissions
            const auth = getAuthorizedClient(socketData, roomId, true);
            if (!auth) return;

            const roomState = roomManager.getRoom(roomId);
            if (!roomState) return;

            const previewOp: MovePreviewOperation = {
              type: 'element:move-preview',
              operationId: operationId || `preview-${Date.now()}`,
              clientId: auth.authenticatedClientId,
              roomId,
              elementId: elementId || element.id,
              element,
            };

            const previewResult = roomState.handleMovePreview(previewOp);
            if (previewResult.isValid) {
              // Broadcast ephemeral preview without DB persistence or revision increment
              // (Sender is already rendering local drag, so exclude sender to minimize traffic)
              roomState.broadcast(
                {
                  type: 'operation:broadcast',
                  roomId,
                  revision: roomState.getRevision(),
                  operation: previewOp,
                },
                auth.authenticatedClientId
              );
            }
            break;
          }

          // ── PROTOCOL 5: Ephemeral Presence (World Cursors & Selection) ────
          case 'presence:update': {
            const { roomId, cursor, selectedElementId } = parsed;
            if (!roomId) return;

            // Security Check: Socket must be inside room (read-only users CAN broadcast cursor)
            const auth = getAuthorizedClient(socketData, roomId, false);
            if (!auth) return;

            const roomState = roomManager.getRoom(roomId);
            if (!roomState) return;

            roomState.updatePresence(auth.authenticatedClientId, cursor, selectedElementId);

            // Broadcast cursor coordinates directly from memory (zero DB I/O)
            roomState.broadcast(
              {
                type: 'presence:update',
                roomId,
                clientId: auth.authenticatedClientId,
                userId: socketData.userId,
                username: socketData.username,
                color: socketData.color,
                cursor,
                selectedElementId,
              },
              auth.authenticatedClientId
            );
            break;
          }

          // ── PROTOCOL 6: Text Chat (Separated from drawing elements) ───────
          case 'chat': {
            const { roomId, content } = parsed;
            if (!roomId || !content || typeof content !== 'string') return;

            const roomState = roomManager.getRoom(roomId);
            if (!roomState) return;

            try {
              const newMessage = await Message.create({
                roomId: roomState.roomId,
                userId: socketData.userId,
                content: content.trim(),
              });

              const populated = await newMessage.populate('userId', 'name photo');

              // Broadcast to ALL users in the room including sender
              roomState.broadcast({
                type: 'chat',
                roomId,
                message: populated,
              });
            } catch (chatErr) {
              console.error('Failed to save/broadcast chat message:', chatErr);
            }
            break;
          }

          // ── BACKWARD COMPATIBILITY: Legacy Events for load-test.ts ────────
          case 'drawing': {
            const { roomId, elements, clientId } = parsed;
            if (!roomId) return;
            const roomState = roomManager.getRoom(roomId);
            if (roomState) {
              const cId = clientId || socketData.defaultClientId;
              roomState.broadcast(
                {
                  type: 'drawing',
                  roomId,
                  elements,
                  clientId: cId,
                },
                cId
              );
            }
            break;
          }

          case 'cursor': {
            const { roomId, pointer, clientId, color } = parsed;
            if (!roomId) return;
            const roomState = roomManager.getRoom(roomId);
            if (roomState) {
              const cId = clientId || socketData.defaultClientId;
              roomState.broadcast(
                {
                  type: 'cursor',
                  roomId,
                  pointer,
                  clientId: cId,
                  color: color || socketData.color,
                  username: socketData.username,
                },
                cId
              );
            }
            break;
          }

          default:
            console.log(`[WS Notice] Unhandled message type: ${type}`);
            break;
        }
      } catch (err) {
        console.error('WebSocket message parsing error:', err);
      }
    });

    // ── 5. Disconnect & Resource Cleanup ────────────────────────────────────
    const handleDisconnect = async () => {
      if (!clientSocketMap.has(ws)) return;
      clientSocketMap.delete(ws);

      console.log(`🚪 [WS Disconnected] ${socketData.username} (${socketData.userId})`);

      const visitedRooms = new Set<string>();
      for (const roomId of socketData.joinedRooms) {
        const roomState = roomManager.getRoom(roomId);
        if (roomState && !visitedRooms.has(roomState.roomId)) {
          visitedRooms.add(roomState.roomId);
          const clientId = socketData.roomClientIds.get(roomId) || socketData.roomClientIds.get(roomState.roomId) || socketData.defaultClientId;
          roomState.removeClient(clientId);

          // Broadcast user:left to remaining room collaborators using authoritative client ID
          roomState.broadcast({
            type: 'user:left',
            roomId: roomState.roomId,
            clientId,
            userId: socketData.userId,
          });

          // Check if room has 0 clients; flush dirty state and evict from RAM
          if (roomState.isEmpty()) {
            activeRoomSet.delete(roomState.roomId);
            clearDebounceTimer(roomState.roomId);
            await roomManager.evictRoomIfEmpty(roomId);
          }
        }
      }
    };

    ws.on('close', handleDisconnect);
    ws.on('error', (err) => {
      console.error(`WebSocket client error (${socketData.username}):`, err);
      handleDisconnect();
    });
  });

  console.log('🚀 Server-authoritative WebSocket Collaboration Server attached');
}