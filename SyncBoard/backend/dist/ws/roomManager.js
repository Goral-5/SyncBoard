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
exports.roomManager = exports.RoomState = void 0;
exports.reconcileElement = reconcileElement;
const ws_1 = require("ws");
const mongoose_1 = __importDefault(require("mongoose"));
const Room_1 = require("../models/Room");
function reconcileElement(existing, incoming) {
    var _a, _b, _c, _d;
    if (!existing)
        return incoming;
    const existingVersion = (_a = existing.version) !== null && _a !== void 0 ? _a : 0;
    const incomingVersion = (_b = incoming.version) !== null && _b !== void 0 ? _b : 0;
    // 1. Higher version strictly wins
    if (incomingVersion > existingVersion)
        return incoming;
    if (incomingVersion < existingVersion)
        return existing;
    // 2. Same version: versionNonce tie-breaker
    const existingNonce = (_c = existing.versionNonce) !== null && _c !== void 0 ? _c : 0;
    const incomingNonce = (_d = incoming.versionNonce) !== null && _d !== void 0 ? _d : 0;
    if (incomingNonce > existingNonce)
        return incoming;
    return existing;
}
class RoomState {
    constructor(roomId, slug, initialElements = [], initialVersion = 0) {
        this.elements = new Map();
        this.version = 0;
        this.clients = new Map();
        this.recentOperations = [];
        this.MAX_RING_BUFFER = 200;
        this.dirty = false;
        this.debounceTimer = null;
        this.periodicTimer = null;
        this.lastActivity = Date.now();
        this.roomId = roomId;
        this.slug = slug;
        this.version = initialVersion;
        // Populate in-memory map
        for (const el of initialElements) {
            if (el && el.id) {
                this.elements.set(el.id, el);
            }
        }
        // Periodic persistence check every 15 seconds
        this.periodicTimer = setInterval(() => {
            if (this.dirty) {
                this.persistToDatabase().catch((err) => console.error(`[Room ${this.roomId}] Periodic persist error:`, err));
            }
        }, 15000);
    }
    getElementsArray() {
        return Array.from(this.elements.values());
    }
    getUsersList() {
        const list = [];
        for (const session of this.clients.values()) {
            list.push({
                clientId: session.clientId,
                userId: session.userId,
                username: session.username,
                color: session.color,
            });
        }
        return list;
    }
    addClient(session) {
        this.clients.set(session.ws, session);
        session.joinedRooms.add(this.roomId);
    }
    removeClient(ws) {
        return __awaiter(this, void 0, void 0, function* () {
            const session = this.clients.get(ws);
            if (!session)
                return null;
            this.clients.delete(ws);
            session.joinedRooms.delete(this.roomId);
            // If room is now empty, immediately persist and signal eviction
            if (this.clients.size === 0) {
                try {
                    yield this.persistToDatabase();
                }
                catch (err) {
                    console.error(`[Room ${this.roomId}] Error saving on last disconnect:`, err);
                }
                this.destroy();
                exports.roomManager.evictRoom(this.roomId);
            }
            return session;
        });
    }
    applyOperation(op) {
        var _a, _b, _c;
        this.lastActivity = Date.now();
        // 1. Move preview: intermediate dragging position, does NOT increment version or mark dirty
        if (op.type === 'element:move-preview') {
            this.elements.set(op.elementId, op.element);
            return { accepted: true, revision: this.version, element: op.element };
        }
        // 2. Element delete: soft deletion with isDeleted: true
        if (op.type === 'element:delete') {
            const existing = this.elements.get(op.elementId);
            const deletedElement = Object.assign(Object.assign({}, (existing || op.element)), { isDeleted: true, version: Math.max(((_a = existing === null || existing === void 0 ? void 0 : existing.version) !== null && _a !== void 0 ? _a : 0) + 1, ((_c = (_b = op.element) === null || _b === void 0 ? void 0 : _b.version) !== null && _c !== void 0 ? _c : 0) + 1), versionNonce: Math.floor(Math.random() * 1000000) });
            this.elements.set(op.elementId, deletedElement);
            this.version++;
            op.revision = this.version;
            op.timestamp = Date.now();
            op.element = deletedElement;
            this.recordRecentOperation(op);
            this.markDirty();
            return { accepted: true, revision: this.version, element: deletedElement };
        }
        // 3. Create, Update, Move-commit: deterministic reconciliation
        const existing = this.elements.get(op.elementId);
        const winning = reconcileElement(existing, op.element);
        if (winning === op.element) {
            this.elements.set(op.elementId, winning);
            this.version++;
            op.revision = this.version;
            op.timestamp = Date.now();
            this.recordRecentOperation(op);
            this.markDirty();
            return { accepted: true, revision: this.version, element: winning };
        }
        // Stale operation rejected
        return { accepted: false, revision: this.version, element: existing };
    }
    recordRecentOperation(op) {
        this.recentOperations.push(op);
        if (this.recentOperations.length > this.MAX_RING_BUFFER) {
            this.recentOperations.shift();
        }
    }
    getOperationsSince(clientVersion) {
        var _a;
        if (clientVersion === this.version) {
            return [];
        }
        if (this.recentOperations.length === 0) {
            return null;
        }
        const oldest = this.recentOperations[0];
        const oldestRevision = (_a = oldest.revision) !== null && _a !== void 0 ? _a : 1;
        // Check if the client's last known version is covered by our buffer
        if (clientVersion >= oldestRevision - 1) {
            return this.recentOperations.filter((op) => { var _a; return ((_a = op.revision) !== null && _a !== void 0 ? _a : 0) > clientVersion; });
        }
        // Client is too far behind, requires full sync
        return null;
    }
    markDirty() {
        this.dirty = true;
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.persistToDatabase().catch((err) => console.error(`[Room ${this.roomId}] Debounced persist error:`, err));
        }, 1000);
    }
    persistToDatabase() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
                this.debounceTimer = null;
            }
            if (!this.dirty)
                return;
            const elementsArray = this.getElementsArray();
            const version = this.version;
            try {
                yield Room_1.Room.findByIdAndUpdate(this.roomId, {
                    $set: {
                        elements: elementsArray,
                        version: version,
                    },
                });
                this.dirty = false;
                console.log(`💾 [Room ${this.roomId}] Persisted ${elementsArray.length} elements (ver: ${version}) to MongoDB`);
            }
            catch (err) {
                console.error(`❌ [Room ${this.roomId}] Failed to persist to MongoDB:`, err);
                throw err;
            }
        });
    }
    broadcast(payload, exceptWs) {
        const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
        for (const [ws, session] of this.clients) {
            if (ws !== exceptWs && ws.readyState === ws_1.WebSocket.OPEN) {
                ws.send(raw);
            }
        }
    }
    destroy() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        if (this.periodicTimer) {
            clearInterval(this.periodicTimer);
            this.periodicTimer = null;
        }
    }
}
exports.RoomState = RoomState;
class RoomManagerSingleton {
    constructor() {
        this.rooms = new Map();
    }
    getOrCreateRoom(roomIdOrSlug) {
        return __awaiter(this, void 0, void 0, function* () {
            const isObjectId = mongoose_1.default.Types.ObjectId.isValid(roomIdOrSlug) && /^[0-9a-fA-F]{24}$/.test(roomIdOrSlug);
            // Check if already in memory by ID
            for (const [id, state] of this.rooms) {
                if (id === roomIdOrSlug || state.slug === roomIdOrSlug) {
                    return state;
                }
            }
            // Query MongoDB
            const room = yield Room_1.Room.findOne(isObjectId ? { $or: [{ _id: roomIdOrSlug }, { slug: roomIdOrSlug }] } : { slug: roomIdOrSlug });
            if (!room) {
                throw new Error(`Room not found: ${roomIdOrSlug}`);
            }
            const roomId = room._id.toString();
            // Check if roomId already exists in memory
            const existing = this.rooms.get(roomId);
            if (existing)
                return existing;
            const roomState = new RoomState(roomId, room.slug, room.elements || [], room.version || 0);
            this.rooms.set(roomId, roomState);
            console.log(`✨ [RoomManager] Loaded room '${room.slug}' (${roomId}) into memory with ${roomState.elements.size} elements`);
            return roomState;
        });
    }
    getRoom(roomId) {
        return this.rooms.get(roomId);
    }
    evictRoom(roomId) {
        const state = this.rooms.get(roomId);
        if (state) {
            state.destroy();
            this.rooms.delete(roomId);
            console.log(`🧹 [RoomManager] Evicted room ${roomId} from memory`);
        }
    }
    getAllRooms() {
        return this.rooms;
    }
}
exports.roomManager = new RoomManagerSingleton();
