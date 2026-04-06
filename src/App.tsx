import { useRef, useEffect, useState, useCallback, useMemo, memo } from 'react';
import type { CSSProperties } from 'react';
import { DraggableObject } from './components/DraggableObject';
import HandCursor from './components/HandCursor';
import CameraPreview from './components/CameraPreview';
import { DraggablePanel } from './components/DraggablePanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TelemetryOverlay } from './components/telemetry/TelemetryOverlay';
import { HandSkeleton } from './components/telemetry/HandSkeleton';
import { VelocityVectors } from './components/telemetry/VelocityVectors';
import { DualHandHUD } from './components/telemetry/DualHandHUD';
import { GestureTimeline } from './components/telemetry/GestureTimeline';
import { EventLog } from './components/telemetry/EventLog';
import GripIndicator from './components/telemetry/GripIndicator';
import { SpatialHighlight } from './components/SpatialHighlight';
import { SpatialProximityFeedback } from './components/SpatialProximityFeedback';
import { SpatialHUD } from './components/telemetry/SpatialHUD';
import { useHandTracking } from './hooks/useHandTracking';
import { useGestureDetection } from './hooks/useGestureDetection';
import { useMouseFallback } from './hooks/useMouseFallback';
import { useObjectManagement } from './hooks/useObjectManagement';
import { useHandAnalysis } from './hooks/useHandAnalysis';
import { useInteractionController } from './hooks/useInteractionController';
import { useTelemetryRecorder } from './hooks/useTelemetryRecorder';
import { useTelemetryLogger } from './hooks/useTelemetryLogger';
import { useBatchTelemetry } from './hooks/useBatchTelemetry';
import { useDOMSpatialIndex } from './hooks/useDOMSpatialIndex';
import { useHandOverDOM } from './hooks/useHandOverDOM';
import { useSpatialFeedback } from './hooks/useSpatialFeedback';
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
import type { ActionIntent, ActionResult } from './plugins/types';
import type { SpatialEvent, SpatialTelemetryData } from './types/spatial';
import { GestureFeedbackPanel } from './components/telemetry/GestureFeedbackPanel';
import type { GestureFeedbackEntry } from './components/telemetry/GestureFeedbackPanel';
import { useTapDetection } from './hooks/useTapDetection';
import TapRipple from './components/TapRipple';
import type { TapRippleHandle } from './components/TapRipple';
import { NavigationBar } from './components/NavigationBar';
import type { NavigationBarHandle } from './components/NavigationBar';
import { useDepthTracking } from './hooks/useDepthTracking';
import { DepthIndicator } from './components/DepthIndicator';
import { NAV_BAR } from './config';

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
  const { objects, addObject, removeObject, moveObject, releaseObject, applyMomentum, hitTest } = useObjectManagement(0);

  // --- Analysis hooks ---
  const { physicsData, gripData, motionData, gripRef, computeFrame } = useHandAnalysis();

  // --- Telemetry hooks ---
  const { record } = useTelemetryRecorder();
  const { log, processFrame, addEntry, clearLog, exportLog, onClapRef } = useTelemetryLogger();
  const { record: recordBatch, recordEvent: recordBatchEvent } = useBatchTelemetry();

  // --- Spatial tracking hooks ---
  const spatialIndex = useDOMSpatialIndex();
  const handOverDOM = useHandOverDOM({ spatialIndex });
  const spatialFeedback = useSpatialFeedback({ spatialIndex });

  // Wire spatial events into telemetry log
  const addSpatialLogEntry = useCallback((event: SpatialEvent) => {
    addEntry({
      type: event.type,
      timestamp: event.timestamp,
      description: event.target
        ? `${event.type} → ${event.target}`
        : event.type,
      data: event.detail,
    });
    setSpatialEventLog((prev) => {
      const next = [...prev, event];
      return next.length > 20 ? next.slice(-20) : next;
    });
  }, [addEntry]);

  useEffect(() => {
    handOverDOM.onSpatialEvent.current = addSpatialLogEntry;
    spatialFeedback.onFeedbackEvent.current = addSpatialLogEntry;
  }, [addSpatialLogEntry, handOverDOM, spatialFeedback]);

  // --- Agent + Plugin hooks (must be declared before interpreter) ---
  const registry = usePluginRegistry([
    fullscreenPlugin, navigationPlugin, tabsPlugin,
    clipboardPlugin, speechPlugin, notificationsPlugin,
  ]);
  const dispatcher = useActionDispatcher(registry);
  const onLLMActionRef = useRef<((intent: ActionIntent) => void) | null>(null);
  const bridge = useAgentBridge({
    enabled: true,
    actions: registry.listAll().flatMap(p => p.actions),
    spatialRef: handOverDOM.handSpatialRef,
    onAction: onLLMActionRef,
  });
  const contextBuffer = useContextBuffer({ maxEvents: 50, maxMs: 10000 });
  const { toasts, addToast } = useActionToast();

  const handleAction = useCallback(async (intent: ActionIntent) => {
    const result = await dispatcher.dispatch(intent);
    addToast(intent.action, `${intent.plugin}:${intent.action}`, result);
    return result;
  }, [dispatcher, addToast]);

  // Wire LLM async responses to the same action handler
  onLLMActionRef.current = handleAction;

  const interpreter = useGestureInterpreter({
    mappings: defaultMappings,
    buffer: contextBuffer,
    bridge,
    onAction: handleAction,
  });

  const originalHandleRef = useRef(interpreter.handle);
  originalHandleRef.current = interpreter.handle;

  const handleWithFeedback = useCallback((event: import('./agent/types').AgentGestureEvent) => {
    // Log the gesture for feedback UI
    const spatial = handOverDOM.handSpatialRef.current;
    const hand = spatial?.right ?? spatial?.left;
    const selector = hand?.hoverTarget?.selector;
    setGestureFeedbackLog((prev) => {
      const entry: GestureFeedbackEntry = {
        id: ++gestureFeedbackIdRef.current,
        gesture: event.type,
        timestamp: performance.now(),
        spatial: selector,
      };
      const next = [...prev, entry];
      return next.length > 15 ? next.slice(-15) : next;
    });
    // Persist to telemetry (in-memory log + batch file)
    const eventData = {
      type: 'gesture-detected',
      timestamp: performance.now(),
      gesture: event.type,
      spatial: selector,
      hands: event.hands.length,
      grip: event.grip?.[0]?.gripType,
    };
    addEntry({
      type: 'gesture-detected',
      timestamp: eventData.timestamp,
      description: `${event.type}${selector ? ` on ${selector}` : ''}`,
      data: eventData,
    });
    recordBatchEvent(eventData);
    // Still call the original handler
    originalHandleRef.current(event);
  }, [handOverDOM, addEntry, recordBatchEvent]);

  // --- Interaction controller (depends on interpreter.handle) ---
  const { gestureState, hoveredId, grabbedId, grabbedIdLeft, edgeWarning, update, updateShake, updateMotion } =
    useInteractionController({ onGestureEvent: handleWithFeedback });

  // --- UI state ---
  const [telemetryVisible, setTelemetryVisible] = useState(true);
  const [fps, setFps] = useState(0);
  const [spatialEventLog, setSpatialEventLog] = useState<SpatialEvent[]>([]);
  const [gestureFeedbackLog, setGestureFeedbackLog] = useState<GestureFeedbackEntry[]>([]);
  const gestureFeedbackIdRef = useRef(0);

  // --- Refs ---
  const cursorRef = useRef<HTMLDivElement>(null);
  const leftCursorRef = useRef<HTMLDivElement>(null);
  const leftCursorSmoothed = useRef({ x: 0, y: 0, initialized: false });
  const gripIndicatorRef = useRef<HTMLDivElement>(null);
  const tapRippleRef = useRef<TapRippleHandle>(null);
  const navBarRef = useRef<NavigationBarHandle>(null);
  const navZoneRef = useRef({ enterTime: 0, triggered: false });
  const fpsRef = useRef({ count: 0, lastTime: performance.now() });

  // --- Tap detection ---
  const { detect: detectTap } = useTapDetection();

  // --- Depth tracking ---
  const { update: updateDepth, stateRef: depthRef } = useDepthTracking();

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
  const grabbedIdRef = useRef(grabbedId);
  const prevGrabbedIdRef = useRef<string | null>(null);
  const prevGrabbedIdLeftRef = useRef<string | null>(null);
  grabbedIdRef.current = grabbedId;
  const grabbedIdLeftRef = useRef(grabbedIdLeft);
  grabbedIdLeftRef.current = grabbedIdLeft;

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

    // 2. Build spatial telemetry data from hand-over-DOM state
    const spatialMap = new Map<string, SpatialTelemetryData>();
    const spatialState = handOverDOM.handSpatialRef.current;
    const handEntries: Array<['Left' | 'Right', typeof spatialState.left]> = [
      ['Left', spatialState.left],
      ['Right', spatialState.right],
    ];
    for (const [handedness, state] of handEntries) {
      if (state?.stack) {
        spatialMap.set(handedness, {
          topElement: state.hoverTarget?.selector ?? null,
          topElementScore: state.hoverTarget?.relevanceScore ?? 0,
          isOverInteractive: state.isOverInteractive,
          hoverDurationMs: state.hoverDurationMs,
          elementCount: state.stack.elements.length,
        });
      }
    }

    // Record telemetry
    record(currentHands, physics, grips, motions, now, spatialMap);
    recordBatch(currentHands, physics, grips, motions, now, spatialMap);
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

    // 5.3.5 Detect grab release → trigger momentum
    if (prevGrabbedIdRef.current && !currentGrabbedRight) {
      releaseObject(prevGrabbedIdRef.current);
    }
    if (prevGrabbedIdLeftRef.current && !currentGrabbedLeft) {
      releaseObject(prevGrabbedIdLeftRef.current);
    }
    prevGrabbedIdRef.current = currentGrabbedRight;
    prevGrabbedIdLeftRef.current = currentGrabbedLeft;

    // Apply momentum to released objects
    applyMomentum();

    // 5.4 Depth tracking
    updateDepth(currentHands);

    // 5.5 Spatial tracking — runs independently of interaction result
    // Track each hand's position over DOM elements
    for (const hand of currentHands) {
      const lm8 = hand.landmarks[8];
      if (lm8) {
        const px = (1 - lm8.x) * currentW;
        const py = lm8.y * currentH;
        handOverDOM.updateHandPosition(hand.handedness, px, py, now);
      }
    }

    // Update rect cache (throttled internally to 10fps)
    spatialIndex.updateRects();

    // Drag feedback — for both hands independently
    const currentGrabbedRight = grabbedIdRef.current;
    const currentGrabbedLeft = grabbedIdLeftRef.current;

    if (currentGrabbedRight) {
      const el = document.querySelector(`[data-object-id="${currentGrabbedRight}"]`);
      if (el) spatialFeedback.updateDragFeedback('Right', el, now);
    } else {
      spatialFeedback.clearDrag('Right');
    }

    if (currentGrabbedLeft) {
      const el = document.querySelector(`[data-object-id="${currentGrabbedLeft}"]`);
      if (el) spatialFeedback.updateDragFeedback('Left', el, now);
    } else {
      spatialFeedback.clearDrag('Left');
    }

    // Clear spatial state for hands that disappeared
    if (currentHands.length === 0) {
      handOverDOM.clearHand('Left');
      handOverDOM.clearHand('Right');
    } else if (currentHands.length === 1) {
      const present = currentHands[0].handedness;
      handOverDOM.clearHand(present === 'Left' ? 'Right' : 'Left');
    }

    // 6. Drive cursors imperatively
    if (result && cursorRef.current) {
      cursorRef.current.style.transform = `translate3d(${result.cursorPixel.x}px, ${result.cursorPixel.y}px, 0)`;
    }
    if (result && gripIndicatorRef.current) {
      gripIndicatorRef.current.style.transform = `translate3d(${result.cursorPixel.x}px, ${result.cursorPixel.y}px, 0)`;
    }

    // Drive left hand cursor with lerp smoothing (same as right hand)
    if (leftCursorRef.current) {
      const leftHand = currentHands.find((h) => h.handedness === 'Left');
      if (leftHand && leftHand.landmarks[8]) {
        const rawX = (1 - leftHand.landmarks[8].x) * currentW;
        const rawY = leftHand.landmarks[8].y * currentH;
        const s = leftCursorSmoothed.current;
        if (!s.initialized) {
          s.x = rawX;
          s.y = rawY;
          s.initialized = true;
        } else {
          const f = 0.3; // same lerp factor as useGestureDetection
          s.x += (rawX - s.x) * f;
          s.y += (rawY - s.y) * f;
        }
        leftCursorRef.current.style.transform = `translate3d(${s.x}px, ${s.y}px, 0)`;
        leftCursorRef.current.style.display = 'block';
      } else {
        leftCursorRef.current.style.display = 'none';
        leftCursorSmoothed.current.initialized = false;
      }
    }

    // 6.5 Tap detection — double-tap dispatches native click + ripple
    const taps = detectTap(currentHands, now);
    for (const tap of taps) {
      const px = (1 - tap.position.x) * currentW;
      const py = tap.position.y * currentH;
      const el = document.elementFromPoint(px, py);
      if (el && el instanceof HTMLElement) {
        el.click();
        tapRippleRef.current?.trigger(px, py);
      }
    }

    // 6.6 Navigation bar trigger — hand hovering in top-center zone for 1.5s
    const navState = navZoneRef.current;
    for (const hand of currentHands) {
      const lm8 = hand.landmarks[8];
      if (lm8) {
        const nx = 1 - lm8.x; // mirrored
        const ny = lm8.y;
        const inZone = ny < NAV_BAR.TRIGGER_ZONE_TOP
          && nx > NAV_BAR.TRIGGER_ZONE_LEFT
          && nx < NAV_BAR.TRIGGER_ZONE_RIGHT;

        if (inZone) {
          if (navState.enterTime === 0) navState.enterTime = now;
          if (now - navState.enterTime >= NAV_BAR.HOVER_TRIGGER_MS && !navState.triggered) {
            navState.triggered = true;
            navBarRef.current?.show();
          }
        } else {
          navState.enterTime = 0;
          navState.triggered = false;
        }
      }
    }

    // 6.7 Velocity-based scroll — palm movement directly drives iframe scroll
    // Only active when hand is in optimal depth zone (calibrated)
    const depthState = depthRef.current.right ?? depthRef.current.left;
    const inOptimalZone = depthState?.zone === 'optimal' || depthState?.zone === 'calibrating';

    if (physics.length > 0 && inOptimalZone) {
      const primaryPhys = physics[0];
      if (primaryPhys) {
        const vy = primaryPhys.palmVelocity.y;
        const vx = primaryPhys.palmVelocity.x;
        const speed = Math.sqrt(vx * vx + vy * vy);
        const noObjectGrabbed = !currentGrabbedRight && !currentGrabbedLeft;

        // Scroll when palm moves fast enough and no object is grabbed
        if (speed > 0.15 && noObjectGrabbed) {
          const scrollX = Math.round(-vx * currentW * 0.3);
          const scrollY = Math.round(vy * currentH * 0.3);
          if (Math.abs(scrollX) > 2 || Math.abs(scrollY) > 2) {
            // Try navBar iframe first, fallback to window scroll
            if (navBarRef.current?.hasIframe) {
              navBarRef.current.scrollBy(scrollX, scrollY);
            } else {
              window.scrollBy(scrollX, scrollY);
            }
          }
        }
      }
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
    releaseObject,
    applyMomentum,
    mousePosRef,
    spatialIndex,
    handOverDOM,
    spatialFeedback,
    detectTap,
    updateDepth,
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

  const handleGestureConfirm = useCallback((id: number) => {
    setGestureFeedbackLog((prev) =>
      prev.map((e) => (e.id === id ? { ...e, feedback: 'correct' as const } : e))
    );
    const entry = gestureFeedbackLog.find((e) => e.id === id);
    if (entry) {
      const eventData = { type: 'gesture-confirm', timestamp: performance.now(), gesture: entry.gesture, spatial: entry.spatial };
      addEntry({
        type: 'gesture-confirm',
        timestamp: eventData.timestamp,
        description: `Confirmed: ${entry.gesture}${entry.spatial ? ` on ${entry.spatial}` : ''}`,
        data: eventData,
      });
      recordBatchEvent(eventData);
    }
  }, [gestureFeedbackLog, addEntry, recordBatchEvent]);

  const handleGestureCorrect = useCallback((id: number, correctGesture: string) => {
    setGestureFeedbackLog((prev) =>
      prev.map((e) => (e.id === id ? { ...e, feedback: 'incorrect' as const, correction: correctGesture } : e))
    );
    const entry = gestureFeedbackLog.find((e) => e.id === id);
    if (entry) {
      const eventData = { type: 'gesture-correction', timestamp: performance.now(), detected: entry.gesture, correct: correctGesture, spatial: entry.spatial };
      addEntry({
        type: 'gesture-correction',
        timestamp: eventData.timestamp,
        description: `Correction: ${entry.gesture} → ${correctGesture}${entry.spatial ? ` on ${entry.spatial}` : ''}`,
        data: eventData,
      });
      recordBatchEvent(eventData);
    }
  }, [gestureFeedbackLog, addEntry, recordBatchEvent]);

  // Clap → send to gesture interpreter only (no screenshot)
  useEffect(() => {
    onClapRef.current = () => {
      handleWithFeedback({ type: 'clap', hands: handsRef.current, timestamp: performance.now() });
    };
  }, [onClapRef, handleWithFeedback]);

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
      {/* Navigation bar */}
      <NavigationBar ref={navBarRef} />

      {/* Tap ripple feedback */}
      <TapRipple ref={tapRippleRef} />

      {/* Depth indicator */}
      <DepthIndicator depthRef={depthRef} visible={true} />

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
      {/* Left hand cursor — always visible when left hand detected */}
      <div
        ref={leftCursorRef}
        style={{
          display: 'none',
          position: 'absolute',
          width: 20,
          height: 20,
          background: 'rgba(255, 107, 107, 0.15)',
          border: '2px solid #FF6B6B',
          boxShadow: '0 0 6px rgba(255, 107, 107, 0.3)',
          borderRadius: '50%',
          pointerEvents: 'none',
          zIndex: 1000,
          marginLeft: -10,
          marginTop: -10,
          willChange: 'transform',
        }}
      />
      <GripIndicator
        ref={gripIndicatorRef}
        gripConfidence={primaryGrip ? primaryGrip.gripForce : 0}
        visible={telemetryVisible && hands.length > 0}
      />

      {/* Spatial feedback overlays */}
      <ErrorBoundary inline fallbackLabel="Spatial highlight error">
        <SpatialHighlight
          handSpatialRef={handOverDOM.handSpatialRef}
          visible={true}
        />
      </ErrorBoundary>
      <ErrorBoundary inline fallbackLabel="Proximity feedback error">
        <SpatialProximityFeedback
          feedbackRef={spatialFeedback.feedbackRef}
          visible={true}
        />
      </ErrorBoundary>

      {/* Telemetry overlay — press T */}
      <ErrorBoundary inline fallbackLabel="Telemetry error">
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
      </ErrorBoundary>

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

          <DraggablePanel initialX={20} initialY={H - 280} handCursors={panelHandCursors}>
            <SpatialHUD
              handSpatialRef={handOverDOM.handSpatialRef}
              spatialEvents={spatialEventLog}
              ollamaConnected={bridge.isConnected}
              ollamaDebugRef={bridge.debugRef}
            />
          </DraggablePanel>

          <DraggablePanel initialX={W - 250} initialY={H - 280} handCursors={panelHandCursors}>
            <GestureFeedbackPanel
              entries={gestureFeedbackLog}
              onConfirm={handleGestureConfirm}
              onCorrect={handleGestureCorrect}
            />
          </DraggablePanel>
        </>
      )}

      <ActionToastDisplay toasts={toasts} />
    </div>
  );
}
