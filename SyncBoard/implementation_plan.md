# SyncBoard: 9-Phase 3-Member Collaborative Architecture Plan & Universal Prompt

## Project Goal & Architecture Overview

SyncBoard is a real-time multiplayer whiteboard application powered by **Excalidraw** on the frontend, **Node.js/Express + Native WebSocket (`ws`)** on the backend, and **MongoDB Atlas** for persistence.

The system replaces the legacy snapshot model (which transmitted entire 500+ element scenes over WebSocket and saved canvas drawings inside the `Chat` collection) with a **high-performance, server-authoritative, element-level collaborative architecture**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             SYNCBOARD ARCHITECTURE                          │
│                                                                             │
│   Client A (Browser)          Client B (Browser)          Client C (Browser)│
│   Excalidraw Canvas           Excalidraw Canvas           Excalidraw Canvas │
│   Optimistic 60fps            Optimistic 60fps            Optimistic 60fps  │
│   Diff Detector               Diff Detector               Diff Detector     │
│   Remote Cursors              Remote Cursors              Remote Cursors    │
│         ▲                           ▲                           ▲           │
│         │ HTTP (REST)               │ WebSocket (ws)            │           │
│         ▼                           ▼                           ▼           │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Express REST API              WebSocket Collaboration Server        │   │
│   │ - JWT Auth & Profile          - JWT Query Validation & Perms        │   │
│   │ - Room CRUD & Invites         - Heartbeat (Ping/Pong 30s)           │   │
│   │ - Cloudinary Image Upload     - Ephemeral Presence & Remote Cursors │   │
│   └──────────────────────┬──────────────────────────────────────────────┘   │
│                          │                                                  │
│                          ▼                                                  │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ In-Memory Authoritative RoomManager                                 │   │
│   │ - Map<roomId, RoomState>                                            │   │
│   │ - Authoritative Element Map (id -> element)                         │   │
│   │ - Monotonic Revision Counter (board-level version)                  │   │
│   │ - Bounded Recent Operations Ring Buffer (200 ops)                   │   │
│   │ - Deterministic Reconciliation (Excalidraw version/versionNonce)    │   │
│   │ - Room Eviction on 0 Clients                                        │   │
│   └──────────────────────┬──────────────────────────────────────────────┘   │
│                          │                                                  │
│                          │ Debounced (1s) & Periodic (15s) Persistence      │
│                          ▼                                                  │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ MongoDB Atlas (Permanent Storage)                                   │   │
│   │ - Room Collection: { slug, adminId, collaborators, elements, ver }  │   │
│   │ - User Collection: { name, email, photo }                           │   │
│   │ - Message Collection: text chat only (Drawing separated from Chat!) │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Technical Constraints & Guardrails

> [!IMPORTANT]
> **Strict Tech Stack Boundaries**:
> - Realtime: Native `ws` only. **Do NOT** migrate to Socket.IO.
> - Persistence: MongoDB Atlas via Mongoose. **Do NOT** query MongoDB for mouse/cursor movements.
> - Concurrency: Excalidraw element-level versioning & versionNonce deterministic reconciliation. **Do NOT** introduce Redis, CRDT (Yjs / Automerge), WebRTC, or Liveblocks.
> - Canvas: `@excalidraw/excalidraw` 0.18. Do NOT rebuild canvas from scratch.
> - Large Assets: Upload via HTTP to Cloudinary; synchronize only URL and file metadata over WebSocket.

---

## 3-Member Work Division Matrix

| Member | Primary Responsibility | Assigned Phases | Primary Files Owned |
| :--- | :--- | :--- | :--- |
| **Member 1** | **Backend Core, Storage & Room Authority** | Phase 1, Phase 2, Phase 3 | `backend/src/models/Room.ts`<br>`backend/src/ws/roomManager.ts`<br>`backend/src/http/server.ts` (Room endpoints) |
| **Member 2** | **WebSocket Engine, Synchronization & Persistence** | Phase 5, Phase 8, Phase 9 (Backend) | `backend/src/ws/index.ts`<br>`backend/src/types/room.ts`<br>`backend/src/http/server.ts` (Auth & Uploads) |
| **Member 3** | **Frontend Engine, Differential Sync & Presence UI** | Phase 4, Phase 6, Phase 7, Phase 9 (Frontend) | `frontend/app/canvas/[roomId]/page.tsx`<br>`frontend/components/ui/` (Cursor Overlay)<br>`frontend/lib/imageService.ts` |

