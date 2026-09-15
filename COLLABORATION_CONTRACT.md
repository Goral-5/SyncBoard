# SyncBoard: Master Protocol & Architecture Contract

> **CRITICAL RULE**: This document is the **Single Source of Truth** for all 3 project members.
> Any modification to message formats, endpoint URLs, or payload structures must strictly adhere to this specification to prevent merge conflicts and integration mismatches.

---

## 1. Branch Boundaries & File Ownership

To ensure zero Git conflicts, each member works on a designated branch and owns a strict subset of files:

| Member | Branch Name | Owned Files / Directories | RESTRICTED (DO NOT TOUCH) |
| :--- | :--- | :--- | :--- |
| **Member 1 (User)** | `feature/backend-authority` | `backend/**`<br>`frontend/config.ts` | Frontend canvas and UI components |
| **Member 2** | `feature/frontend-canvas-sync` | `frontend/hooks/useCanvasSync.ts`<br>`frontend/types/collaboration.ts`<br>`frontend/app/canvas/[roomId]/page.tsx` (Canvas logic integration) | `backend/**`<br>`frontend/components/presence/**` |
| **Member 3** | `feature/frontend-presence-ui` | `frontend/components/presence/**`<br>`frontend/components/RoomChat.tsx`<br>`frontend/lib/imageService.ts` | `backend/**`<br>`frontend/hooks/useCanvasSync.ts` |

---

## 2. Core Architectural Principles

1. **Native WebSocket (`ws`)**: No Socket.IO, No WebRTC, No Firebase RTDB, No Liveblocks.
2. **Deterministic Conflict Reconciliation**: Excalidraw element-level `version` and `versionNonce`. Higher `version` wins; if equal, higher `versionNonce` wins. No CRDT or Yjs.
3. **Differential Element Sync**: When an element changes, transmit **only** that element. Do **not** send the entire 500+ element array.
4. **Separation of Concerns**:
   - Board drawing elements are stored **only** in MongoDB `Room.elements`.
   - Drawing elements are **never** stored in the `Chat` collection.
   - Ephemeral presence (cursors, selections, online list) exists **only in server memory**. Never query or write to MongoDB for cursor movements!
5. **Image Assets**: Images are uploaded to Cloudinary via HTTP `POST /upload-image`. Only the resulting URL and metadata are broadcast over WebSocket. Never send large base64 or binary data over WebSocket.

---

## 3. REST API Specification

### 3.1 Get Board & Elements
- **Route**: `GET /room/:idOrSlug`
- **Headers**: `Authorization: <JWT_TOKEN>`
- **Response**:
```json
{
  "room": {
    "_id": "66d123456789abcdef012345",
    "slug": "sprint-planning",
    "adminId": { "_id": "...", "name": "Alice" },
    "collaborators": [{ "_id": "...", "name": "Bob" }],
    "elements": [
      {
        "id": "shape-1",
        "type": "rectangle",
        "x": 100,
        "y": 150,
        "width": 200,
        "height": 100,
        "version": 4,
        "versionNonce": 987654,
        "isDeleted": false
      }
    ],
    "version": 12,
    "createdAt": "2026-09-10T12:00:00.000Z",
    "updatedAt": "2026-09-10T12:05:30.000Z"
  }
}
```

### 3.2 Upload Image Asset
- **Route**: `POST /upload-image`
- **Headers**: `Authorization: <JWT_TOKEN>`, `Content-Type: multipart/form-data`
- **Body**: `image: <Binary File>`
- **Response**:
```json
{
  "success": true,
  "url": "https://res.cloudinary.com/sketchcalibur/image/upload/v1234567890/sample.png",
  "publicId": "sketchcalibur/sample",
  "width": 800,
  "height": 600
}
```

### 3.3 Text Chat Messages
- **Route**: `GET /rooms/:roomId/messages`
- **Headers**: `Authorization: <JWT_TOKEN>`
- **Response**: `{ "messages": [...] }`

---

## 4. WebSocket Message Specification

All WebSocket communication uses JSON strings (`JSON.stringify(payload)` and `JSON.parse(data)`).

### 4.1 Client -> Server Messages

#### 1. Join Room
Sent immediately after WebSocket opens:
```json
{
  "type": "room:join",
  "roomId": "66d123456789abcdef012345",
  "lastKnownVersion": 12
}
```

