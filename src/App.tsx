import { useRef, useEffect, useState, useCallback, useMemo, memo } from 'react';
import type { CSSProperties } from 'react';
import { DraggableObject } from './components/DraggableObject';
import HandCursor from './components/HandCursor';
import CameraPreview from './components/CameraPreview';
import { DraggablePanel } from './components/DraggablePanel';
import { TelemetryOverlay } from './components/telemetry/TelemetryOverlay';
import { HandSkeleton } from './components/telemetry/HandSkeleton';
import { VelocityVectors } from './components/telemetry/VelocityVectors';
import { DualHandHUD } from './components/telemetry/DualHandHUD';
import { GestureTimeline } from './components/telemetry/GestureTimeline';
import { EventLog } from './components/telemetry/EventLog';
import GripIndicator from './components/telemetry/GripIndicator';
import { useHandTracking } from './hooks/useHandTracking';
import { useGestureDetection } from './hooks/useGestureDetection';
import { useMouseFallback } from './hooks/useMouseFallback';
import { useObjectManagement } from './hooks/useObjectManagement';
import { useHandAnalysis } from './hooks/useHandAnalysis';
import { useInteractionController } from './hooks/useInteractionController';
import { useTelemetryRecorder } from './hooks/useTelemetryRecorder';
import { useTelemetryLogger } from './hooks/useTelemetryLogger';
import { useBatchTelemetry } from './hooks/useBatchTelemetry';
import { useWindowSize } from './hooks/useWindowSize';
import { magnitude3 } from './utils/geometry';
import { usePluginRegistry } from './plugins/hooks/usePluginRegistry';
import { useActionDispatcher } from './plugins/hooks/useActionDispatcher';
import { useAgentBridge } from './agent/hooks/useAgentBridge';
import { useContextBuffer } from './agent/hooks/useContextBuffer';
import { useGestureInterpreter } from './agent/hooks/useGestureInterpreter';
import { useActionToast, ActionToastDisplay } from './components/ActionToast';
import {
  fullscreenPlugin,
  navigationPlugin,
  tabsPlugin,
  clipboardPlugin,
  speechPlugin,
  notificationsPlugin,
} from './plugins/built-in';
import type { GestureMapping } from './agent/types';
import type { ActionIntent } from './plugins/types';

// ---- Ring buffer for timeline entries ----------------------------------------

const TIMELINE_CAPACITY = 300;
const TIMELINE_WINDOW_MS = 5000;

interface TimelineEntry {
  timestamp: number;
  gesture: string;
  velocity: number;
}

interface TimelineRingBuffer {
  data: TimelineEntry[];
  head: number;
  size: number;
}

function makeTimelineBuffer(): TimelineRingBuffer {
  return { data: new Array(TIMELINE_CAPACITY), head: 0, size: 0 };
}

function pushTimeline(buf: TimelineRingBuffer, entry: TimelineEntry): void {
  buf.data[buf.head] = entry;
  buf.head = (buf.head + 1) % TIMELINE_CAPACITY;
  if (buf.size < TIMELINE_CAPACITY) buf.size++;
}

function readTimeline(buf: TimelineRingBuffer, cutoff: number): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const start = buf.size < TIMELINE_CAPACITY ? 0 : buf.head;
  for (let i = 0; i < buf.size; i++) {
    const entry = buf.data[(start + i) % TIMELINE_CAPACITY];
    if (entry && entry.timestamp > cutoff) out.push(entry);
  }
  return out;
}

// ---- Memoised child components -----------------------------------------------

const MemoEventLog = memo(EventLog);
const MemoDualHandHUD = memo(DualHandHUD);

const defaultMappings: GestureMapping[] = [
  { gesture: 'clap', action: 'browser.fullscreen:toggle' },
  { gesture: 'shake', action: 'dom.navigation:go-back' },
  { gesture: 'swipe-left', action: 'dom.navigation:go-back' },
  { gesture: 'swipe-right', action: 'dom.navigation:go-forward' },
  { gesture: 'both-spread', action: 'dom.tabs:close-tab' },
  { gesture: 'both-pinch', action: 'dom.tabs:open-tab' },
];

// ---- App ---------------------------------------------------------------------

