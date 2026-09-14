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
exports.roomManager = exports.RoomManager = exports.RoomState = void 0;
const ws_1 = require("ws");
const mongoose_1 = __importDefault(require("mongoose"));
const Room_1 = require("../models/Room");
/**
 * RoomState manages the authoritative in-memory state of a single active whiteboard.
 */
class RoomState {
    constructor(roomId, initialElements = [], initialRevision = 0) {
        this.MAX_RECENT_OPS = 200;
        this.roomId = roomId;
        this.elements = new Map();
        this.clients = new Map();
        this.recentOperations = [];
        this.revision = initialRevision;
        this.dirty = false;
        this.lastActivity = Date.now();
        // Populate elements from the database snapshot
        if (Array.isArray(initialElements) && initialElements.length > 0) {
            for (const el of initialElements) {
                if (el && el.id) {
                    this.elements.set(el.id, el);
                }
            }
        }
    }
    // --------------------------------------------------------------------------
    // 1. Authoritative Element Mutations (Persistent Changes)
    // --------------------------------------------------------------------------
    /**
     * Adds a brand new element to the board.
     */
    createElement(element, operationId, clientId) {
        if (!element || !element.id) {
            return {
                success: false,
                revision: this.revision,
                error: 'Invalid element: missing element or element.id'
            };
        }
        this.elements.set(element.id, Object.assign({}, element));
        this.revision++;
        this.dirty = true;
        this.lastActivity = Date.now();
        const savedElement = this.elements.get(element.id);
        // Record in recent operations buffer
        this.recordOperation({
            type: 'element:create',
            operationId: operationId || `op-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            clientId: clientId || 'server',
            roomId: this.roomId,
            element: savedElement,
            timestamp: this.lastActivity
        });
        return {
            success: true,
            revision: this.revision,
            element: savedElement
        };
    }
    /**
     * Updates an existing element using deterministic conflict reconciliation:
     * 1. Higher element.version strictly wins.
     * 2. If versions are identical, higher versionNonce breaks the tie.
     * 3. Otherwise, the incoming update is stale and rejected.
     */
    updateElement(incoming, operationId, clientId) {
        if (!incoming || !incoming.id) {
            return {
                success: false,
                revision: this.revision,
                error: 'Invalid element: missing incoming element or incoming.id'
            };
        }
        const existing = this.elements.get(incoming.id);
        if (existing) {
            const existingVer = typeof existing.version === 'number' ? existing.version : 0;
            const incomingVer = typeof incoming.version === 'number' ? incoming.version : 0;
            // Rule 1: Authoritative version is strictly newer -> reject stale update
            if (existingVer > incomingVer) {
                return {
                    success: false,
                    ignored: true,
                    revision: this.revision,
                    element: existing
                };
            }
            // Rule 2: Versions match -> Excalidraw versionNonce tie-breaker (higher wins)
            if (existingVer === incomingVer) {
                const existingNonce = typeof existing.versionNonce === 'number' ? existing.versionNonce : 0;
                const incomingNonce = typeof incoming.versionNonce === 'number' ? incoming.versionNonce : 0;
                if (existingNonce >= incomingNonce) {
                    return {
                        success: false,
                        ignored: true,
                        revision: this.revision,
                        element: existing
                    };
                }
            }
        }
        // Accept incoming modification
        this.elements.set(incoming.id, Object.assign({}, incoming));
        this.revision++;
        this.dirty = true;
        this.lastActivity = Date.now();
        const savedElement = this.elements.get(incoming.id);
        this.recordOperation({
            type: 'element:update',
            operationId: operationId || `op-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            clientId: clientId || 'server',
            roomId: this.roomId,
            elementId: incoming.id,
            element: savedElement,
            timestamp: this.lastActivity
        });
        return {
            success: true,
            revision: this.revision,
            element: savedElement
        };
    }
    /**
     * Deletes an element from the board.
     * Following Excalidraw's design, we perform a soft-delete (isDeleted = true)
     * with an incremented element version so other clients learn about the deletion
     * deterministically without resurrection bugs.
     */
    deleteElement(id, operationId, clientId) {
        const existing = this.elements.get(id);
        if (!existing) {
            return {
                success: false,
                revision: this.revision,
                error: `Element ${id} not found`
            };
        }
        const updated = Object.assign(Object.assign({}, existing), { isDeleted: true, version: (typeof existing.version === 'number' ? existing.version : 0) + 1, versionNonce: Date.now() });
        this.elements.set(id, updated);
        this.revision++;
        this.dirty = true;
        this.lastActivity = Date.now();
        this.recordOperation({
            type: 'element:delete',
            operationId: operationId || `op-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            clientId: clientId || 'server',
            roomId: this.roomId,
            elementId: id,
            timestamp: this.lastActivity
        });
        return {
            success: true,
            revision: this.revision,
            element: updated
        };
    }
    /**
     * Commits the final position of an element when dragging ends (mouse release).
     * This is where a move becomes authoritative and gets scheduled for persistence.
     */
    commitMove(element, operationId, clientId) {
        return this.updateElement(element, operationId, clientId);
    }
    // --------------------------------------------------------------------------
    // 2. Ephemeral Movement Preview (Non-Authoritative Dragging)
    // --------------------------------------------------------------------------
    /**
     * Validates intermediate positions while a user is actively dragging.
     *
     * KEY ARCHITECTURAL DECISION:
     * We do NOT modify this.elements here.
     * We do NOT increment the board revision.
     * We do NOT set dirty = true.
     *
     * This keeps drag events completely ephemeral, avoiding useless database writes
     * while still giving other clients smooth real-time visual previews.
     */
    handleMovePreview(op) {
        if (!op || !op.element || !op.element.id) {
            return { isValid: false };
        }
        this.lastActivity = Date.now();
        return {
            isValid: true,
            operation: op
        };
    }
    // --------------------------------------------------------------------------
    // 3. Client Session & Presence Management
    // --------------------------------------------------------------------------
    addClient(session) {
        this.clients.set(session.clientId, session);
        this.lastActivity = Date.now();
    }
    removeClient(clientId) {
        const existed = this.clients.delete(clientId);
        if (existed) {
            this.lastActivity = Date.now();
        }
        return existed;
    }
    getClient(clientId) {
        return this.clients.get(clientId);
    }
    getClients() {
        return Array.from(this.clients.values());
    }
    getClientCount() {
        return this.clients.size;
    }
    isEmpty() {
        return this.clients.size === 0;
    }
    /**
     * Updates temporary cursor position or element selection for a user.
     * Never touches the database!
     */
    updatePresence(clientId, cursor, selectedElementId) {
        const client = this.clients.get(clientId);
        if (!client)
            return null;
        if (cursor !== undefined) {
            client.cursor = cursor;
        }
        if (selectedElementId !== undefined) {
            client.selectedElementId = selectedElementId;
        }
        client.lastActive = Date.now();
        return {
            userId: client.userId,
            clientId: client.clientId,
            username: client.username,
            color: client.color,
            cursor: client.cursor,
            selectedElementId: client.selectedElementId,
            lastActive: client.lastActive
        };
    }
    /**
     * Returns a snapshot of all active users in this room.
     */
    getPresenceList() {
        return Array.from(this.clients.values()).map(c => ({
            userId: c.userId,
            clientId: c.clientId,
            username: c.username,
            color: c.color,
            cursor: c.cursor,
            selectedElementId: c.selectedElementId,
            lastActive: c.lastActive
        }));
    }
    /**
     * Sends a message to all connected users in this room.
     * Optional excludeClientId parameter prevents echoing back to sender.
     */
    broadcast(payload, excludeClientId) {
        const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
        for (const client of this.clients.values()) {
            if (client.clientId !== excludeClientId && client.ws.readyState === ws_1.WebSocket.OPEN) {
                try {
                    client.ws.send(data);
                }
                catch (err) {
                    console.error(`Failed to send to client ${client.clientId}:`, err);
                }
            }
        }
    }
    // --------------------------------------------------------------------------
    // 4. Persistence & Snapshot Handling
    // --------------------------------------------------------------------------
    isDirty() {
        return this.dirty;
    }
    getRevision() {
        return this.revision;
    }
    getLastActivity() {
        return this.lastActivity;
    }
    getElements() {
        return Array.from(this.elements.values());
    }
    getElement(id) {
        return this.elements.get(id);
    }
    getSnapshot() {
        return {
            roomId: this.roomId,
            revision: this.revision,
            elements: this.getElements()
        };
    }
    /**
     * Flushes the authoritative in-memory state to MongoDB Atlas.
     * Resets the dirty flag once successfully saved.
     */
    persistToDatabase() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.dirty) {
                return false; // Nothing changed, save disk I/O
            }
            try {
                const isValidId = mongoose_1.default.Types.ObjectId.isValid(this.roomId) && /^[0-9a-fA-F]{24}$/.test(this.roomId);
                const query = isValidId ? { $or: [{ _id: this.roomId }, { slug: this.roomId }] } : { slug: this.roomId };
                yield Room_1.Room.updateOne(query, {
                    $set: {
                        elements: this.getElements(),
                        version: this.revision
                    }
                });
                this.dirty = false;
                console.log(`💾 [Persist] Saved room ${this.roomId} to MongoDB (revision ${this.revision}, ${this.elements.size} elements)`);
                return true;
            }
            catch (err) {
                console.error(`❌ [Persist Error] Failed to persist room ${this.roomId}:`, err);
                return false;
            }
        });
    }
    // --------------------------------------------------------------------------
    // 5. Recent Operations Ring-Buffer (For Fast Catchup)
    // --------------------------------------------------------------------------
    recordOperation(op) {
        this.recentOperations.push(op);
        if (this.recentOperations.length > this.MAX_RECENT_OPS) {
            this.recentOperations.shift();
        }
    }
    getMissingOperations(sinceRevision) {
        if (sinceRevision >= this.revision) {
            return []; // Already up to date
        }
        const missedCount = this.revision - sinceRevision;
        if (missedCount <= this.recentOperations.length) {
            return this.recentOperations.slice(-missedCount);
        }
        // Missed too many operations (fallen off buffer) -> requires full sync
        return null;
    }
}
exports.RoomState = RoomState;
// ============================================================================
// RoomManager: Central In-Memory Registry of Active Collaborative Rooms
// ============================================================================
class RoomManager {
    constructor() {
        this.rooms = new Map();
    }
    /**
     * Retrieves an active room from memory, or loads it from MongoDB if cold.
     */
    getOrCreateRoom(roomId) {
        return __awaiter(this, void 0, void 0, function* () {
            // 1. FAST PATH: Room is already hot in RAM
            if (this.rooms.has(roomId)) {
                return this.rooms.get(roomId);
            }
            // 2. COLD PATH: Load from MongoDB once
            try {
                const isValidId = mongoose_1.default.Types.ObjectId.isValid(roomId) && /^[0-9a-fA-F]{24}$/.test(roomId);
                const query = isValidId ? { $or: [{ _id: roomId }, { slug: roomId }] } : { slug: roomId };
                const roomDoc = yield Room_1.Room.findOne(query);
                if (!roomDoc) {
                    return null;
                }
                const canonicalId = String(roomDoc._id);
                // Check if another async call loaded it in the meantime
                if (this.rooms.has(canonicalId)) {
                    return this.rooms.get(canonicalId);
                }
                const initialElements = Array.isArray(roomDoc.elements) ? roomDoc.elements : [];
                const initialVersion = typeof roomDoc.version === 'number' ? roomDoc.version : 0;
                const roomState = new RoomState(canonicalId, initialElements, initialVersion);
                // Store by canonical ObjectId
                this.rooms.set(canonicalId, roomState);
                // Also alias by slug for fast lookup if different
                if (roomDoc.slug && roomDoc.slug !== canonicalId) {
                    this.rooms.set(roomDoc.slug, roomState);
                }
                console.log(`🏠 [RoomManager] Loaded room '${roomDoc.slug}' (${canonicalId}) into RAM with ${initialElements.length} elements (ver: ${initialVersion})`);
                return roomState;
            }
            catch (err) {
                console.error(`❌ [RoomManager] Failed to load room ${roomId} from DB:`, err);
                return null;
            }
        });
    }
    /**
     * Synchronous memory lookup (does not query database).
     */
    getRoom(roomId) {
        return this.rooms.get(roomId);
    }
    hasRoom(roomId) {
        return this.rooms.has(roomId);
    }
    getActiveRoomCount() {
        // Unique RoomStates
        return new Set(this.rooms.values()).size;
    }
    /**
     * Evicts an inactive room from RAM when all users have disconnected.
     * Ensures any unsaved dirty state is persisted to MongoDB before eviction.
     */
    evictRoomIfEmpty(roomId) {
        return __awaiter(this, void 0, void 0, function* () {
            const roomState = this.rooms.get(roomId);
            if (!roomState)
                return false;
            if (roomState.isEmpty()) {
                // 1. Flush any dirty state to MongoDB
                if (roomState.isDirty()) {
                    yield roomState.persistToDatabase();
                }
                // 2. Remove from active map to free RAM
                this.rooms.delete(roomState.roomId);
                // Clean up any slug alias
                for (const [key, val] of this.rooms.entries()) {
                    if (val === roomState) {
                        this.rooms.delete(key);
                    }
                }
                console.log(`🧹 [RoomManager] Evicted empty room ${roomState.roomId} from RAM.`);
                return true;
            }
            return false;
        });
    }
}
exports.RoomManager = RoomManager;
// Global Singleton Instance
exports.roomManager = new RoomManager();
