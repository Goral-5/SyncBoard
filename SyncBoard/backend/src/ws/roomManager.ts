import { WebSocket } from 'ws';
import mongoose from 'mongoose';
import { Room, IRoom } from '../models/Room';
import { ClientSession, ElementOperation, UserSummary } from '../types/room';

export function reconcileElement(existing: any | undefined, incoming: any): any {
  if (!existing) return incoming;

  const existingVersion = existing.version ?? 0;
  const incomingVersion = incoming.version ?? 0;

  // 1. Higher version strictly wins
  if (incomingVersion > existingVersion) return incoming;
  if (incomingVersion < existingVersion) return existing;

  // 2. Same version: versionNonce tie-breaker
  const existingNonce = existing.versionNonce ?? 0;
  const incomingNonce = incoming.versionNonce ?? 0;

  if (incomingNonce > existingNonce) return incoming;
  return existing;
}

export class RoomState {
  public roomId: string;
  public slug: string;
  public elements: Map<string, any> = new Map();
  public version: number = 0;
  public clients: Map<WebSocket, ClientSession> = new Map();
  public recentOperations: ElementOperation[] = [];
  public readonly MAX_RING_BUFFER = 200;

  private dirty: boolean = false;
  private debounceTimer: NodeJS.Timeout | null = null;
  private periodicTimer: NodeJS.Timeout | null = null;
  public lastActivity: number = Date.now();

  constructor(roomId: string, slug: string, initialElements: any[] = [], initialVersion: number = 0) {
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
        this.persistToDatabase().catch((err) =>
          console.error(`[Room ${this.roomId}] Periodic persist error:`, err)
        );
      }
    }, 15000);
  }

  public getElementsArray(): any[] {
    return Array.from(this.elements.values());
  }

  public getUsersList(): UserSummary[] {
    const list: UserSummary[] = [];
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

  public addClient(session: ClientSession): void {
    this.clients.set(session.ws, session);
    session.joinedRooms.add(this.roomId);
  }

  public async removeClient(ws: WebSocket): Promise<ClientSession | null> {
    const session = this.clients.get(ws);
    if (!session) return null;

    this.clients.delete(ws);
    session.joinedRooms.delete(this.roomId);

    // If room is now empty, immediately persist and signal eviction
    if (this.clients.size === 0) {
      try {
        await this.persistToDatabase();
      } catch (err) {
        console.error(`[Room ${this.roomId}] Error saving on last disconnect:`, err);
      }
      this.destroy();
      roomManager.evictRoom(this.roomId);
    }

    return session;
  }

  public applyOperation(op: ElementOperation): { accepted: boolean; revision: number; element: any } {
    this.lastActivity = Date.now();

    // 1. Move preview: intermediate dragging position, does NOT increment version or mark dirty
    if (op.type === 'element:move-preview') {
      this.elements.set(op.elementId, op.element);
      return { accepted: true, revision: this.version, element: op.element };
    }

    // 2. Element delete: soft deletion with isDeleted: true
    if (op.type === 'element:delete') {
      const existing = this.elements.get(op.elementId);
      const deletedElement = {
        ...(existing || op.element),
        isDeleted: true,
        version: Math.max((existing?.version ?? 0) + 1, (op.element?.version ?? 0) + 1),
        versionNonce: Math.floor(Math.random() * 1000000),
      };

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

  private recordRecentOperation(op: ElementOperation): void {
    this.recentOperations.push(op);
    if (this.recentOperations.length > this.MAX_RING_BUFFER) {
      this.recentOperations.shift();
    }
  }

  public getOperationsSince(clientVersion: number): ElementOperation[] | null {
    if (clientVersion === this.version) {
      return [];
    }

    if (this.recentOperations.length === 0) {
      return null;
    }

    const oldest = this.recentOperations[0];
    const oldestRevision = oldest.revision ?? 1;

    // Check if the client's last known version is covered by our buffer
    if (clientVersion >= oldestRevision - 1) {
      return this.recentOperations.filter((op) => (op.revision ?? 0) > clientVersion);
    }

    // Client is too far behind, requires full sync
    return null;
  }

  public markDirty(): void {
    this.dirty = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.persistToDatabase().catch((err) =>
        console.error(`[Room ${this.roomId}] Debounced persist error:`, err)
      );
    }, 1000);
  }

  public async persistToDatabase(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (!this.dirty) return;

    const elementsArray = this.getElementsArray();
    const version = this.version;

    try {
      await Room.findByIdAndUpdate(this.roomId, {
        $set: {
          elements: elementsArray,
          version: version,
        },
      });
      this.dirty = false;
      console.log(`💾 [Room ${this.roomId}] Persisted ${elementsArray.length} elements (ver: ${version}) to MongoDB`);
    } catch (err) {
      console.error(`❌ [Room ${this.roomId}] Failed to persist to MongoDB:`, err);
      throw err;
    }
  }

  public broadcast(payload: any, exceptWs?: WebSocket): void {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    for (const [ws, session] of this.clients) {
      if (ws !== exceptWs && ws.readyState === WebSocket.OPEN) {
        ws.send(raw);
      }
    }
  }

  public destroy(): void {
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

class RoomManagerSingleton {
  private rooms: Map<string, RoomState> = new Map();

  public async getOrCreateRoom(roomIdOrSlug: string): Promise<RoomState> {
    const isObjectId = mongoose.Types.ObjectId.isValid(roomIdOrSlug) && /^[0-9a-fA-F]{24}$/.test(roomIdOrSlug);

    // Check if already in memory by ID
    for (const [id, state] of this.rooms) {
      if (id === roomIdOrSlug || state.slug === roomIdOrSlug) {
        return state;
      }
    }

    // Query MongoDB
    const room = await Room.findOne(
      isObjectId ? { $or: [{ _id: roomIdOrSlug }, { slug: roomIdOrSlug }] } : { slug: roomIdOrSlug }
    );

    if (!room) {
      throw new Error(`Room not found: ${roomIdOrSlug}`);
    }

    const roomId = (room._id as any).toString();
    // Check if roomId already exists in memory
    const existing = this.rooms.get(roomId);
    if (existing) return existing;

    const roomState = new RoomState(
      roomId,
      room.slug,
      room.elements || [],
      room.version || 0
    );

    this.rooms.set(roomId, roomState);
    console.log(`✨ [RoomManager] Loaded room '${room.slug}' (${roomId}) into memory with ${roomState.elements.size} elements`);
    return roomState;
  }

  public getRoom(roomId: string): RoomState | undefined {
    return this.rooms.get(roomId);
  }

  public evictRoom(roomId: string): void {
    const state = this.rooms.get(roomId);
    if (state) {
      state.destroy();
      this.rooms.delete(roomId);
      console.log(`🧹 [RoomManager] Evicted room ${roomId} from memory`);
    }
  }

  public getAllRooms(): Map<string, RoomState> {
    return this.rooms;
  }
}

export const roomManager = new RoomManagerSingleton();
