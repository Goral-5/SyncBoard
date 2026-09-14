import { WebSocket } from 'ws';
import mongoose from 'mongoose';
import { Room, IRoom } from '../models/Room';
import {
  CursorCoordinates,
  UserPresence,
  ElementMutationResult,
  ElementOperation,
  MovePreviewOperation,
  RoomSnapshot,
  RoomRevision
} from '../types/room';

// ============================================================================
// ARCHITECTURE NOTE (FOR INTERVIEWS):
// Why do we maintain an In-Memory RoomState instead of querying MongoDB?
//
// In collaborative whiteboards, users trigger high-frequency events (mouse drags,
// drawing strokes, element movement) at 20-60 updates per second.
// If every event hit MongoDB Atlas:
// 1. Network round-trip latency (50-200ms) would make the board feel laggy.
// 2. Database connection pools and disk I/O would quickly saturate.
//
// By keeping the active board state in RAM (using fast JavaScript Maps):
// - Element lookups and conflict checks resolve in O(1) time (~0.01ms).
// - WebSocket broadcasts happen with near-zero latency.
// - MongoDB is only touched during "Cold Starts" (room loading) and "Debounced Saves".
// ============================================================================

export interface ClientSession {
  clientId: string;
  userId: string;
  username: string;
  color: string;
  ws: WebSocket;
  cursor?: CursorCoordinates | null;
  selectedElementId?: string | null;
  lastActive: number;
}

/**
 * RoomState manages the authoritative in-memory state of a single active whiteboard.
 */
export class RoomState {
  public readonly roomId: string;

  // The single source of truth for canvas shapes while the room is active in RAM.
  // Using a Map provides O(1) lookups and updates by element ID.
  private elements: Map<string, any>;

  // Monotonic board revision counter. Increments ONLY on accepted persistent mutations.
  private revision: number;

  // Connected users currently inside this room.
  private clients: Map<string, ClientSession>;

  // Bounded ring-buffer of recent operations (useful for fast catch-up on reconnect).
  private recentOperations: ElementOperation[];
  private readonly MAX_RECENT_OPS = 200;

  // Dirty flag indicates changes in RAM that haven't yet been flushed to MongoDB.
  private dirty: boolean;
  private lastActivity: number;