#### 2. Incremental Sync Request
Sent if client reconnects or detects missed operations:
```json
{
  "type": "room:sync-request",
  "roomId": "66d123456789abcdef012345",
  "lastKnownVersion": 12
}
```

#### 3. Differential Element Operations
Sent when an element is created, updated, deleted, or moved:
```json
{
  "type": "element:create",
  "operationId": "op-1726054800000-abc1",
  "roomId": "66d123456789abcdef012345",
  "clientId": "client-xyz-789",
  "elementId": "shape-1",
  "element": {
    "id": "shape-1",
    "type": "rectangle",
    "x": 120,
    "y": 180,
    "width": 200,
    "height": 100,
    "version": 5,
    "versionNonce": 1234567,
    "isDeleted": false
  }
}
```
*Valid types:*
- `"element:create"`: New element added to canvas.
- `"element:update"`: Existing element modified (color, text, dimensions, etc.).
- `"element:delete"`: Element removed (sent with `isDeleted: true` and incremented version).
- `"element:move-preview"`: Throttled (25 Hz) intermediate position during active dragging.
- `"element:move-commit"`: Final element state on mouse release / drag completion.

#### 4. Ephemeral Presence Update
Sent throttled (20-30 Hz) on pointer move or selection change:
```json
{
  "type": "presence:update",
  "roomId": "66d123456789abcdef012345",
  "cursor": {
    "x": 450.5,
    "y": 320.0
  },
  "selectedElementId": "shape-1"
}
```
*(Note: `cursor.x` and `cursor.y` are World/Canvas coordinates, not raw screen pixels).*

---

### 4.2 Server -> Client Messages

#### 1. Initial Room State
Sent to a client upon successful `room:join`:
```json
{
  "type": "room:state",
  "roomId": "66d123456789abcdef012345",
  "revision": 15,
  "elements": [...],
  "users": [
    {
      "clientId": "client-abc-123",
      "userId": "66d111111111abcdef011111",
      "username": "Alice",
      "color": "#FF4C4C"
    }
  ]
}
```

#### 2. Broadcasted Element Operation
Sent to all other room clients when an element operation occurs:
```json
{
  "type": "operation:broadcast",
  "roomId": "66d123456789abcdef012345",
  "revision": 16,
  "operation": {
    "type": "element:update",
    "operationId": "op-1726054800000-abc1",
    "clientId": "client-xyz-789",
    "elementId": "shape-1",
    "element": { ... }
  }
}
```

#### 3. Missed Updates / Catchup Sync
Sent in response to `room:sync-request` or `room:join` with `lastKnownVersion`:
```json
// Incremental Catchup (operations available in buffer)
{
  "type": "room:sync",
  "roomId": "66d123456789abcdef012345",
  "revision": 18,
  "fullSync": false,
  "operations": [ ... ]
}

// OR Full Resync (if client was disconnected for too long)
{
  "type": "room:sync",
  "roomId": "66d123456789abcdef012345",
  "revision": 18,
  "fullSync": true,
  "elements": [ ... ]
}
```

#### 4. Presence Broadcast
Sent to other clients when a user moves cursor or selects an object:
```json
{
  "type": "presence:update",
  "roomId": "66d123456789abcdef012345",
  "clientId": "client-xyz-789",
  "userId": "66d222222222abcdef022222",
  "username": "Bob",
  "color": "#00CFFF",
  "cursor": { "x": 450.5, "y": 320.0 },
  "selectedElementId": "shape-1"
}
```

#### 5. User Lifecycle Broadcasts
```json
{
  "type": "user:joined",
  "roomId": "66d123456789abcdef012345",
  "user": {
    "clientId": "client-xyz-789",
    "userId": "66d222222222abcdef022222",
    "username": "Bob",
    "color": "#00CFFF"
  }
}

{
  "type": "user:left",
  "roomId": "66d123456789abcdef012345",
  "clientId": "client-xyz-789",
  "userId": "66d222222222abcdef022222"
}
```

---

## 5. Excalidraw Element Reconciliation Algorithm

When receiving an incoming element (from `operation:broadcast` or `room:sync`):

```typescript
function reconcileElement(existing: any | undefined, incoming: any): any {
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
```
