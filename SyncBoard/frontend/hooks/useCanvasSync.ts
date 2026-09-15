'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { BACKEND_URL, WSS_URL } from '@/config';
import {
  CollaboratorUser,
  RemoteCursor,
  ConnectionStatus,
  ElementOperation,
  RoomResponse,
} from '@/types/collaboration';

interface UseCanvasSyncProps {
  roomId: string;
  excalidrawAPI: any;
  currentUserId?: string | null;
  currentUsername?: string;
}

interface UseCanvasSyncReturn {
  connectionStatus: ConnectionStatus;
  collaborators: CollaboratorUser[];
  remoteCursors: Record<string, RemoteCursor>;
  remoteSelections: Record<string, string | null>;
  boardRevision: number;
  isLoadingRoom: boolean;
  ws: WebSocket | null;
  handleCanvasChange: (elements: readonly any[], appState: any) => void;
  handlePointerUpdate: (payload: { pointer: { x: number; y: number } }, selectedElementId?: string | null) => void;
  handlePointerDown: () => void;
  handlePointerUp: () => void;
  reconcileAndApplyIncoming: (incomingElements: any[]) => void;
}

// Deterministic reconciliation algorithm according to Section 5 of COLLABORATION_CONTRACT.md
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

function getRandomColor(): string {
  const colors = ['#FF4C4C', '#4CFF4C', '#4C4CFF', '#FFAA00', '#00CFFF', '#FF00DD', '#7C3AED'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function generateOperationId(): string {
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useCanvasSync({
  roomId,
  excalidrawAPI,
  currentUserId,
  currentUsername,
}: UseCanvasSyncProps): UseCanvasSyncReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [, setWsInstance] = useState<WebSocket | null>(null);
  const clientId = useRef<string>(Math.random().toString(36).slice(2));
  const userColor = useRef<string>(getRandomColor());
  const currentRevision = useRef<number>(0);
  const previousElementsMap = useRef<Map<string, { version: number; versionNonce: number; isDeleted?: boolean }>>(new Map());

  // Concurrency & loop prevention flags
  const isRemoteUpdate = useRef<boolean>(false);
  const isDragging = useRef<boolean>(false);
  const pendingMovedElements = useRef<Map<string, any>>(new Map());
  const lastMovePreviewTime = useRef<number>(0);
  const lastPointerSendTime = useRef<number>(0);

  // Reconnection management
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef<number>(0);
  const isMounted = useRef<boolean>(true);

  // Component states
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [collaborators, setCollaborators] = useState<CollaboratorUser[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<Record<string, RemoteCursor>>({});
  const [remoteSelections, setRemoteSelections] = useState<Record<string, string | null>>({});
  const [boardRevision, setBoardRevision] = useState<number>(0);
  const [isLoadingRoom, setIsLoadingRoom] = useState<boolean>(true);

  // ── 1. Reconcile and apply incoming elements into Excalidraw scene ──────────
  const reconcileAndApplyIncoming = useCallback((incomingElements: any[]) => {
    if (!excalidrawAPI || !incomingElements || incomingElements.length === 0) return;

    const currentScene = excalidrawAPI.getSceneElements() as readonly any[];
    const elementsMap = new Map<string, any>();

    currentScene.forEach((el) => elementsMap.set(el.id, el));

    incomingElements.forEach((incoming) => {
      const existing = elementsMap.get(incoming.id);
      const reconciled = reconcileElement(existing, incoming);
      elementsMap.set(incoming.id, reconciled);

      // Track in previousElementsMap so we don't treat it as a local mutation
      previousElementsMap.current.set(incoming.id, {
        version: reconciled.version ?? 0,
        versionNonce: reconciled.versionNonce ?? 0,
        isDeleted: reconciled.isDeleted ?? false,
      });
    });

    const mergedElements = Array.from(elementsMap.values());

    // Flag that this update came from remote so onChange won't rebroadcast it
    isRemoteUpdate.current = true;
    excalidrawAPI.updateScene({ elements: mergedElements });
  }, [excalidrawAPI]);

  // ── 2. Initial Room Fetch via REST API (GET /room/:idOrSlug) ────────────────
  useEffect(() => {
    if (!roomId) return;
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) {
      setIsLoadingRoom(false);
      return;
    }

    let isSubscribed = true;

    async function loadInitialRoom() {
      try {
        const res = await fetch(`${BACKEND_URL}/room/${roomId}`, {
          headers: { Authorization: token ?? '' },
        });

        if (!res.ok) {
          console.warn(`[Sync] GET /room/${roomId} returned ${res.status}. Falling back to WebSocket state.`);
          if (isSubscribed) setIsLoadingRoom(false);
          return;
        }

        const data: RoomResponse = await res.json();
        if (!isSubscribed || !data.room) return;

        const roomElements = data.room.elements || [];
        const roomVersion = data.room.version || 0;
        currentRevision.current = roomVersion;
        setBoardRevision(roomVersion);

        // Pre-populate previous elements map as baseline
        roomElements.forEach((el: any) => {
          previousElementsMap.current.set(el.id, {
            version: el.version ?? 0,
            versionNonce: el.versionNonce ?? 0,
            isDeleted: el.isDeleted ?? false,
          });
        });

        // Populate Excalidraw scene if API is ready
        if (excalidrawAPI) {
          // Pre-populate files record for Cloudinary images
          const imageElements = roomElements.filter(
            (el: any) => el.type === 'image' && el.fileId && (el.cloudinaryUrl || el.dataURL)
          );
          const filesRecord: Record<string, any> = {};
          imageElements.forEach((el: any) => {
            filesRecord[el.fileId] = {
              id: el.fileId,
              dataURL: el.cloudinaryUrl || el.dataURL,
              mimeType: el.mimeType || 'image/png',
              created: Date.now(),
            };
          });

          isRemoteUpdate.current = true;
          excalidrawAPI.updateScene({
            elements: roomElements,
            files: filesRecord,
          });
        }
      } catch (err) {
        console.error('[Sync] Failed to load room REST snapshot:', err);
      } finally {
        if (isSubscribed) setIsLoadingRoom(false);
      }
    }

    loadInitialRoom();

    return () => {
      isSubscribed = false;
    };
  }, [roomId, excalidrawAPI]);

  // ── 3. WebSocket Lifecycle & Protocol Dispatcher ───────────────────────────
  useEffect(() => {
    isMounted.current = true;
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token || !roomId) return;

    function connect() {
      if (!isMounted.current) return;
      if (
        wsRef.current?.readyState === WebSocket.CONNECTING ||
        wsRef.current?.readyState === WebSocket.OPEN
      ) {
        return;
      }

      setConnectionStatus((prev) => (prev === 'connected' ? 'reconnecting' : 'connecting'));

      try {
        const ws = new WebSocket(`${WSS_URL}?token=${token}`);
        wsRef.current = ws;
        setWsInstance(ws);

        ws.onopen = () => {
          if (!isMounted.current) return;
          console.log('[Sync] WebSocket connected. Joining room:', roomId);
          setConnectionStatus('connected');
          reconnectAttempts.current = 0;

          // Send room:join with lastKnownVersion to allow catch-up
          ws.send(
            JSON.stringify({
              type: 'room:join',
              roomId,
              lastKnownVersion: currentRevision.current,
            })
          );
        };

        ws.onmessage = (event: MessageEvent) => {
          if (!isMounted.current) return;
          try {
            const data = JSON.parse(event.data);

            // Handle Heartbeat Ping
            if (data.type === 'ping') {
              ws.send(JSON.stringify({ type: 'pong' }));
              return;
            }

            // 1. Initial Room State
            if (data.type === 'room:state' && data.roomId === roomId) {
              if (typeof data.revision === 'number') {
                currentRevision.current = data.revision;
                setBoardRevision(data.revision);
              }
              if (Array.isArray(data.users)) {
                setCollaborators(data.users);
              }
              if (Array.isArray(data.elements)) {
                reconcileAndApplyIncoming(data.elements);
              }
            }

            // 2. Broadcasted Element Operation
            else if (data.type === 'operation:broadcast' && data.roomId === roomId) {
              const op: ElementOperation = data.operation;
              if (op && op.clientId !== clientId.current) {
                if (typeof data.revision === 'number') {
                  currentRevision.current = data.revision;
                  setBoardRevision(data.revision);
                }
                if (op.element) {
                  reconcileAndApplyIncoming([op.element]);
                }
              }
            }

            // 3. Catchup Sync (Incremental operations or Full resync)
            else if (data.type === 'room:sync' && data.roomId === roomId) {
              if (typeof data.revision === 'number') {
                currentRevision.current = data.revision;
                setBoardRevision(data.revision);
              }
              if (data.fullSync && Array.isArray(data.elements)) {
                reconcileAndApplyIncoming(data.elements);
              } else if (Array.isArray(data.operations)) {
                const elementsToApply = data.operations
                  .map((op: ElementOperation) => op.element)
                  .filter(Boolean);
                if (elementsToApply.length > 0) {
                  reconcileAndApplyIncoming(elementsToApply);
                }
              }
            }

            // 4. Ephemeral Presence Broadcast
            else if (data.type === 'presence:update' && data.roomId === roomId) {
              if (data.clientId !== clientId.current) {
                if (data.cursor) {
                  setRemoteCursors((prev) => ({
                    ...prev,
                    [data.clientId]: {
                      clientId: data.clientId,
                      userId: data.userId,
                      username: data.username || 'Collaborator',
                      color: data.color || '#00CFFF',
                      x: data.cursor.x,
                      y: data.cursor.y,
                      lastUpdated: Date.now(),
                    },
                  }));
                }
                if (data.selectedElementId !== undefined) {
                  setRemoteSelections((prev) => ({
                    ...prev,
                    [data.clientId]: data.selectedElementId,
                  }));
                }
              }
            }

            // 5. User Joined
            else if (data.type === 'user:joined' && data.roomId === roomId) {
              const user: CollaboratorUser = data.user;
              if (user && user.clientId !== clientId.current) {
                setCollaborators((prev) => {
                  if (prev.some((u) => u.clientId === user.clientId)) return prev;
                  return [...prev, user];
                });
              }
            }

            // 6. User Left
            else if (data.type === 'user:left' && data.roomId === roomId) {
              const leftClientId = data.clientId;
              setCollaborators((prev) => prev.filter((u) => u.clientId !== leftClientId));
              setRemoteCursors((prev) => {
                const next = { ...prev };
                delete next[leftClientId];
                return next;
              });
              setRemoteSelections((prev) => {
                const next = { ...prev };
                delete next[leftClientId];
                return next;
              });
            }
          } catch (parseError) {
            console.warn('[Sync] Non-JSON or invalid WebSocket message received:', parseError);
          }
        };

        ws.onclose = (event: CloseEvent) => {
          if (!isMounted.current) return;
          console.warn('[Sync] WebSocket closed (code: ' + event.code + '). Attempting reconnection...');
          setConnectionStatus('disconnected');
          setWsInstance(null);

          // Exponential backoff reconnect: 1s, 2s, 4s, capped at 8s
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 8000);
          reconnectAttempts.current += 1;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        };

        ws.onerror = (err) => {
          console.error('[Sync] WebSocket error:', err);
        };
      } catch (e) {
        console.error('[Sync] Connection establishment failed:', e);
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 8000);
        reconnectAttempts.current += 1;
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      }
    }

    connect();

    return () => {
      isMounted.current = false;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.close(1000, 'Unmounted');
        wsRef.current = null;
        setWsInstance(null);
      }
    };
  }, [roomId, reconcileAndApplyIncoming]);

  // ── 4. Periodic 5-Second Ghost Cursor Cleanup ──────────────────────────────
  useEffect(() => {
    const ghostInterval = setInterval(() => {
      const now = Date.now();
      setRemoteCursors((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [cId, cursor] of Object.entries(next)) {
          if (now - cursor.lastUpdated > 5000) {
            delete next[cId];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);

    return () => clearInterval(ghostInterval);
  }, []);

  // ── 5. Differential Element Detection in handleCanvasChange ────────────────
  const handleCanvasChange = useCallback((elements: readonly any[], _appState: any) => {
    // Suppress loopback when remote scene update triggered this change
    if (isRemoteUpdate.current) {
      isRemoteUpdate.current = false;
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      // Still update local version cache even if offline
      elements.forEach((el) => {
        previousElementsMap.current.set(el.id, {
          version: el.version ?? 0,
          versionNonce: el.versionNonce ?? 0,
          isDeleted: el.isDeleted ?? false,
        });
      });
      return;
    }

    const now = Date.now();

    for (const el of elements) {
      const prev = previousElementsMap.current.get(el.id);

      // Case 1: Brand new element
      if (!prev) {
        if (!el.isDeleted) {
          const createOp: ElementOperation = {
            type: 'element:create',
            operationId: generateOperationId(),
            roomId,
            clientId: clientId.current,
            elementId: el.id,
            element: el,
          };
          wsRef.current.send(JSON.stringify(createOp));
          previousElementsMap.current.set(el.id, {
            version: el.version ?? 0,
            versionNonce: el.versionNonce ?? 0,
            isDeleted: false,
          });
        }
        continue;
      }

      // Case 2: Deleted element
      if (el.isDeleted && !prev.isDeleted) {
        const deleteOp: ElementOperation = {
          type: 'element:delete',
          operationId: generateOperationId(),
          roomId,
          clientId: clientId.current,
          elementId: el.id,
          element: el,
        };
        wsRef.current.send(JSON.stringify(deleteOp));
        previousElementsMap.current.set(el.id, {
          version: el.version ?? 0,
          versionNonce: el.versionNonce ?? 0,
          isDeleted: true,
        });
        continue;
      }

      // Case 3: Updated or moved element
      const hasVersionChanged =
        (el.version ?? 0) > prev.version || (el.versionNonce ?? 0) !== prev.versionNonce;

      if (hasVersionChanged && !el.isDeleted) {
        // If user is actively dragging/moving elements
        if (isDragging.current) {
          pendingMovedElements.current.set(el.id, el);

          // Throttle move-preview broadcasts to 25 Hz (40ms interval)
          if (now - lastMovePreviewTime.current >= 40) {
            lastMovePreviewTime.current = now;
            const previewOp: ElementOperation = {
              type: 'element:move-preview',
              operationId: generateOperationId(),
              roomId,
              clientId: clientId.current,
              elementId: el.id,
              element: el,
            };
            wsRef.current.send(JSON.stringify(previewOp));
          }
        } else {
          // Regular discrete edit (color change, resize commit, text edit, etc.)
          const updateOp: ElementOperation = {
            type: 'element:update',
            operationId: generateOperationId(),
            roomId,
            clientId: clientId.current,
            elementId: el.id,
            element: el,
          };
          wsRef.current.send(JSON.stringify(updateOp));
        }

        previousElementsMap.current.set(el.id, {
          version: el.version ?? 0,
          versionNonce: el.versionNonce ?? 0,
          isDeleted: el.isDeleted ?? false,
        });
      }
    }
  }, [roomId]);

  // ── 6. Drag Lifecycle (Pointer Down & Up for Move Commit) ───────────────────
  const handlePointerDown = useCallback(() => {
    isDragging.current = true;
  }, []);

  const handlePointerUp = useCallback(() => {
    if (isDragging.current) {
      if (
        wsRef.current &&
        wsRef.current.readyState === WebSocket.OPEN &&
        pendingMovedElements.current.size > 0
      ) {
        // Commit all pending moved elements
        for (const el of pendingMovedElements.current.values()) {
          const commitOp: ElementOperation = {
            type: 'element:move-commit',
            operationId: generateOperationId(),
            roomId,
            clientId: clientId.current,
            elementId: el.id,
            element: el,
          };
          wsRef.current.send(JSON.stringify(commitOp));
        }
      }
      pendingMovedElements.current.clear();
      isDragging.current = false;
    }
  }, [roomId]);

  // ── 7. Ephemeral Pointer & Selection Updates (Throttled at 25 Hz) ───────────
  const handlePointerUpdate = useCallback((
    payload: { pointer: { x: number; y: number } },
    selectedElementId?: string | null
  ) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    if (now - lastPointerSendTime.current < 40) return; // 25 Hz throttle
    lastPointerSendTime.current = now;

    // payload.pointer in Excalidraw is world canvas coordinates!
    wsRef.current.send(
      JSON.stringify({
        type: 'presence:update',
        roomId,
        cursor: {
          x: payload.pointer.x,
          y: payload.pointer.y,
        },
        selectedElementId: selectedElementId || null,
      })
    );
  }, [roomId]);

  return {
    connectionStatus,
    collaborators,
    remoteCursors,
    remoteSelections,
    boardRevision,
    isLoadingRoom,
    ws: wsRef.current,
    handleCanvasChange,
    handlePointerUpdate,
    handlePointerDown,
    handlePointerUp,
    reconcileAndApplyIncoming,
  };
}
