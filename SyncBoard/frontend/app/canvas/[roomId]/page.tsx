'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, useCallback } from 'react';
// @ts-expect-error Excalidraw ships this stylesheet without TypeScript declarations.
import '@excalidraw/excalidraw/index.css';
import { RoomChat } from '@/components/RoomChat';
import { useParams, useRouter } from 'next/navigation';
import { ToastContainer, toast } from 'react-toastify';
// @ts-expect-error react-toastify ships this stylesheet without TypeScript declarations.
import 'react-toastify/dist/ReactToastify.css';
import { mlService } from '@/lib/mlService';
import { useCanvasSync } from '@/hooks/useCanvasSync';
import { BACKEND_URL } from '@/config';

// HuggingFace Space root — pinged on load to wake the container
const HF_SPACE_ROOT = 'https://sanprakhar362-paddleocr.hf.space/';

const Excalidraw = dynamic(
  () => import('@excalidraw/excalidraw').then((mod) => mod.Excalidraw),
  { ssr: false }
);
const MLToolbar = dynamic(
  () => import('@/components/MLToolbar').then((mod) => mod.MLToolbar),
  { ssr: false }
);
const ElementsNavigator = dynamic(
  () => import('@/components/ElementsNavigator').then((mod) => mod.ElementsNavigator),
  { ssr: false }
);

