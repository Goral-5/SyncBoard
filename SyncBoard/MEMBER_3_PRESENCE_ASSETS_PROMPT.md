# INSTRUCTIONS & PROMPT FOR MEMBER 3: PRESENCE, CURSORS & ASSETS

> **INSTRUCTIONS FOR MEMBER 3**:
> Copy the prompt below and send it directly to your **Antigravity AI Agent** (or AI coding assistant).
> It provides the full architectural context, strict branch rules, files you own, and exact step-by-step implementation tasks.

---

```markdown
# TASK PROMPT: MEMBER 3 — FRONTEND PRESENCE, REMOTE CURSORS & ASSET SYNC

## 1. IDENTITY & ARCHITECTURAL CONTEXT
You are working on the **Frontend Presence & Asset Management Layer** for **SyncBoard** (a real-time collaborative whiteboard).
- **Stack**: Next.js 15, React 19, TypeScript, TailwindCSS, `@excalidraw/excalidraw` 0.18, Cloudinary, native `ws`.
- **Backend**: Being implemented concurrently by Member 1 on `feature/backend-authority`.
- **Canvas Sync Engine**: Being implemented concurrently by Member 2 on `feature/frontend-canvas-sync`.
- **Protocol Contract**: Refer to `docs/COLLABORATION_CONTRACT.md` as the authoritative source of truth.

## 2. STRICT BRANCH & FILE BOUNDARIES (NO CONFLICTS ALLOWED)
- **Your Git Branch**: `feature/frontend-presence-ui`
- **Files You OWN (Allowed to create and edit)**:
  - `frontend/components/presence/RemoteCursors.tsx`
  - `frontend/components/presence/OnlineCollaborators.tsx`
  - `frontend/components/presence/SelectionOverlay.tsx`
  - `frontend/components/presence/index.ts`
  - `frontend/lib/imageService.ts`
  - `frontend/components/RoomChat.tsx` (Polishing text chat & connection status)
- **STRICT RESTRICTIONS (DO NOT TOUCH)**:
  - ❌ NEVER modify any file in `backend/**` (Member 1 owns backend).
  - ❌ NEVER modify `frontend/hooks/useCanvasSync.ts` (Member 2 owns the core canvas synchronization hook).
  - ❌ Ephemeral presence (cursors, selections) is in-memory only. Do NOT query or store cursors in any database.

## 3. YOUR EXACT OBJECTIVES

### Objective 1: Remote Cursors Layer (`frontend/components/presence/RemoteCursors.tsx`)
1. **World-to-Screen Coordinate Projection**:
   - Remote users transmit canvas world coordinates: `{ x, y }`.
   - To render them accurately regardless of the local user's pan and zoom:
     ```typescript
     const screenX = (cursor.x + appState.scrollX) * appState.zoom.value;
     const screenY = (cursor.y + appState.scrollY) * appState.zoom.value;
     ```
2. **Smooth Cursor Rendering**:
   - Render an SVG pointer colored with `cursor.color`.
   - Display a pill label with `cursor.username` offset next to the pointer.
   - Use CSS `pointer-events: none` and `will-change: transform` for high-performance 60 FPS rendering without triggering React re-renders of the main canvas.
3. **Ghost Cleanup**:
   - If no update is received for a client within 5 seconds, remove or fade out their cursor.

### Objective 2: Online Collaborators Header Bar (`frontend/components/presence/OnlineCollaborators.tsx`)
1. Maintain active room users:
   - On `room:state`: initialize users from `data.users`.
   - On `user:joined`: add `data.user` to the list.
   - On `user:left`: remove `data.clientId` from the list.
2. Display an attractive user avatar stack / badge in the top bar:
   - Show user initial / avatar with their assigned collaboration color dot.
   - Hover tooltip showing full name and role.
   - "🟢 X users online" live counter.

### Objective 3: Selection Presence (`frontend/components/presence/SelectionOverlay.tsx`)
1. When a user selects an element, other clients receive `presence:update` with `selectedElementId`.
2. Look up the element's bounding box `(x, y, width, height)` in `excalidrawAPI.getSceneElements()`.
3. Render a subtle highlight border / name tag around the element with the collaborator's color, letting users see who is currently editing what.

### Objective 4: Image Upload & Cloudinary Asset Service (`frontend/lib/imageService.ts`)
1. **Never Send Binary/Base64 over WebSocket**:
   - Large images degrade WebSocket performance.
2. **Cloudinary Upload Pipeline**:
   - When an image is added/pasted to the canvas:
   - Convert dataURL / blob into a `File` or `FormData`.
   - Send `POST ${BACKEND_URL}/upload-image` with `Authorization: token`.
   - Backend returns `{ success: true, url, width, height }`.
   - Set `cloudinaryUrl = result.url` and register the URL in Excalidraw's files map (`excalidrawAPI.addFiles([{ id: fileId, dataURL: result.url, mimeType }])`).
   - The canvas sync engine will then broadcast only the lightweight element metadata and URL.

### Objective 5: Chat Polish (`frontend/components/RoomChat.tsx`)
1. Confirm chat exclusively transmits `{ type: 'chat', roomId, content }` and receives `{ type: 'chat', roomId, message }`.
2. Display connection status indicator (Online / Reconnecting).
3. Ensure chat messages are preserved and loaded via `GET /rooms/:roomId/messages`.

## 4. DEFINITION OF DONE FOR MEMBER 3
- [ ] No compilation errors (`node ./node_modules/typescript/bin/tsc --noEmit`).
- [ ] Remote cursors track accurately when zooming in/out and panning across the canvas.
- [ ] Online collaborators avatar stack updates in real-time as users enter and leave.
- [ ] Uploaded images are stored in Cloudinary, and only URLs are shared.
- [ ] Zero backend files touched; git diff is strictly confined to your assigned frontend files.
```