---

## Detailed 9-Phase Implementation Plan

### Member 1: Backend Core, Storage & Room Authority

#### Phase 1 — Foundation: Schema, Typings & Permissions
- **1.1 Fix TypeScript Compilation in `Room.ts`**:
  - Resolve Mongoose Schema definition typing error on `elements: { type: [Schema.Types.Mixed], default: [] }` by switching to `elements: { type: Array, default: [] }` or `elements: [{ type: Schema.Types.Mixed }]`.
- **1.2 Persistent Room Schema Verification**:
  - Ensure fields: `slug` (unique string), `adminId` (ref User), `collaborators` ([ref User]), `elements` (Excalidraw array), `version` (Number, default 0), `timestamps: true`.
- **1.3 Permission Helper Functions**:
  - Implement `checkRoomPermission(userId, roomId, requiredRole: 'admin' | 'editor' | 'viewer')`:
    - Owner (`adminId` === `userId`) -> `'owner'` (full rights)
    - Collaborator (`collaborators.includes(userId)`) -> `'editor'`
    - Non-member -> `403 Forbidden`

#### Phase 2 — Remove Incorrect Snapshot Architecture & Room REST API
- **2.1 Decouple Drawing from Chat**:
  - Deprecate/remove `app.post('/chats/:roomId')` for board persistence. Chat remains strictly for text messages via `Message` model and `/rooms/:roomId/messages`.
- **2.2 Proper Room Snapshot API (`GET /room/:idOrSlug`)**:
  - Update `GET /room/:idOrSlug` to look up by either MongoDB ObjectId or `slug`.
  - Validate JWT authentication.
  - Check user permissions (owner or collaborator).
  - Legacy Migration Fallback: If `room.elements` is empty, check legacy `Chat` collection for any existing saved snapshot; if found, parse and populate `room.elements` and save to `Room`.
  - Return `{ room: { _id, slug, adminId, collaborators, elements, version, updatedAt } }`.
- **2.3 Room Deletion API (`DELETE /room/:roomId`)**:
  - Enforce admin ownership (`req.userId === room.adminId`).
  - Delete room document and notify `RoomManager` to evict active in-memory state.

#### Phase 3 — Server-Authoritative `RoomState` & `RoomManager`
- **3.1 In-Memory `RoomState` Implementation** (`backend/src/ws/roomManager.ts`):
  - Encapsulate in-memory state:
    - `roomId: string`
    - `elements: Map<string, any>` (O(1) lookup, mutation, deletion)
    - `version: number` (monotonic board version, starts from DB snapshot)
    - `clients: Map<string, ClientSession>` (session tracking with socket, user details, world cursor, selection)
    - `dirty: boolean` & `lastActivity: number`
  - Element CRUD Methods:
    - `createElement(el)`: Adds to map, increments version, marks dirty.
    - `updateElement(incoming)`: Implements deterministic Excalidraw conflict resolution:
      - If `existing.version > incoming.version` -> ignore stale update.
      - If `existing.version === incoming.version` -> tie-break with `versionNonce` (higher wins).
      - If accepted -> updates map, increments board version, marks dirty.
    - `deleteElement(id)`: Soft-deletion preserving Excalidraw convergence: sets `isDeleted = true`, increments element version, increments board version, marks dirty.
    - `movePreview(element)`: Updates element in memory, does NOT mark dirty or trigger database writes.
- **3.2 `RoomManager` Singleton**:
  - Maintain `rooms: Map<string, RoomState>`.
  - `getOrCreateRoom(roomId)`: If in memory, return. If not, query MongoDB `Room.findById(roomId)`, construct `RoomState`, populate elements & version, store in map.
  - `evictRoom(roomId)`: If `clients.size === 0`, ensure state is saved, then `rooms.delete(roomId)` to reclaim RAM.