export default function CanvasPage() {
  const router = useRouter();
  const params = useParams();
  const rawRoomId = params?.roomId;
  const roomId = Array.isArray(rawRoomId) ? rawRoomId[0] : (rawRoomId as string) || '';

  const excalidrawAPIRef = useRef<any>(null);
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUsername, setCurrentUsername] = useState<string>('Collaborator');
  const [canJoin, setCanJoin] = useState<boolean>(false);

  const [showShare, setShowShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // AppState track for screen projection of remote cursors
  const [canvasTransform, setCanvasTransform] = useState<{ scrollX: number; scrollY: number; zoom: number }>({
    scrollX: 0,
    scrollY: 0,
    zoom: 1,
  });

  // Stabilize Excalidraw API setter callback so it doesn't trigger extra re-renders
  const handleExcalidrawAPI = useCallback((api: any) => {
    excalidrawAPIRef.current = api;
    setExcalidrawAPI((prev: any) => (prev === api ? prev : api));
  }, []);

  // ── 1. Auth Guard & Auto-Join Collaborator Flow ─────────────────────────────
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('returnUrl', window.location.pathname);
      }
      router.push('/auth');
      return;
    }

    try {
      const payload = JSON.parse(
        window.atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
      );
      setCurrentUserId(payload.userId || payload.id);
      setCurrentUsername(payload.name || payload.username || 'Collaborator');
    } catch (e) {
      console.error('[Canvas] Token decode error:', e);
    }

    if (!roomId) return;

    let isMounted = true;
    fetch(`${BACKEND_URL}/room/${roomId}/join`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    })
      .then((res) => {
        if (res.ok) {
          if (isMounted) setCanJoin(true);
        } else if (res.status === 401) {
          if (typeof window !== 'undefined') {
            sessionStorage.setItem('returnUrl', window.location.pathname);
          }
          router.push('/auth');
        } else {
          // If already collaborator or owner, allow joining canvas
          if (isMounted) setCanJoin(true);
        }
      })
      .catch((err) => {
        console.warn('[Canvas] Auto-join room request warning:', err);
        if (isMounted) setCanJoin(true);
      });

    return () => {
      isMounted = false;
    };
  }, [roomId, router]);

  // ── 2. Toast listener for collaborator join notifications ───────────────────
  useEffect(() => {
    const handleUserJoined = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.username) {
        toast.info(`👋 ${detail.username} joined the board`);
      }
    };
    window.addEventListener('syncboard:user-joined', handleUserJoined);
    return () => window.removeEventListener('syncboard:user-joined', handleUserJoined);
  }, []);

  // ── 3. Warm-up: ML backend health + HF Space ping ───────────────────────────
  useEffect(() => {
    mlService
      .checkHealth()
      .then((ok) => {
        if (ok) toast.success('🤖 ML Backend Connected', { autoClose: 2000 });
      })
      .catch(() => {});

    // Fire-and-forget — wakes the HF container so first Text request is fast
    fetch(HF_SPACE_ROOT, { method: 'GET', mode: 'no-cors' }).catch(() => {});
  }, []);

  // ── 4. Member 2 Real-Time Collaboration Hook ───────────────────────────────
  const {
    connectionStatus,
    collaborators,
    remoteCursors,
    boardRevision,
    isLoadingRoom,
    ws,
    handleCanvasChange,
    handlePointerUpdate,
    handlePointerDown,
    handlePointerUp,
    reconcileAndApplyIncoming,
  } = useCanvasSync({
    roomId,
    excalidrawAPI,
    currentUserId,
    currentUsername,
    canJoin,
  });

  // ── 4. Unified Canvas Change Handler ────────────────────────────────────────
  const onExcalidrawChange = useCallback(
    (elements: readonly any[], appState: any) => {
      // Keep viewport transform updated for projecting remote cursors without re-rendering if unchanged
      if (appState) {
        const nextScrollX = appState.scrollX ?? 0;
        const nextScrollY = appState.scrollY ?? 0;
        const nextZoom = appState.zoom?.value ?? 1;

        setCanvasTransform((prev) => {
          if (
            prev.scrollX === nextScrollX &&
            prev.scrollY === nextScrollY &&
            prev.zoom === nextZoom
          ) {
            return prev;
          }
          return { scrollX: nextScrollX, scrollY: nextScrollY, zoom: nextZoom };
        });
      }

      // Delegate differential synchronization to hook
      handleCanvasChange(elements, appState);
    },
    [handleCanvasChange]
  );

  // ── 5. Unified Pointer Update Handler ───────────────────────────────────────
  const onPointerUpdate = useCallback(
    (payload: any) => {
      if (!payload?.pointer) return;
      const appState = excalidrawAPIRef.current?.getAppState();
      const selectedIds = appState?.selectedElementIds
        ? Object.keys(appState.selectedElementIds)[0]
        : null;
      handlePointerUpdate(payload, selectedIds);
    },
    [handlePointerUpdate]
  );

  // ── 6. AI Magic Generation ──────────────────────────────────────────────────
  const generateFromAI = async () => {
    if (!aiPrompt.trim() || !excalidrawAPIRef.current) return;
    setAiLoading(true);
    try {
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      if (!apiKey) {
        toast.error('Gemini API key is not configured.');
        setAiLoading(false);
        return;
      }

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: `Act as an Excalidraw Architect. Transform the following description into a valid JSON array of ExcalidrawElementSkeleton objects. OUTPUT ONLY RAW JSON — no markdown, no explanation.

Rules:
- Use convertToExcalidrawElements Skeleton API format
- Every element must have absolute x and y values
- Spread elements across at least 1500 units wide
- Minimum 250px horizontal and 200px vertical gap between shapes
- For arrows: set x/y to match the start element, use start/end id bindings
- Use professional muted colors (#a5d8ff info, #c0eb75 success, #ffc9c9 error)

User Request: ${aiPrompt}`,
                  },
                ],
              },
            ],
          }),
        }
      );

      const data = await res.json();
      const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!aiText) throw new Error('Empty AI response');
      const jsonMatch = aiText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('Invalid AI Response');
      const parsedJson = JSON.parse(jsonMatch[0]);

      const fixedJson = parsedJson.map((el: any) => {
        if (el.type === 'arrow' && el.start?.id && el.end?.id) {
          const src = parsedJson.find((s: any) => s.id === el.start.id);
          const tgt = parsedJson.find((t: any) => t.id === el.end.id);
          if (src && tgt) {
            return {
              ...el,
              x: src.x + (src.width || 100) / 2,
              y: src.y + (src.height || 50) / 2,
              points: [
                [0, 0],
                [tgt.x - src.x, tgt.y - src.y],
              ],
            };
          }
        }
        return el;
      });

      const { convertToExcalidrawElements } = await import('@excalidraw/excalidraw');
      const aiElements = convertToExcalidrawElements(fixedJson, { regenerateIds: false });

      // Insert elements directly into Excalidraw scene so standard onChange triggers real-time broadcast
      const currentElements = excalidrawAPIRef.current.getSceneElements();
      excalidrawAPIRef.current.updateScene({
        elements: [...currentElements, ...aiElements],
      });

      setShowAIModal(false);
      setAiPrompt('');
      toast.success('✨ Elements generated successfully!');
    } catch (err) {
      console.error('[AI] Generation failed:', err);
      toast.error('AI Generation Failed. Please try again.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleShare = () => {
    setShowShare(true);
    setCopied(false);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setShowShare(false), 1200);
  };

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-[#f0f0f0]"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      {/* Top Presence & Status Header Bar */}
      <div className="fixed top-3 left-3 z-50 flex items-center gap-2 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-xl shadow-md border border-slate-200">
        <div className="flex items-center gap-1.5">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              connectionStatus === 'connected'
                ? 'bg-emerald-500 animate-pulse'
                : connectionStatus === 'reconnecting'
                ? 'bg-amber-500 animate-ping'
                : 'bg-rose-500'
            }`}
          />
          <span className="text-xs font-semibold text-slate-700 capitalize">
            {connectionStatus}
          </span>
        </div>

        <div className="h-3.5 w-px bg-slate-200" />

        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-500">Rev:</span>
          <span className="text-xs font-mono font-bold text-slate-700">{boardRevision}</span>
        </div>

        <div className="h-3.5 w-px bg-slate-200" />
        <div className="flex items-center -space-x-1.5 overflow-hidden ml-1">
          {/* Current user avatar */}
          <div
            title={`${currentUsername} (You)`}
            className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white bg-blue-600 ring-2 ring-white shadow-sm z-10 select-none cursor-default"
          >
            {(currentUsername || 'U').charAt(0).toUpperCase()}
          </div>
          {/* Remote collaborators avatars */}
          {collaborators.map((c, idx) => (
            <div
              key={c.clientId}
              title={`${c.username || 'Collaborator'}`}
              className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ring-2 ring-white shadow-sm select-none cursor-default"
              style={{ backgroundColor: c.color || '#10b981', zIndex: 9 - idx }}
            >
              {(c.username || 'C').charAt(0).toUpperCase()}
            </div>
          ))}
        </div>
        {collaborators.length > 0 && (
          <span className="text-xs text-slate-500 font-medium ml-1">
            {collaborators.length + 1}
          </span>
        )}
      </div>

      {/* Main Excalidraw Canvas */}
      <Excalidraw
        excalidrawAPI={handleExcalidrawAPI}
        theme="light"
        onChange={onExcalidrawChange}
        onPointerUpdate={onPointerUpdate}
        UIOptions={{
          canvasActions: {
            loadScene: true,
            export: { saveFileToDisk: true },
            saveAsImage: true,
          },
        }}
      />

      {/* Loading Overlay */}
      {isLoadingRoom && (
        <div className="fixed inset-0 z-30 pointer-events-none flex items-center justify-center bg-white/40 backdrop-blur-[2px]">
          <div className="bg-white/95 px-4 py-2 rounded-xl shadow-lg border border-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-blue-600 animate-ping" />
            Syncing room state...
          </div>
        </div>
      )}

      {/* High-Performance Remote Cursors Overlay (Projected World-to-Screen) */}
      <div className="absolute inset-0 pointer-events-none z-40 overflow-hidden">
        {Object.values(remoteCursors).map((cursor) => {
          const screenX = (cursor.x + canvasTransform.scrollX) * canvasTransform.zoom;
          const screenY = (cursor.y + canvasTransform.scrollY) * canvasTransform.zoom;

          return (
            <div
              key={cursor.clientId}
              className="absolute pointer-events-none will-change-transform"
              style={{
                transform: `translate3d(${screenX}px, ${screenY}px, 0)`,
                transition: 'transform 0.05s linear',
              }}
            >
              <div className="relative">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5.65376 12.3673H5.46026L5.31717 12.4976L0.500002 16.8829L0.500002 1.19841L11.7841 12.3673H5.65376Z"
                    fill={cursor.color}
                    stroke="white"
                    strokeWidth="2"
                  />
                </svg>
                <div
                  className="absolute left-4 top-3 whitespace-nowrap px-2 py-0.5 rounded shadow text-[10px] font-bold text-white tracking-wide select-none"
                  style={{ backgroundColor: cursor.color }}
                >
                  {cursor.username}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Floating Control Bar */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-white/90 backdrop-blur-md px-4 py-2 rounded-xl shadow-lg border border-slate-200">
        <button
          onClick={() => setShowAIModal(true)}
          className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:opacity-90 transition shadow-sm"
        >
          AI Magic ✨
        </button>

        <div className="flex items-center gap-1 text-xs text-slate-500 font-medium px-2 py-1 bg-slate-100 rounded-md">
          <span>⚡ Auto-sync active</span>
        </div>

        <button
          onClick={handleShare}
          className="text-sm font-semibold text-blue-600 border border-blue-600 rounded-lg px-4 py-1.5 bg-white hover:bg-blue-50 transition-all shadow-sm"
        >
          Share
        </button>
      </div>

      {/* AI Modal */}
      {showAIModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]">
          <div className="bg-white p-6 rounded-2xl w-[450px] shadow-2xl">
            <h3 className="text-lg font-bold mb-3 text-gray-800">Generate with SyncBoard AI</h3>
            <h5 className="text-sm mb-3 text-gray-600">
              Describe the diagram, workflow, or system architecture you want to construct:
            </h5>
            <textarea
              autoFocus
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              className="w-full border-2 border-gray-100 p-3 rounded-xl focus:border-blue-500 outline-none transition h-32 text-sm text-slate-800"
              placeholder="e.g. A microservices architecture with an API gateway, auth service, database, and message queue..."
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setShowAIModal(false)}
                className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                disabled={aiLoading}
                onClick={generateFromAI}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-semibold disabled:bg-blue-300 transition"
              >
                {aiLoading ? 'Thinking...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Popup */}
      {showShare && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-white border border-slate-200 rounded-lg shadow-xl p-4 w-72 z-50">
          <div className="flex justify-between items-center mb-2 text-sm font-semibold text-blue-600">
            <span>Share Link</span>
            <button
              onClick={() => setShowShare(false)}
              className="text-blue-600 text-xl font-semibold leading-none"
            >
              ×
            </button>
          </div>
          <div className="flex gap-2">
            <input
              readOnly
              value={typeof window !== 'undefined' ? window.location.href : ''}
              className="flex-1 text-black text-xs px-2 py-1.5 rounded border bg-slate-50"
            />
            <button
              onClick={handleCopyLink}
              className={`text-xs px-3 py-1.5 rounded font-medium text-white transition ${
                copied ? 'bg-green-500' : 'bg-blue-600'
              }`}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Text Chat Integration */}
      <RoomChat roomId={roomId} ws={ws} currentUserId={currentUserId} />

      {/* Machine Learning & Toolbar Extensions */}
      {excalidrawAPI && <MLToolbar excalidrawAPI={excalidrawAPI} />}
      {excalidrawAPI && <ElementsNavigator excalidrawAPI={excalidrawAPI} />}

      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnHover
        theme="light"
      />
    </div>
  );
}
