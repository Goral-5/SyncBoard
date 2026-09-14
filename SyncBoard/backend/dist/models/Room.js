"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomInMemory = exports.RoomState = exports.RoomModel = exports.Room = void 0;
exports.getRoomUserRole = getRoomUserRole;
const mongoose_1 = __importStar(require("mongoose"));
const roomSchema = new mongoose_1.Schema({
    slug: { type: String, required: true, unique: true },
    adminId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User', required: true },
    collaborators: [{ type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User' }],
    elements: { type: mongoose_1.Schema.Types.Mixed, default: [] },
    version: { type: Number, default: 0 },
}, {
    timestamps: true,
});
roomSchema.index({ adminId: 1 });
exports.Room = mongoose_1.default.model('Room', roomSchema);
exports.RoomModel = exports.Room;
// -------------------------------------------------------------
// Quick permission helper:
// Checks who is calling:
// - Room owner (adminId) gets 'admin' rights (can edit, invite, delete room)
// - Invited teammate (in collaborators array) gets 'editor' rights (can draw and modify)
// - Anyone else returns null (access denied)
// -------------------------------------------------------------
function getRoomUserRole(room, userId) {
    var _a;
    if (!room || !userId)
        return null;
    const uid = userId.toString();
    const adminId = (((_a = room.adminId) === null || _a === void 0 ? void 0 : _a._id) || room.adminId).toString();
    if (adminId === uid)
        return 'admin';
    if (Array.isArray(room.collaborators)) {
        const isCollab = room.collaborators.some((c) => ((c === null || c === void 0 ? void 0 : c._id) || c).toString() === uid);
        if (isCollab)
            return 'editor';
    }
    return null;
}
// ==========================================
// 3. Server-Authoritative In-Memory RoomState Class
// ==========================================
/**
 * RoomState owns the server-authoritative in-memory state of an active collaborative board.
 * It encapsulates elements, monotonic revisions, connected client IDs, and persistence flags.
 */
class RoomState {
    constructor(roomId, initialElements = [], initialRevision = 0) {
        this.roomId = roomId;
        this.elements = new Map();
        this.clients = new Set();
        this.revision = initialRevision;
        this.dirty = false;
        this.lastActivity = Date.now();
        if (Array.isArray(initialElements) && initialElements.length > 0) {
            for (const el of initialElements) {
                if (el && el.id) {
                    this.elements.set(el.id, el);
                }
            }
        }
    }
    // --- Element Storage & Retrieval ---
    /**
     * Returns an array representation of all current elements.
     */
    getElements() {
        return Array.from(this.elements.values());
    }
    /**
     * Retrieves a single element by its unique ID.
     */
    getElement(id) {
        return this.elements.get(id);
    }
    /**
     * Checks whether an element exists in the room.
     */
    hasElement(id) {
        return this.elements.has(id);
    }
    /**
     * Replaces all elements with a new element array, increments the revision,
     * marks the room dirty, and updates last activity timestamp.
     */
    setElements(elements) {
        this.elements.clear();
        if (Array.isArray(elements)) {
            for (const el of elements) {
                if (el && el.id) {
                    this.elements.set(el.id, el);
                }
            }
        }
        this.revision++;
        this.dirty = true;
        this.lastActivity = Date.now();
    }
    // --- Element Mutations ---
    /**
     * Adds a new element to authoritative room state.
     */
    createElement(element) {
        if (!element || !element.id) {
            return {
                success: false,
                revision: this.revision,
                error: 'Invalid element: missing element or element.id',
            };
        }
        this.elements.set(element.id, Object.assign({}, element));
        this.revision++;
        this.dirty = true;
        this.lastActivity = Date.now();
        return {
            success: true,
            revision: this.revision,
            element: this.elements.get(element.id),
        };
    }
    /**
     * Updates an existing element in authoritative room state.
     * Performs deterministic version/versionNonce reconciliation:
     * Ignores stale incoming updates if the authoritative version is newer.
     */
    updateElement(incoming) {
        if (!incoming || !incoming.id) {
            return {
                success: false,
                revision: this.revision,
                error: 'Invalid element: missing incoming element or incoming.id',
            };
        }
        const existing = this.elements.get(incoming.id);
        if (existing) {
            const existingVersion = typeof existing.version === 'number' ? existing.version : 0;
            const incomingVersion = typeof incoming.version === 'number' ? incoming.version : 0;
            // 1. Authoritative version is strictly newer: reject/ignore stale update
            if (existingVersion > incomingVersion) {
                return {
                    success: false,
                    ignored: true,
                    revision: this.revision,
                    element: existing,
                };
            }
            // 2. Same version: use Excalidraw versionNonce as tie-breaker
            if (existingVersion === incomingVersion) {
                const existingNonce = typeof existing.versionNonce === 'number' ? existing.versionNonce : 0;
                const incomingNonce = typeof incoming.versionNonce === 'number' ? incoming.versionNonce : 0;
                if (existingNonce > incomingNonce) {
                    return {
                        success: false,
                        ignored: true,
                        revision: this.revision,
                        element: existing,
                    };
                }
            }
        }
        // Accept incoming update
        this.elements.set(incoming.id, Object.assign({}, incoming));
        this.revision++;
        this.dirty = true;
        this.lastActivity = Date.now();
        return {
            success: true,
            revision: this.revision,
            element: this.elements.get(incoming.id),
        };
    }
    /**
     * Deletes an element from authoritative room state.
     * Preserves Excalidraw soft-deletion behavior (isDeleted = true) for synchronization convergence.
     */
    deleteElement(id) {
        const existing = this.elements.get(id);
        if (!existing) {
            return {
                success: false,
                revision: this.revision,
                error: `Element ${id} not found`,
            };
        }
        const updated = Object.assign(Object.assign({}, existing), { isDeleted: true, version: (typeof existing.version === 'number' ? existing.version : 0) + 1 });
        this.elements.set(id, updated);
        this.revision++;
        this.dirty = true;
        this.lastActivity = Date.now();
        return {
            success: true,
            revision: this.revision,
            element: updated,
        };
    }
    // --- Revision & Persistence Metadata ---
    getRevision() {
        return this.revision;
    }
    isDirty() {
        return this.dirty;
    }
    markClean() {
        this.dirty = false;
    }
    getLastActivity() {
        return this.lastActivity;
    }
    // --- Snapshot Management ---
    /**
     * Returns a persistent board snapshot containing board elements and revision.
     * Free of ephemeral presence, sockets, or cursors.
     */
    getSnapshot() {
        return {
            roomId: this.roomId,
            revision: this.revision,
            elements: this.getElements(),
        };
    }
    /**
     * Replaces in-memory elements and revision from a persistent snapshot.
     */
    loadSnapshot(snapshot) {
        this.elements.clear();
        if (Array.isArray(snapshot.elements)) {
            for (const el of snapshot.elements) {
                if (el && el.id) {
                    this.elements.set(el.id, el);
                }
            }
        }
        this.revision = typeof snapshot.revision === 'number' ? snapshot.revision : 0;
        this.dirty = false;
        this.lastActivity = Date.now();
    }
    // --- Ephemeral Client Management ---
    addClient(clientId) {
        this.clients.add(clientId);
        this.lastActivity = Date.now();
    }
    removeClient(clientId) {
        this.clients.delete(clientId);
        this.lastActivity = Date.now();
    }
    getClients() {
        return Array.from(this.clients);
    }
    hasClient(clientId) {
        return this.clients.has(clientId);
    }
    getClientCount() {
        return this.clients.size;
    }
    isEmpty() {
        return this.clients.size === 0;
    }
}
exports.RoomState = RoomState;
exports.RoomInMemory = RoomState;
