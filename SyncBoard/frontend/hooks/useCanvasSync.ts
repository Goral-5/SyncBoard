'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { WSS_URL } from '../config';
import {
  CollaboratorUser,
  ElementOperation,
  OperationType,
} from '../types/collaboration';

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

interface UseCanvasSyncProps {
  roomId: string;
  excalidrawAPI: any;
  token?: string | null;
}

export function useCanvasSync({ roomId, excalidrawAPI, token }: UseCanvasSyncProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const ghostCleanupIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected' | 'reconnecting'
  >('connecting');
  const [collaborators, setCollaborators] = useState<CollaboratorUser[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<Record<string, CollaboratorUser>>({});
  const [chatMessages, setChatMessages] = useState<any[]>([]);

  // State refs
  const revisionRef = useRef<number>(0);
  const previousElementsMap = useRef<Map<string, { version: number; versionNonce: number }>>(new Map());
  const isApplyingRemoteUpdateRef = useRef<boolean>(false);
  const isDraggingRef = useRef<boolean>(false);
  const lastMovePreviewTimeRef = useRef<number>(0);
  const lastPointerUpdateTimeRef = useRef<number>(0);

  // Helper to send WS JSON message
  const sendJson = useCallback((data: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  // ── Establish WebSocket Connection ─────────────────────────────────────────
  const connect = useCallback(() => {
    const authToken = token || (typeof window !== 'undefined' ? localStorage.getItem('token') : null);
    if (!authToken || !roomId) return;

    if (wsRef.current) {
      wsRef.current.close();
    }

    setConnectionStatus('connecting');
    const ws = new WebSocket(`${WSS_URL}?token=${authToken}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('🔌 WebSocket Connected');
      setConnectionStatus('connected');

      // Join room with last known version
      sendJson({
        type: 'room:join',
        roomId,
        lastKnownVersion: revisionRef.current,
      });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          // ── 1. Initial Room State ─────────────────────────────────────────
          case 'room:state': {
            revisionRef.current = msg.revision || 0;
            if (msg.users) {
              setCollaborators(msg.users);
            }

            if (msg.elements && excalidrawAPI) {
              isApplyingRemoteUpdateRef.current = true;
              excalidrawAPI.updateScene({ elements: msg.elements });

              // Populate previousElementsMap
              const map = new Map<string, { version: number; versionNonce: number }>();
              for (const el of msg.elements) {
                if (el && el.id) {
                  map.set(el.id, { version: el.version ?? 0, versionNonce: el.versionNonce ?? 0 });
                }
              }
              previousElementsMap.current = map;

              setTimeout(() => {
                isApplyingRemoteUpdateRef.current = false;
              }, 100);
            }
            break;
          }

          // ── 2. Operation Broadcast ────────────────────────────────────────
          case 'operation:broadcast': {
            const op: ElementOperation = msg.operation;
            if (!op || !excalidrawAPI) return;

            revisionRef.current = msg.revision ?? revisionRef.current;
            const currentSceneElements: any[] = excalidrawAPI.getSceneElementsIncludingDeleted();

            const existingIndex = currentSceneElements.findIndex((el) => el.id === op.elementId);
            const existingElement = existingIndex !== -1 ? currentSceneElements[existingIndex] : undefined;

            const winning = reconcileElement(existingElement, op.element);

            if (winning === op.element) {
              isApplyingRemoteUpdateRef.current = true;

              let updatedElements: any[];
              if (existingIndex !== -1) {
                updatedElements = [...currentSceneElements];
                updatedElements[existingIndex] = winning;
              } else {
                updatedElements = [...currentSceneElements, winning];
              }

              excalidrawAPI.updateScene({ elements: updatedElements });

              // Update previous elements map
              previousElementsMap.current.set(op.elementId, {
                version: winning.version ?? 0,
                versionNonce: winning.versionNonce ?? 0,
              });

              setTimeout(() => {
                isApplyingRemoteUpdateRef.current = false;
              }, 50);
            }
            break;
          }

          // ── 3. Missed-Operation Catchup / Sync ────────────────────────────
          case 'room:sync': {
            revisionRef.current = msg.revision ?? revisionRef.current;
            if (!excalidrawAPI) return;

            if (msg.fullSync && msg.elements) {
              isApplyingRemoteUpdateRef.current = true;
              excalidrawAPI.updateScene({ elements: msg.elements });

              const map = new Map<string, { version: number; versionNonce: number }>();
              for (const el of msg.elements) {
                if (el && el.id) {
                  map.set(el.id, { version: el.version ?? 0, versionNonce: el.versionNonce ?? 0 });
                }
              }
              previousElementsMap.current = map;

              setTimeout(() => {
                isApplyingRemoteUpdateRef.current = false;
              }, 100);
            } else if (msg.operations && Array.isArray(msg.operations)) {
              isApplyingRemoteUpdateRef.current = true;
              let elements = [...excalidrawAPI.getSceneElementsIncludingDeleted()];

              for (const op of msg.operations) {
                const idx = elements.findIndex((e) => e.id === op.elementId);
                const winning = reconcileElement(idx !== -1 ? elements[idx] : undefined, op.element);
                if (winning === op.element) {
                  if (idx !== -1) {
                    elements[idx] = winning;
                  } else {
                    elements.push(winning);
                  }
                  previousElementsMap.current.set(op.elementId, {
                    version: winning.version ?? 0,
                    versionNonce: winning.versionNonce ?? 0,
                  });
                }
              }

              excalidrawAPI.updateScene({ elements });
              setTimeout(() => {
                isApplyingRemoteUpdateRef.current = false;
              }, 100);
            }
            break;
          }

          // ── 4. Ephemeral Presence (Cursors) ───────────────────────────────
          case 'presence:update': {
            const { clientId, userId, username, color, cursor, selectedElementId } = msg;
            if (!clientId) return;

            setRemoteCursors((prev) => ({
              ...prev,
              [clientId]: {
                clientId,
                userId,
                username,
                color,
                cursor,
                selectedElementId,
                lastSeen: Date.now(),
              },
            }));
            break;
          }

          // ── 5. User Joined ────────────────────────────────────────────────
          case 'user:joined': {
            if (msg.user) {
              setCollaborators((prev) => {
                const filtered = prev.filter((u) => u.clientId !== msg.user.clientId);
                return [...filtered, msg.user];
              });
            }
            break;
          }

          // ── 6. User Left ──────────────────────────────────────────────────
          case 'user:left': {
            const { clientId } = msg;
            if (clientId) {
              setCollaborators((prev) => prev.filter((u) => u.clientId !== clientId));
              setRemoteCursors((prev) => {
                const copy = { ...prev };
                delete copy[clientId];
                return copy;
              });
            }
            break;
          }

          // ── 7. Chat Message ───────────────────────────────────────────────
          case 'chat': {
            if (msg.message) {
              setChatMessages((prev) => [...prev, msg.message]);
            }
            break;
          }
        }
      } catch (err) {
        console.error('Error processing WS incoming message:', err);
      }
    };

    ws.onclose = () => {
      console.warn('⚠️ WebSocket disconnected, scheduling reconnect...');
      setConnectionStatus('reconnecting');
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 3000);
    };

    ws.onerror = (err) => {
      console.error('WebSocket Error:', err);
    };
  }, [roomId, token, sendJson, excalidrawAPI]);

  // Clean up ghost cursors every 2 seconds
  useEffect(() => {
    ghostCleanupIntervalRef.current = setInterval(() => {
      const now = Date.now();
      setRemoteCursors((prev) => {
        let changed = false;
        const next: Record<string, CollaboratorUser> = {};
        for (const [id, user] of Object.entries(prev)) {
          if (user.lastSeen && now - user.lastSeen < 5000) {
            next[id] = user;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 2000);

    return () => {
      if (ghostCleanupIntervalRef.current) {
        clearInterval(ghostCleanupIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  // ── Differential Elements Change Detection ─────────────────────────────────
  const handleElementsChange = useCallback(
    (elements: readonly any[], appState: any) => {
      if (isApplyingRemoteUpdateRef.current) return;
      if (!roomId) return;

      const now = Date.now();
      const prevMap = previousElementsMap.current;

      for (const el of elements) {
        const prev = prevMap.get(el.id);

        if (!prev) {
          // New element created
          prevMap.set(el.id, { version: el.version ?? 0, versionNonce: el.versionNonce ?? 0 });
          sendJson({
            type: 'element:create',
            roomId,
            elementId: el.id,
            element: el,
          });
        } else if (el.version > prev.version || el.versionNonce !== prev.versionNonce) {
          // Element mutated
          prevMap.set(el.id, { version: el.version ?? 0, versionNonce: el.versionNonce ?? 0 });

          if (el.isDeleted) {
            sendJson({
              type: 'element:delete',
              roomId,
              elementId: el.id,
              element: el,
            });
          } else if (isDraggingRef.current) {
            // Drag move preview throttled to 25 Hz (~40ms)
            if (now - lastMovePreviewTimeRef.current >= 40) {
              lastMovePreviewTimeRef.current = now;
              sendJson({
                type: 'element:move-preview',
                roomId,
                elementId: el.id,
                element: el,
              });
            }
          } else {
            sendJson({
              type: 'element:update',
              roomId,
              elementId: el.id,
              element: el,
            });
          }
        }
      }
    },
    [roomId, sendJson]
  );

  // ── Pointer Drag / Release ─────────────────────────────────────────────────
  const handlePointerDown = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const handlePointerUp = useCallback(
    (selectedElements?: any[]) => {
      isDraggingRef.current = false;

      // Commit final position for dragged elements
      if (selectedElements && selectedElements.length > 0 && roomId) {
        for (const el of selectedElements) {
          sendJson({
            type: 'element:move-commit',
            roomId,
            elementId: el.id,
            element: el,
          });
        }
      }
    },
    [roomId, sendJson]
  );

  // ── Ephemeral Pointer Move (25 Hz) ─────────────────────────────────────────
  const handlePointerUpdate = useCallback(
    (payload: { pointer: { x: number; y: number } }) => {
      const now = Date.now();
      if (now - lastPointerUpdateTimeRef.current < 40) return; // 25 Hz
      lastPointerUpdateTimeRef.current = now;

      sendJson({
        type: 'presence:update',
        roomId,
        cursor: payload.pointer,
      });
    },
    [roomId, sendJson]
  );

  // ── Selection Change ───────────────────────────────────────────────────────
  const handleSelectionChange = useCallback(
    (selectedElementId?: string) => {
      sendJson({
        type: 'presence:update',
        roomId,
        selectedElementId,
      });
    },
    [roomId, sendJson]
  );

  // ── Send Chat Message ──────────────────────────────────────────────────────
  const sendChatMessage = useCallback(
    (content: string) => {
      if (!content.trim()) return;
      sendJson({
        type: 'chat',
        roomId,
        content: content.trim(),
      });
    },
    [roomId, sendJson]
  );

  return {
    connectionStatus,
    isConnected: connectionStatus === 'connected',
    collaborators,
    remoteCursors,
    chatMessages,
    handleElementsChange,
    handlePointerDown,
    handlePointerUp,
    handlePointerUpdate,
    handleSelectionChange,
    sendChatMessage,
  };
}