---

### Member 2: WebSocket Engine, Synchronization & Persistence

#### Phase 5 — Collaboration Reliability & Reconnect Protocol
- **5.1 Monotonic Operation Tracking**:
  - Define `BaseOperation`: `{ operationId: string, clientId: string, roomId: string, type: string, revision: number, timestamp: number }`.
  - Add bounded ring buffer `recentOperations: ElementOperation[]` (capped at 200 operations) inside `RoomState`.
- **5.2 Missed-Operation Catchup vs. Full Resync**:
  - Client sends `room:join` or `room:sync-request` with `lastKnownVersion: number`.
  - Server evaluates:
    - If `clientVersion === roomState.version` -> client is fully up to date.
    - If `roomState.version - clientVersion <= bufferLength` and all missing ops exist in buffer -> send `{ type: 'room:sync', revision: roomState.version, operations: missedOps, fullSync: false }`.
    - If client is too far behind or buffer was evicted -> send `{ type: 'room:sync', revision: roomState.version, elements: roomState.getElements(), fullSync: true }`.

#### Phase 8 — Debounced & Periodic Persistence, Heartbeat & Zombie Cleanup
- **8.1 Debounced Persistence (1-second debounce)**:
  - When a mutating operation (`element:create`, `element:update`, `element:delete`, `element:move-commit`) occurs, mark room `dirty = true`.
  - Reset / set 1000ms debounce timer: after 1 second of inactivity, trigger `persistToDatabase()`.
- **8.2 Periodic Persistence (15-second interval)**:
  - While active edits continue without reaching 1-second idle, periodic interval checks if `dirty === true`.
  - If dirty, saves snapshot (`Room.updateOne({ _id: roomId }, { $set: { elements, version } })`) and resets `dirty = false`.
- **8.3 Save on Idle / Last Client Disconnect**:
  - When the last client disconnects from a room: immediately flush any unsaved state to MongoDB and evict `RoomState` from `RoomManager`.
- **8.4 Heartbeat / Ping-Pong Protocol**:
  - WebSocket server sends `{ type: 'ping' }` (or native ws `ws.ping()`) every 30 seconds.
  - Track `isAlive` flag per socket.
  - On `pong`, set `isAlive = true`.
  - Terminate dead sockets if no response within heartbeat window, remove from room presence, broadcast `user:left`, and check room eviction.

#### Phase 9 (Backend Part) — Asset Upload & Security
- **9.1 Image Upload Endpoint (`POST /upload-image`)**:
  - Validate JWT authentication.
  - Upload image buffer to Cloudinary using `multer.memoryStorage()`.
  - Return `{ success: true, url, width, height, fileId }`.
- **9.2 WebSocket Authorization**:
  - Verify JWT token on WebSocket connection query string (`?token=...`).
  - Verify room access permission against MongoDB on `room:join`. Reject unauthorized clients with `{ type: 'error', message: 'Unauthorized' }`.
- **9.3 Clean Logging & Hygiene**:
  - Remove any raw JWT secret logging, password logs, or sensitive token dumps.

---

### Member 3: Frontend Engine, Differential Sync & Presence UI

#### Phase 4 — Frontend Differential Element Synchronization
- **4.1 Stop Sending Full Scene**:
  - Stop transmitting the 500+ element scene on every change.
  - Maintain a local cache ref `previousElementsMap: Map<string, { version: number, versionNonce: number }>` representing the last committed/known state.
- **4.2 Differential Change Detection in `onChange`**:
  - In Excalidraw `onChange(elements)`:
    - Compare each element with `previousElementsMap`:
      - New ID not in previous map -> generate `element:create`.
      - Exists but `element.version > prev.version` or `element.versionNonce !== prev.versionNonce` -> generate `element:update`.
      - If an element was marked `isDeleted: true` -> generate `element:delete`.
  - Update `previousElementsMap` with the new versions.