  constructor(roomId: string, initialElements: any[] = [], initialRevision: number = 0) {
    this.roomId = roomId;
    this.elements = new Map<string, any>();
    this.clients = new Map<string, ClientSession>();
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
  public createElement(element: any, operationId?: string, clientId?: string): ElementMutationResult {
    if (!element || !element.id) {
      return {
        success: false,
        revision: this.revision,
        error: 'Invalid element: missing element or element.id'
      };
    }

    this.elements.set(element.id, { ...element });
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
    } as any);

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
  public updateElement(incoming: any, operationId?: string, clientId?: string): ElementMutationResult {
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
    this.elements.set(incoming.id, { ...incoming });
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
    } as any);

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
  public deleteElement(id: string, operationId?: string, clientId?: string): ElementMutationResult {
    const existing = this.elements.get(id);

    if (!existing) {
      return {
        success: false,
        revision: this.revision,
        error: `Element ${id} not found`
      };
    }

    const updated = {
      ...existing,
      isDeleted: true,
      version: (typeof existing.version === 'number' ? existing.version : 0) + 1,
      versionNonce: Date.now()
    };

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
    } as any);

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
  public commitMove(element: any, operationId?: string, clientId?: string): ElementMutationResult {
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
  public handleMovePreview(op: MovePreviewOperation): { isValid: boolean; operation?: MovePreviewOperation } {
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

  public addClient(session: ClientSession): void {
    this.clients.set(session.clientId, session);
    this.lastActivity = Date.now();
  }

  public removeClient(clientId: string): boolean {
    const existed = this.clients.delete(clientId);
    if (existed) {
      this.lastActivity = Date.now();
    }
    return existed;
  }

  public getClient(clientId: string): ClientSession | undefined {
    return this.clients.get(clientId);
  }

  public getClients(): ClientSession[] {
    return Array.from(this.clients.values());
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  public isEmpty(): boolean {
    return this.clients.size === 0;
  }

  /**
   * Updates temporary cursor position or element selection for a user.
   * Never touches the database!
   */
  public updatePresence(
    clientId: string,
    cursor?: CursorCoordinates | null,
    selectedElementId?: string | null
  ): UserPresence | null {
    const client = this.clients.get(clientId);
    if (!client) return null;

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
  public getPresenceList(): UserPresence[] {
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
  public broadcast(payload: any, excludeClientId?: string): void {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);

    for (const client of this.clients.values()) {
      if (client.clientId !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(data);
        } catch (err) {
          console.error(`Failed to send to client ${client.clientId}:`, err);
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // 4. Persistence & Snapshot Handling
  // --------------------------------------------------------------------------

  public isDirty(): boolean {
    return this.dirty;
  }

  public getRevision(): number {
    return this.revision;
  }

  public getLastActivity(): number {
    return this.lastActivity;
  }

  public getElements(): any[] {
    return Array.from(this.elements.values());
  }

  public getElement(id: string): any | undefined {
    return this.elements.get(id);
  }

  public getSnapshot(): RoomSnapshot {
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
  public async persistToDatabase(): Promise<boolean> {
    if (!this.dirty) {
      return false; // Nothing changed, save disk I/O
    }

    try {
      const isValidId = mongoose.Types.ObjectId.isValid(this.roomId) && /^[0-9a-fA-F]{24}$/.test(this.roomId);
      const query = isValidId ? { $or: [{ _id: this.roomId }, { slug: this.roomId }] } : { slug: this.roomId };

      await Room.updateOne(query, {
        $set: {
          elements: this.getElements(),
          version: this.revision
        }
      });

      this.dirty = false;
      console.log(`💾 [Persist] Saved room ${this.roomId} to MongoDB (revision ${this.revision}, ${this.elements.size} elements)`);
      return true;
    } catch (err) {
      console.error(`❌ [Persist Error] Failed to persist room ${this.roomId}:`, err);
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // 5. Recent Operations Ring-Buffer (For Fast Catchup)
  // --------------------------------------------------------------------------

  private recordOperation(op: ElementOperation): void {
    this.recentOperations.push(op);
    if (this.recentOperations.length > this.MAX_RECENT_OPS) {
      this.recentOperations.shift();
    }
  }

  public getMissingOperations(sinceRevision: number): ElementOperation[] | null {
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

// ============================================================================
// RoomManager: Central In-Memory Registry of Active Collaborative Rooms
// ============================================================================

export class RoomManager {
  private rooms: Map<string, RoomState>;

  constructor() {
    this.rooms = new Map<string, RoomState>();
  }

  /**
   * Retrieves an active room from memory, or loads it from MongoDB if cold.
   */
  public async getOrCreateRoom(roomId: string): Promise<RoomState | null> {
    // 1. FAST PATH: Room is already hot in RAM
    if (this.rooms.has(roomId)) {
      return this.rooms.get(roomId)!;
    }

    // 2. COLD PATH: Load from MongoDB once
    try {
      const isValidId = mongoose.Types.ObjectId.isValid(roomId) && /^[0-9a-fA-F]{24}$/.test(roomId);
      const query = isValidId ? { $or: [{ _id: roomId }, { slug: roomId }] } : { slug: roomId };

      const roomDoc = await Room.findOne(query);
      if (!roomDoc) {
        return null;
      }

      const canonicalId = String((roomDoc as any)._id);

      // Check if another async call loaded it in the meantime
      if (this.rooms.has(canonicalId)) {
        return this.rooms.get(canonicalId)!;
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
    } catch (err) {
      console.error(`❌ [RoomManager] Failed to load room ${roomId} from DB:`, err);
      return null;
    }
  }

  /**
   * Synchronous memory lookup (does not query database).
   */
  public getRoom(roomId: string): RoomState | undefined {
    return this.rooms.get(roomId);
  }

  public hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  public getActiveRoomCount(): number {
    // Unique RoomStates
    return new Set(this.rooms.values()).size;
  }

  /**
   * Evicts an inactive room from RAM when all users have disconnected.
   * Ensures any unsaved dirty state is persisted to MongoDB before eviction.
   */
  public async evictRoomIfEmpty(roomId: string): Promise<boolean> {
    const roomState = this.rooms.get(roomId);
    if (!roomState) return false;

    if (roomState.isEmpty()) {
      // 1. Flush any dirty state to MongoDB
      if (roomState.isDirty()) {
        await roomState.persistToDatabase();
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
  }
}

// Global Singleton Instance
export const roomManager = new RoomManager();
