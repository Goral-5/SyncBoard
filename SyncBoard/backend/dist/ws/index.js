"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachWebSocketServer = attachWebSocketServer;
const ws_1 = require("ws");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const User_1 = require("../models/User");
const Message_1 = require("../models/Message");
const Room_1 = require("../models/Room");
const roomManager_1 = require("./roomManager");
const JWT_SECRET = process.env.JWT_SECRET;
const COLLABORATOR_COLORS = [
    '#FF5733', '#33B5E5', '#00C851', '#FFBB33',
    '#AA66CC', '#FF4444', '#2BBBAD', '#4285F4',
    '#E91E63', '#9C27B0', '#009688', '#FF9800'
];
function getRandomColor(index) {
    return COLLABORATOR_COLORS[index % COLLABORATOR_COLORS.length];
}
function verifyToken(token) {
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        return decoded;
    }
    catch (_a) {
        return null;
    }
}
function attachWebSocketServer(server) {
    const wss = new ws_1.WebSocketServer({ server });
    const activeSessions = new Map();
    let userCounter = 0;
    // ── Heartbeat interval to prune dead/zombie connections (every 30s) ─────────
    const heartbeatInterval = setInterval(() => {
        wss.clients.forEach((ws) => {
            const session = activeSessions.get(ws);
            if (!session) {
                return ws.terminate();
            }
            if (!session.isAlive) {
                console.log(`⏱️ Pruning dead connection for client: ${session.clientId} (user: ${session.username})`);
                return ws.terminate();
            }
            session.isAlive = false;
            ws.ping();
        });
    }, 30000);
    wss.on('close', () => {
        clearInterval(heartbeatInterval);
    });
    wss.on('connection', (ws, req) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const url = (_a = req.url) !== null && _a !== void 0 ? _a : '';
        const queryString = url.includes('?') ? url.split('?')[1] : '';
        const params = new URLSearchParams(queryString);
        const token = params.get('token') || '';
        const payload = verifyToken(token);
        if (!payload || !payload.userId) {
            console.log('❌ Connection rejected: Invalid or missing JWT token');
            ws.close(1008, 'Unauthorized');
            return;
        }
        const userId = payload.userId;
        let username = 'Collaborator';
        try {
            const dbUser = yield User_1.User.findById(userId).select('name');
            if (dbUser && dbUser.name) {
                username = dbUser.name;
            }
        }
        catch (err) {
            console.warn('Could not fetch username for session:', err);
        }
        userCounter++;
        const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const color = getRandomColor(userCounter);
        const session = {
            ws,
            clientId,
            userId,
            username,
            color,
            isAlive: true,
            joinedRooms: new Set(),
        };
        activeSessions.set(ws, session);
        console.log(`🔌 [WS Connected] Client: ${clientId}, User: ${username} (${userId})`);
        ws.on('pong', () => {
            session.isAlive = true;
        });
        ws.on('message', (data) => __awaiter(this, void 0, void 0, function* () {
            try {
                const rawString = typeof data === 'string' ? data : data.toString();
                const msg = JSON.parse(rawString);
                const type = msg.type;
                switch (type) {
                    // ── 1. Join Room ──────────────────────────────────────────────────
                    case 'room:join': {
                        const { roomId, lastKnownVersion } = msg;
                        if (!roomId)
                            return;
                        // Check room permissions in MongoDB
                        const perm = yield (0, Room_1.checkRoomPermission)(session.userId, roomId);
                        if (!perm.allowed || !perm.room) {
                            console.warn(`⛔ Unauthorized room:join attempt by ${session.userId} for room ${roomId}`);
                            ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized room access' }));
                            return;
                        }
                        const roomState = yield roomManager_1.roomManager.getOrCreateRoom(roomId);
                        roomState.addClient(session);
                        console.log(`👤 ${session.username} joined room: ${roomState.slug} (${roomState.roomId})`);
                        // Send initial room state to joining client
                        ws.send(JSON.stringify({
                            type: 'room:state',
                            roomId: roomState.roomId,
                            revision: roomState.version,
                            elements: roomState.getElementsArray(),
                            users: roomState.getUsersList(),
                        }));
                        // Broadcast user:joined to all other clients in room
                        roomState.broadcast({
                            type: 'user:joined',
                            roomId: roomState.roomId,
                            user: {
                                clientId: session.clientId,
                                userId: session.userId,
                                username: session.username,
                                color: session.color,
                            },
                        }, ws);
                        break;
                    }
                    // ── 2. Incremental Sync / Reconnect ──────────────────────────────
                    case 'room:sync-request': {
                        const { roomId, lastKnownVersion } = msg;
                        if (!roomId)
                            return;
                        let roomState = roomManager_1.roomManager.getRoom(roomId);
                        if (!roomState) {
                            roomState = yield roomManager_1.roomManager.getOrCreateRoom(roomId);
                        }
                        const clientVer = typeof lastKnownVersion === 'number' ? lastKnownVersion : -1;
                        const missedOps = roomState.getOperationsSince(clientVer);
                        if (missedOps !== null) {
                            // Incremental catch-up
                            ws.send(JSON.stringify({
                                type: 'room:sync',
                                roomId: roomState.roomId,
                                revision: roomState.version,
                                fullSync: false,
                                operations: missedOps,
                            }));
                        }
                        else {
                            // Full resync fallback
                            ws.send(JSON.stringify({
                                type: 'room:sync',
                                roomId: roomState.roomId,
                                revision: roomState.version,
                                fullSync: true,
                                elements: roomState.getElementsArray(),
                            }));
                        }
                        break;
                    }
                    // ── 3. Differential Element Operations ────────────────────────────
                    case 'element:create':
                    case 'element:update':
                    case 'element:delete':
                    case 'element:move-preview':
                    case 'element:move-commit': {
                        const { roomId, operationId, elementId, element } = msg;
                        if (!roomId || !elementId)
                            return;
                        const roomState = roomManager_1.roomManager.getRoom(roomId);
                        if (!roomState) {
                            console.warn(`Operation received for non-active room: ${roomId}`);
                            return;
                        }
                        const operation = {
                            type,
                            operationId: operationId || `op_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                            roomId: roomState.roomId,
                            clientId: session.clientId,
                            elementId,
                            element,
                        };
                        const result = roomState.applyOperation(operation);
                        if (result.accepted) {
                            // Broadcast winning operation to all other clients in the room
                            roomState.broadcast({
                                type: 'operation:broadcast',
                                roomId: roomState.roomId,
                                revision: result.revision,
                                operation: Object.assign(Object.assign({}, operation), { element: result.element }),
                            }, ws);
                        }
                        break;
                    }
                    // ── 4. Ephemeral Presence Update (Cursors & Selection) ───────────
                    case 'presence:update': {
                        const { roomId, cursor, selectedElementId } = msg;
                        if (!roomId)
                            return;
                        const roomState = roomManager_1.roomManager.getRoom(roomId);
                        if (!roomState)
                            return;
                        session.cursor = cursor;
                        session.selectedElementId = selectedElementId;
                        // Zero DB overhead: broadcast directly from in-memory session
                        roomState.broadcast({
                            type: 'presence:update',
                            roomId: roomState.roomId,
                            clientId: session.clientId,
                            userId: session.userId,
                            username: session.username,
                            color: session.color,
                            cursor,
                            selectedElementId,
                        }, ws);
                        break;
                    }
                    // ── 5. Room Chat ──────────────────────────────────────────────────
                    case 'chat': {
                        const { roomId, content } = msg;
                        if (!roomId || !content || typeof content !== 'string')
                            return;
                        const roomState = roomManager_1.roomManager.getRoom(roomId);
                        if (!roomState)
                            return;
                        try {
                            const newMessage = yield Message_1.Message.create({
                                roomId,
                                userId: session.userId,
                                content: content.trim(),
                            });
                            const populated = yield newMessage.populate('userId', 'name photo');
                            // Broadcast to ALL users in the room (including sender)
                            roomState.broadcast({
                                type: 'chat',
                                roomId: roomState.roomId,
                                message: populated,
                            });
                        }
                        catch (chatErr) {
                            console.error('Failed to save and broadcast chat message:', chatErr);
                        }
                        break;
                    }
                    // ── Backward compatibility for legacy clients ─────────────────────
                    case 'join_room': {
                        const { roomId } = msg;
                        if (!roomId)
                            return;
                        const roomState = yield roomManager_1.roomManager.getOrCreateRoom(roomId);
                        roomState.addClient(session);
                        break;
                    }
                    case 'drawing': {
                        const { roomId, elements } = msg;
                        if (!roomId)
                            return;
                        const roomState = roomManager_1.roomManager.getRoom(roomId);
                        if (roomState) {
                            roomState.broadcast({
                                type: 'drawing',
                                roomId,
                                elements,
                                clientId: session.clientId,
                            }, ws);
                        }
                        break;
                    }
                    case 'cursor': {
                        const { roomId, pointer, color } = msg;
                        if (!roomId)
                            return;
                        const roomState = roomManager_1.roomManager.getRoom(roomId);
                        if (roomState) {
                            roomState.broadcast({
                                type: 'cursor',
                                roomId,
                                pointer,
                                clientId: session.clientId,
                                color: color || session.color,
                                username: session.username,
                            }, ws);
                        }
                        break;
                    }
                    default:
                        console.log(`Unknown message type received: ${type}`);
                        break;
                }
            }
            catch (err) {
                console.error('Error handling WebSocket message:', err);
            }
        }));
        const handleDisconnect = () => __awaiter(this, void 0, void 0, function* () {
            const currentSession = activeSessions.get(ws);
            if (!currentSession)
                return;
            activeSessions.delete(ws);
            console.log(`🚪 [WS Disconnected] ${currentSession.username} (${currentSession.clientId})`);
            for (const roomId of currentSession.joinedRooms) {
                const roomState = roomManager_1.roomManager.getRoom(roomId);
                if (roomState) {
                    yield roomState.removeClient(ws);
                    // Broadcast user:left to remaining clients
                    roomState.broadcast({
                        type: 'user:left',
                        roomId: roomState.roomId,
                        clientId: currentSession.clientId,
                        userId: currentSession.userId,
                    });
                }
            }
        });
        ws.on('close', handleDisconnect);
        ws.on('error', (err) => {
            console.error(`WebSocket client error (${session.clientId}):`, err);
            handleDisconnect();
        });
    }));
    console.log('🚀 Server-authoritative WebSocket Collaboration Server attached');
}