- **4.3 Client-Side Deterministic Reconciliation**:
  - On receiving `operation:broadcast`:
    - Apply incoming element to local Excalidraw scene using version/versionNonce comparison:
      - If `incoming.version > local.version`, or (`incoming.version === local.version` && `incoming.versionNonce > local.versionNonce`): accept incoming.
      - Otherwise, keep local.
    - Avoid re-broadcasting remote updates back to the server (prevent infinite echo loops!).

#### Phase 6 — Optimistic Local Rendering & Drag Throttling
- **6.1 Optimistic Local Feedback**:
  - Local user input applies immediately to local Excalidraw canvas at 60 FPS.
- **6.2 Drag Throttling & Preview / Commit Distinction**:
  - During pointer drag (e.g. mouse down + moving):
    - Throttle network broadcasts to ~20-30 Hz (33ms - 50ms intervals).
    - Send `{ type: 'element:move-preview', elementId, element, operationId }`.
  - On pointer release (`onPointerUp` or drag finish):
    - Send `{ type: 'element:move-commit', elementId, element, operationId }`.
    - Server and peers commit this final version as persistent state.

#### Phase 7 — Ephemeral Presence, Remote Cursors & Selection Badges
- **7.1 World-Coordinate Pointer Synchronization**:
  - Read Excalidraw pointer coordinates from `onPointerUpdate({ pointer: { x, y } })` (Excalidraw coordinates are world-canvas coordinates).
  - Throttle pointer transmission to 25 updates/second.
  - Send `{ type: 'presence:update', roomId, cursor: { x, y }, selectedElementId }`.
- **7.2 Lightweight Remote Cursor Overlay**:
  - Convert remote world coordinates `(x, y)` to viewport coordinates using `appState.scrollX`, `appState.scrollY`, and `appState.zoom.value`:
    - `screenX = (worldX + scrollX) * zoom`
    - `screenY = (worldY + scrollY) * zoom`
  - Render cursors with user name tag and assigned color in an isolated, lightweight SVG/DOM overlay without re-rendering the Excalidraw canvas.
- **7.3 Selection Presence & Online Users**:
  - Display remote selection bounding box / highlight for `selectedElementId`.
  - Display online collaborators pill/avatar list in top bar showing currently active members in the room.

#### Phase 9 (Frontend Part) — Image Asset Integration & Persistence
- **9.1 Cloudinary Image Flow**:
  - When user pastes or uploads an image: upload file to `/upload-image` via HTTP.
  - Insert Excalidraw element with `cloudinaryUrl`.
  - Send `element:create` with the Cloudinary URL and dimensions.
  - When other clients receive the element, load image into Excalidraw files map via the URL.

---

## WebSocket Protocol Specification

All messages are JSON objects conforming to these schemas:

### Client -> Server

```typescript
// 1. Join Room
{
  type: 'room:join',
  roomId: string,
  lastKnownVersion?: number
}

// 2. Incremental Sync Request
{
  type: 'room:sync-request',
  roomId: string,
  lastKnownVersion: number
}

// 3. Differential Element Operations
{
  type: 'element:create' | 'element:update' | 'element:delete' | 'element:move-preview' | 'element:move-commit',
  operationId: string,
  roomId: string,
  clientId: string,
  elementId: string,
  element: any // Excalidraw element (contains id, version, versionNonce, etc.)
}

// 4. Ephemeral Presence
{
  type: 'presence:update',
  roomId: string,
  cursor: { x: number, y: number } | null,
  selectedElementId?: string | null
}
```

### Server -> Client

```typescript
// 1. Initial Room State
{
  type: 'room:state',
  roomId: string,
  revision: number,
  elements: any[],
  users: Array<{ clientId: string, userId: string, username: string, color: string }>
}

// 2. Broadcasted Operation
{
  type: 'operation:broadcast',
  roomId: string,
  revision: number,
  operation: ElementOperation
}

// 3. Sync Catchup
{
  type: 'room:sync',
  roomId: string,
  revision: number,
  fullSync: boolean,
  operations?: ElementOperation[],
  elements?: any[]
}

// 4. Presence Broadcast
{
  type: 'presence:update',
  roomId: string,
  clientId: string,
  userId: string,
  username: string,
  color: string,
  cursor: { x: number, y: number } | null,
  selectedElementId?: string | null
}

// 5. User Lifecycle
{
  type: 'user:joined' | 'user:left',
  roomId: string,
  clientId: string,
  userId: string,
  username?: string
}
```

