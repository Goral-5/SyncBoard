import mongoose, { Schema, Document } from 'mongoose';
import { RoomSnapshot, ElementMutationResult, RoomRevision } from '../types/room';

export type { RoomSnapshot, ElementMutationResult, RoomRevision };

// ==========================================
// 1. Persistent Database Types & Mongoose Model
// ==========================================

export interface IRoom extends Document {
  slug: string;
  adminId: mongoose.Types.ObjectId;
  collaborators: mongoose.Types.ObjectId[];
  elements: any[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const roomSchema = new Schema<IRoom>(
  {
    slug: { type: String, required: true, unique: true },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    collaborators: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    elements: { type: Schema.Types.Mixed, default: [] },
    version: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

export const Room = mongoose.model<IRoom>('Room', roomSchema);
export const RoomModel = Room;

// ==========================================
// 3. Server-Authoritative In-Memory RoomState Class
// ==========================================

/**
 * RoomState owns the server-authoritative in-memory state of an active collaborative board.
 * It encapsulates elements, monotonic revisions, connected client IDs, and persistence flags.
 */
export class RoomState {
  public readonly roomId: string;
  private elements: Map<string, any>;
  private revision: number;
  private clients: Set<string>;
  private dirty: boolean;
  private lastActivity: number;

  constructor(roomId: string, initialElements: any[] = [], initialRevision: number = 0) {
    this.roomId = roomId;
    this.elements = new Map<string, any>();
    this.clients = new Set<string>();
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
  public getElements(): any[] {
    return Array.from(this.elements.values());
  }

  /**
   * Retrieves a single element by its unique ID.
   */
  public getElement(id: string): any | undefined {
    return this.elements.get(id);
  }

  /**
   * Checks whether an element exists in the room.
   */
  public hasElement(id: string): boolean {
    return this.elements.has(id);
  }

  /**
   * Replaces all elements with a new element array, increments the revision,
   * marks the room dirty, and updates last activity timestamp.
   */
  public setElements(elements: any[]): void {
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
  public createElement(element: any): ElementMutationResult {
    if (!element || !element.id) {
      return {
        success: false,
        revision: this.revision,
        error: 'Invalid element: missing element or element.id',
      };
    }

    this.elements.set(element.id, { ...element });
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
  public updateElement(incoming: any): ElementMutationResult {
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
    this.elements.set(incoming.id, { ...incoming });
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
  public deleteElement(id: string): ElementMutationResult {
    const existing = this.elements.get(id);

    if (!existing) {
      return {
        success: false,
        revision: this.revision,
        error: `Element ${id} not found`,
      };
    }

    const updated = {
      ...existing,
      isDeleted: true,
      version: (typeof existing.version === 'number' ? existing.version : 0) + 1,
    };

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

  public getRevision(): number {
    return this.revision;
  }

  public isDirty(): boolean {
    return this.dirty;
  }

  public markClean(): void {
    this.dirty = false;
  }

  public getLastActivity(): number {
    return this.lastActivity;
  }

  // --- Snapshot Management ---

  /**
   * Returns a persistent board snapshot containing board elements and revision.
   * Free of ephemeral presence, sockets, or cursors.
   */
  public getSnapshot(): RoomSnapshot {
    return {
      roomId: this.roomId,
      revision: this.revision,
      elements: this.getElements(),
    };
  }

  /**
   * Replaces in-memory elements and revision from a persistent snapshot.
   */
  public loadSnapshot(snapshot: { revision?: number; elements: any[] }): void {
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

  public addClient(clientId: string): void {
    this.clients.add(clientId);
    this.lastActivity = Date.now();
  }

  public removeClient(clientId: string): void {
    this.clients.delete(clientId);
    this.lastActivity = Date.now();
  }

  public getClients(): string[] {
    return Array.from(this.clients);
  }

  public hasClient(clientId: string): boolean {
    return this.clients.has(clientId);
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  public isEmpty(): boolean {
    return this.clients.size === 0;
  }
}

export { RoomState as RoomInMemory };