export default function App() {
  const windowSize = useWindowSize();
  const W = windowSize.width;
  const H = windowSize.height;

  // --- Core hooks ---
  const { hands, isReady, error, videoRef } = useHandTracking();
  const detectGesture = useGestureDetection();
  const { positionRef: mousePosRef, isGrabbing: mouseGrabbing, containerRef } = useMouseFallback();
  const { objects, addObject, removeObject, moveObject, hitTest } = useObjectManagement(0);

  // --- Analysis hooks ---
  const { physicsData, gripData, motionData, gripRef, computeFrame } = useHandAnalysis();

  // --- Telemetry hooks ---
  const { record } = useTelemetryRecorder();
  const { log, processFrame, clearLog, exportLog, onClapRef } = useTelemetryLogger();
  const { record: recordBatch } = useBatchTelemetry();

  // --- Agent + Plugin hooks (must be declared before interpreter) ---
  const registry = usePluginRegistry([
    fullscreenPlugin, navigationPlugin, tabsPlugin,
    clipboardPlugin, speechPlugin, notificationsPlugin,
  ]);
  const dispatcher = useActionDispatcher(registry);
  const bridge = useAgentBridge({ enabled: false });
  const contextBuffer = useContextBuffer({ maxEvents: 50, maxMs: 10000 });
  const { toasts, addToast } = useActionToast();

  const handleAction = useCallback(async (intent: ActionIntent) => {
    const result = await dispatcher.dispatch(intent);
    addToast(intent.action, `${intent.plugin}:${intent.action}`, result);
    return result;
  }, [dispatcher, addToast]);

  const interpreter = useGestureInterpreter({
    mappings: defaultMappings,
    buffer: contextBuffer,
    bridge,
    onAction: handleAction,
  });

  // --- Interaction controller (depends on interpreter.handle) ---
  const { gestureState, hoveredId, grabbedId, grabbedIdLeft, edgeWarning, update, updateShake, updateMotion } =
    useInteractionController({ onGestureEvent: interpreter.handle });

  // --- UI state ---
  const [telemetryVisible, setTelemetryVisible] = useState(true);
  const [fps, setFps] = useState(0);
  const [flashActive, setFlashActive] = useState(false);

  // --- Refs ---
  const cursorRef = useRef<HTMLDivElement>(null);
  const gripIndicatorRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef({ count: 0, lastTime: performance.now() });

  // Ring buffer for timeline entries (never reallocated)
  const timelineBufferRef = useRef<TimelineRingBuffer>(makeTimelineBuffer());
  // Throttled reactive copy of timeline for rendering
  const [timelineEntries, setTimelineEntries] = useState<TimelineEntry[]>([]);
  const lastTimelineUpdateRef = useRef(0);

  // Keep latest hands/objects accessible from RAF without stale closures
  const handsRef = useRef(hands);
  handsRef.current = hands;
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const isReadyRef = useRef(isReady);
  isReadyRef.current = isReady;
  const WRef = useRef(W);
  WRef.current = W;
  const HRef = useRef(H);
  HRef.current = H;
  const mouseGrabbingRef = useRef(mouseGrabbing);
  mouseGrabbingRef.current = mouseGrabbing;

  // --- Main RAF interaction loop ---
  const rafCallbackRef = useRef<() => void>(() => {});

  const runFrame = useCallback(() => {
    const now = performance.now();
    const currentHands = handsRef.current;
    const currentObjects = objectsRef.current;
    const currentW = WRef.current;
    const currentH = HRef.current;

    // FPS tracking
    fpsRef.current.count++;
    if (now - fpsRef.current.lastTime >= 1000) {
      setFps(fpsRef.current.count);
      fpsRef.current.count = 0;
      fpsRef.current.lastTime = now;
    }

    const useHands = isReadyRef.current && currentHands.length > 0;

    // 1. Compute analysis (physics, grip, motion) — writes to refs + throttled setState
    const { physicsData: physics, gripData: grips, motionData: motions } = computeFrame(
      currentHands,
      now,
    );

    // 2. Record telemetry
    record(currentHands, physics, grips, motions, now);
    recordBatch(currentHands, physics, grips, motions, now);
    processFrame(currentHands, physics, grips, motions, now);

    // 3. Shake-to-clear + swipe detection
    updateShake(currentHands, physics, currentObjects, removeObject, now);
    updateMotion(motions, currentHands);

    // 4. Detect gesture
    const gesture = detectGesture(currentHands);

    // 5. Run interaction controller — returns cursor pixel + resolved gesture or null
    const result = update(
      {
        hands: currentHands,
        isReady: isReadyRef.current,
        useHands,
        gesture,
        mousePos: mousePosRef.current,
        mouseGrabbing: mouseGrabbingRef.current,
        objects: currentObjects,
        hitTest,
        addObject,
        removeObject,
        moveObject,
        gripData: grips,
        W: currentW,
        H: currentH,
      },
    );

    // 6. Drive cursor imperatively
    if (result && cursorRef.current) {
      cursorRef.current.style.transform = `translate3d(${result.cursorPixel.x}px, ${result.cursorPixel.y}px, 0)`;
    }
    if (result && gripIndicatorRef.current) {
      gripIndicatorRef.current.style.transform = `translate3d(${result.cursorPixel.x}px, ${result.cursorPixel.y}px, 0)`;
    }

    // 7. Update timeline ring buffer
    const primaryPhysics = physics[0];
    const primarySpeed = primaryPhysics ? magnitude3(primaryPhysics.palmVelocity) * currentW : 0;
    const tlEntry: TimelineEntry = {
      timestamp: now,
      gesture: result ? result.resolvedGestureState : 'idle',
      velocity: primarySpeed,
    };
    pushTimeline(timelineBufferRef.current, tlEntry);

    // Throttle reactive timeline update to ~10fps
    if (now - lastTimelineUpdateRef.current >= 100) {
      lastTimelineUpdateRef.current = now;
      const cutoff = now - TIMELINE_WINDOW_MS;
      setTimelineEntries(readTimeline(timelineBufferRef.current, cutoff));
    }
  }, [
    computeFrame,
    record,
    recordBatch,
    processFrame,
    updateShake,
    updateMotion,
    detectGesture,
    update,
    hitTest,
    addObject,
    removeObject,
    moveObject,
    mousePosRef,
  ]);

  // Store latest runFrame in a ref so the RAF loop always calls the latest version
  rafCallbackRef.current = runFrame;

  // Single RAF loop — kicks off on mount, cleans up on unmount
  useEffect(() => {
    let rafId: number;
    function loop() {
      rafCallbackRef.current();
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const handleExport = useCallback(() => {
    const data = exportLog();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `telemetry-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportLog]);

  // ---- Memoised derived values -----------------------------------------------

  // Hand cursors for draggable panels — stable as long as hands/gripData don't change
  const panelHandCursors = useMemo(() => {
    const liveGrip = gripRef.current;
    return hands.map((hand) => {
      const grip = liveGrip.find((g) => g.handedness === hand.handedness);
      const isPinching =
        hand.landmarks[4] && hand.landmarks[8]
          ? Math.hypot(
              hand.landmarks[4].x - hand.landmarks[8].x,
              hand.landmarks[4].y - hand.landmarks[8].y,
            ) < 0.07
          : false;
      const isPartialLow = grip ? grip.opennessRatio < 0.65 : false;
      const px = (1 - hand.landmarks[8].x) * W;
      const py = hand.landmarks[8].y * H;
      return { x: px, y: py, isGrabbing: isPinching || isPartialLow };
    });
    // gripRef is a ref (stable identity) — reads live data without being a dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hands, W, H]);

  // Border style based on edge warning
  const borderStyle = useMemo((): CSSProperties => {
    if (edgeWarning === 'out') {
      return {
        boxShadow: 'inset 0 0 30px rgba(255, 50, 50, 0.5)',
        border: '4px solid #FF3232',
      };
    }
    if (edgeWarning === 'near') {
      return {
        boxShadow: 'inset 0 0 20px rgba(255, 80, 50, 0.3)',
        border: '4px solid #FF5032',
        animation: 'edgePulse 0.6s ease-in-out infinite',
      };
    }
    return {
      boxShadow: 'none',
      border: '4px solid transparent',
    };
  }, [edgeWarning]);

  // Clap → screenshot via canvas capture
  // INVARIANT: Clap is detected exclusively by useTelemetryLogger (external audio/heuristic),
  // NOT by useInteractionController. The controller must NEVER emit 'clap' to avoid double-dispatch,
  // since this handler already calls interpreter.handle for clap events.
  useEffect(() => {
    onClapRef.current = () => {
      interpreter.handle({ type: 'clap', hands: handsRef.current, timestamp: performance.now() });
      setFlashActive(true);
      setTimeout(() => setFlashActive(false), 200);

      const el = containerRef.current;
      if (!el) return;

      const canvas = document.createElement('canvas');
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Copy all visible canvases (skeleton, vectors, timeline)
      const canvases = el.querySelectorAll('canvas');
      canvases.forEach((c) => {
        const rect = c.getBoundingClientRect();
        try { ctx.drawImage(c, rect.left, rect.top); } catch { /* cross-origin */ }
      });

      // Copy camera video if visible
      const video = el.querySelector('video');
      if (video) {
        const rect = video.getBoundingClientRect();
        try { ctx.drawImage(video, rect.left, rect.top, rect.width, rect.height); } catch { /* */ }
      }

      // Draw colored squares
      const squares = el.querySelectorAll('[style*="border-radius: 8px"][style*="background-color"]');
      squares.forEach((sq) => {
        const style = (sq as HTMLElement).style;
        const rect = (sq as HTMLElement).getBoundingClientRect();
        ctx.fillStyle = style.backgroundColor;
        ctx.beginPath();
        ctx.roundRect(rect.left, rect.top, rect.width, rect.height, 8);
        ctx.fill();
      });

      const link = document.createElement('a');
      link.download = `clap-screenshot-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
  }, [onClapRef, containerRef, interpreter.handle]);

  const primaryGrip = gripData[0];

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        background: '#fff',
        overflow: 'hidden',
        ...borderStyle,
        transition: edgeWarning === 'near' ? 'none' : 'border-color 300ms ease, box-shadow 300ms ease',
      }}
    >
      {/* Screenshot flash */}
      {flashActive && (
        <div style={{
          position: 'fixed', inset: 0, background: 'white',
          opacity: 0.8, zIndex: 9999, pointerEvents: 'none',
        }} />
      )}

      {/* Objects + cursor */}
      {objects.map((obj) => (
        <DraggableObject
          key={obj.id}
          {...obj}
          isHovered={hoveredId === obj.id}
          isGrabbed={grabbedId === obj.id || grabbedIdLeft === obj.id}
        />
      ))}
      <HandCursor ref={cursorRef} gestureState={gestureState} />
      <GripIndicator
        ref={gripIndicatorRef}
        gripConfidence={primaryGrip ? primaryGrip.gripForce : 0}
        visible={telemetryVisible && hands.length > 0}
      />

      {/* Telemetry overlay — press T */}
      <TelemetryOverlay
        visible={telemetryVisible}
        onToggle={() => setTelemetryVisible((v) => !v)}
      >
        <HandSkeleton
          hands={hands}
          physicsData={physicsData}
          workspaceWidth={W}
          workspaceHeight={H}
        />
        <VelocityVectors
          hands={hands}
          physicsData={physicsData}
          workspaceWidth={W}
          workspaceHeight={H}
        />
        <GestureTimeline entries={timelineEntries} workspaceWidth={W} />
      </TelemetryOverlay>

      {/* Status overlays */}
      {error && (
        <div
          style={{
            position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(255, 95, 87, 0.9)', color: 'white',
            padding: '8px 16px', borderRadius: 6, fontSize: 13, zIndex: 500,
          }}
        >
          {error} — Using mouse fallback
        </div>
      )}

      {!isReady && !error && (
        <div
          style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: 'rgba(0, 0, 0, 0.85)', color: 'white',
            padding: '20px 32px', borderRadius: 12, fontSize: 14, textAlign: 'center', zIndex: 500,
          }}
        >
          <div style={{ marginBottom: 8, fontSize: 18 }}>Loading hand tracking...</div>
          <div style={{ opacity: 0.7 }}>First load downloads ~6MB model</div>
          <div style={{ opacity: 0.5, marginTop: 8, fontSize: 12 }}>
            Mouse fallback active — press T for telemetry
          </div>
        </div>
      )}

      {/* Panels */}
      <DraggablePanel initialX={W - 340} initialY={H - 290} handCursors={panelHandCursors}>
        <CameraPreview videoRef={videoRef} visible={true} />
      </DraggablePanel>

      {telemetryVisible && (
        <>
          <DraggablePanel initialX={W - 340} initialY={20} handCursors={panelHandCursors}>
            <MemoEventLog entries={log} onClear={clearLog} onExport={handleExport} />
          </DraggablePanel>

          <DraggablePanel initialX={20} initialY={20} handCursors={panelHandCursors}>
            <MemoDualHandHUD
              physicsData={physicsData}
              gripData={gripData}
              motionData={motionData}
              fps={fps}
            />
          </DraggablePanel>
        </>
      )}

      <ActionToastDisplay toasts={toasts} />
    </div>
  );
}