---

## Team Integration & Handoff Checkpoints

```
Checkpoint 1: Backend Foundation (End of Phase 1 & 2)
[Member 1] Delivers working Room schema + GET /room/:id with elements + permission validation.
[Member 2 & 3] Can now test room loading with authentic MongoDB data.

Checkpoint 2: RoomManager & WS Protocol (End of Phase 3 & 5)
[Member 1] Delivers RoomManager & RoomState in-memory engine.
[Member 2] Integrates RoomManager into ws/index.ts with operation ring buffer & catchup sync.
[Member 3] Receives initial room:state and operation:broadcast events.

Checkpoint 3: Differential Sync & Cursors (End of Phase 4, 6 & 7)
[Member 3] Delivers frontend diff detector, throttled dragging, and remote cursor overlay.
[All] End-to-end multi-window collaborative drawing & cursor test!

Checkpoint 4: Persistence, Reconnect & Hardening (End of Phase 8 & 9)
[Member 2] Delivers debounced/periodic persistence, ping/pong heartbeat, and zombie cleanup.
[Member 3] Delivers disconnect auto-reconnect with lastKnownVersion catchup.
[Member 1 & 2] Verifies MongoDB database documents, removes dead code and secrets.
```

---

## Universal Context & Task Prompt

Copy and paste this prompt into any AI assistant, Antigravity instance, or developer terminal to instantly provide complete context, architectural constraints, and exact task execution guidelines:

```markdown
# UNIVERSAL CONTEXT & TASK PROMPT: SYNCBOARD MULTIPLAYER WHITEBOARD

## 1. PROJECT IDENTITY & PURPOSE
You are working on **SyncBoard**, a high-performance real-time multiplayer collaborative whiteboard.
- **Frontend**: Next.js (App Router), React 19, TypeScript, TailwindCSS, `@excalidraw/excalidraw` 0.18.
- **Backend**: Node.js, Express, TypeScript, native `ws` WebSocket library, MongoDB Atlas (Mongoose), JWT.
- **Repository Location**: `c:\Users\ADMIN\Desktop\SyncBoard\SyncBoard` (backend in `./backend`, frontend in `./frontend`).

## 2. STRICT ARCHITECTURAL CONSTRAINTS (DO NOT VIOLATE)
1. **NO External Collaboration Frameworks**: Strictly DO NOT use Redis, CRDT libraries (Yjs, Automerge), WebRTC, Firebase RTDB, or Liveblocks.
2. **NO Socket.IO**: The project uses native `ws`. Keep native `ws`.
3. **NO Database in Realtime Hot Path**: Never query or write to MongoDB on cursor movements or mouse drag frames. Cursors and presence live ONLY in server memory.
4. **Authoritative In-Memory Model**: Active rooms live in `RoomManager` (Map<roomId, RoomState>). RoomState holds an element Map, monotonic board version, client presence, and a recent operations buffer (200 ops).
5. **Deterministic Reconciliation**: Use Excalidraw's native `version` and `versionNonce` fields on elements. Higher version wins; if equal, higher versionNonce wins.
6. **Persistence Strategy**: Debounced write to MongoDB (1-second debounce after edits stop) + periodic write (every 15s during continuous edits) + immediate write on last client disconnect before memory eviction.
7. **No Full-Scene Broadcasts**: Differential sync only. When an element changes, transmit only that element (`element:create`, `element:update`, `element:delete`, `element:move-preview`, `element:move-commit`).
8. **Drawing Separated from Chat**: Drawing elements belong strictly to `Room.elements`. The `Chat`/`Message` collection is strictly for text chat.
9. **Image Sync via URLs**: Images are uploaded to Cloudinary via HTTP `/upload-image`. Only the resulting URL and metadata are broadcast over WebSocket; NEVER transmit large base64 or binary payloads over WebSocket.

## 3. MEMBER ROLES & DIVISION
Before making changes, determine which Member role you are executing:

### [MEMBER 1]: Backend Core, Storage & Room Authority
- Files: `backend/src/models/Room.ts`, `backend/src/ws/roomManager.ts`, `backend/src/http/server.ts`
- Responsibilities:
  1. Fix Mongoose TypeScript typing on `Room.elements`.
  2. Implement `RoomState` with element Map, monotonic revision counter, and version/versionNonce tie-breaking.
  3. Implement `RoomManager` singleton managing in-memory active rooms with eviction on zero clients.
  4. Build authenticated `GET /room/:idOrSlug` with permission verification (owner vs collaborator) and automatic legacy snapshot migration fallback from Chat.
  5. Build authenticated `DELETE /room/:roomId` for room admins.

### [MEMBER 2]: WebSocket Engine, Synchronization & Persistence
- Files: `backend/src/ws/index.ts`, `backend/src/types/room.ts`, `backend/src/http/server.ts`
- Responsibilities:
  1. Refactor `ws/index.ts` to use `RoomManager` instead of flat user arrays.
  2. Validate JWT token on WebSocket connection query string (`?token=...`).
  3. Implement monotonic operation tracking with bounded ring buffer (200 ops) for `room:sync-request` catchup.
  4. Implement 1s debounced persistence, 15s periodic persistence, and idle room flush to MongoDB.
  5. Implement 30s heartbeat ping/pong to terminate zombie sockets.
  6. Implement Cloudinary image upload endpoint `POST /upload-image`.

### [MEMBER 3]: Frontend Engine, Differential Sync & Presence UI
- Files: `frontend/app/canvas/[roomId]/page.tsx`, `frontend/components/ui/`, `frontend/lib/imageService.ts`
- Responsibilities:
  1. Load board elements from `GET /room/${roomId}` on mount (remove legacy `/chats/${roomId}` loading).
  2. Implement differential element detector in `onChange`: compare with local cache to send only `element:create`, `element:update`, `element:delete`.
  3. Implement 60 FPS optimistic local rendering with throttled (25 Hz) network synchronization.
  4. Implement `element:move-preview` during drag and `element:move-commit` on mouse release.
  5. Implement world-to-screen coordinate mapping for remote cursors using Excalidraw `scrollX`, `scrollY`, and `zoom`.
  6. Render lightweight remote cursor overlay and online user presence list.
  7. Handle reconnection and missed-update recovery using `lastKnownVersion`.

## 4. DEFINITION OF DONE
- Two browser tabs open to the same room can draw simultaneously with real-time updates.
- Moving an object shows smooth remote preview and persists accurately on release.
- Remote cursors track correctly across different zoom and scroll levels.
- Online users list displays connected collaborators.
- Browser refresh restores the board from MongoDB `Room.elements` (zero chat involvement).
- Temporary network drop reconnects automatically and catches up without full page reload.
```

---

## Verification Plan

### Automated Verification
```bash
# 1. Backend Compilation Check
cd backend
node ./node_modules/typescript/bin/tsc --noEmit

# 2. Frontend Compilation Check
cd ../frontend
node ./node_modules/typescript/bin/tsc --noEmit
```

### Manual Multi-User Test Scenarios
1. **Multi-User Real-time Sync**: Open two browser windows (User A & User B). Draw on Window A -> verify instantaneous element arrival on Window B without full-board reload.
2. **Move Preview & Commit**: Drag a shape on User A -> User B sees intermediate positions; release mouse -> version increments and debounced save triggers.
3. **World Cursors with Zoom**: Zoom in to 200% on User A and pan canvas. User B moves cursor -> User A sees User B's cursor at the exact correct object location.
4. **Persistence & Refresh**: Reload browser -> board displays all saved elements directly from `Room.elements`.
5. **Catch-up Recovery**: Simulate disconnect on User B, draw 2 elements on User A, reconnect User B -> User B automatically receives missed operations via `lastKnownVersion`.
