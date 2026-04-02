import { useRef, useEffect, useState, useCallback } from 'react';
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
import { useHandPhysics } from './hooks/useHandPhysics';
import { useGripDetection } from './hooks/useGripDetection';
import { useMotionRecognition } from './hooks/useMotionRecognition';
import { useTelemetryRecorder } from './hooks/useTelemetryRecorder';
import { useTelemetryLogger } from './hooks/useTelemetryLogger';
import { useWindowSize } from './hooks/useWindowSize';
import { normalizedToPixel, magnitude3 } from './utils/geometry';
import type { GestureState } from './types';
import type { HandPhysics as HandPhysicsType, GripState, MotionPattern } from './types/telemetry';

// Edge proximity threshold — how close (in normalized 0-1) to trigger warning
const EDGE_THRESHOLD = 0.08;

export default function App() {
  const windowSize = useWindowSize();

  // --- Core hooks ---
  const { hands, isReady, error, videoRef } = useHandTracking();
  const detectGesture = useGestureDetection();
  const { position: mousePos, isGrabbing: mouseGrabbing, containerRef } = useMouseFallback();
  const { objects, addObject, removeObject, moveObject, hitTest, clearAll } = useObjectManagement(0);

  // --- Telemetry hooks ---
  const computePhysics = useHandPhysics();
  const detectGrip = useGripDetection();
  const classifyMotion = useMotionRecognition();
  const { record } = useTelemetryRecorder();
  const { log, processFrame, clearLog, exportLog } = useTelemetryLogger();

  // --- Refs & state ---
  const cursorRef = useRef<HTMLDivElement>(null);
  const gripIndicatorRef = useRef<HTMLDivElement>(null);
  const [gestureState, setGestureState] = useState<GestureState>('idle');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [grabbedId, setGrabbedId] = useState<string | null>(null);
  const [grabbedIdLeft, setGrabbedIdLeft] = useState<string | null>(null);
  const grabOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const grabOffsetLeftRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // --- Shake-to-clear detection ---
  const shakeHistoryRef = useRef<{ directions: number[]; lastClearTime: number }>({
    directions: [],
    lastClearTime: 0,
  });
  const SHAKE_CLEAR_VELOCITY = 0.3;
  const SHAKE_CLEAR_REVERSALS = 4;
  const SHAKE_CLEAR_DEBOUNCE_MS = 2000;
  const shakeClearingRef = useRef(false);

  // --- Per-hand grip state ---
  const [partialLowGrabLeft, setPartialLowGrabLeft] = useState(false);
  const [partialLowGrabRight, setPartialLowGrabRight] = useState(false);

  // --- Edge proximity state ---
  const [edgeWarning, setEdgeWarning] = useState<'none' | 'near' | 'out'>('none');

  // --- Telemetry state (UI-bound) ---
  const [telemetryVisible, setTelemetryVisible] = useState(true);
  const [physicsData, setPhysicsData] = useState<HandPhysicsType[]>([]);
  const [gripData, setGripData] = useState<GripState[]>([]);
  const [motionData, setMotionData] = useState<MotionPattern[]>([]);
  const [fps, setFps] = useState(0);
  const [timelineEntries, setTimelineEntries] = useState<Array<{ timestamp: number; gesture: string; velocity: number }>>([]);

  // FPS counter
  const fpsRef = useRef({ count: 0, lastTime: performance.now() });

  const useHands = isReady && hands.length > 0;
  const W = windowSize.width;
  const H = windowSize.height;

  const updateInteraction = useCallback(() => {
    const now = performance.now();

    // FPS tracking
    fpsRef.current.count++;
    if (now - fpsRef.current.lastTime >= 1000) {
      setFps(fpsRef.current.count);
      fpsRef.current.count = 0;
      fpsRef.current.lastTime = now;
    }

    let cursorPixel: { x: number; y: number };
    let isPinching: boolean;
    let isBothPinching: boolean;
    let isBothSpreading: boolean;

    // --- Telemetry computation (BOTH hands) ---
    const physics = computePhysics(hands, now);
    const grips = detectGrip(hands, now);
    const motions = physics.map((p) => classifyMotion(p, now));

    setPhysicsData(physics);
    setGripData(grips);
    setMotionData(motions);

    // Detect partial-low grip for BOTH hands
    const leftGrip = grips.find((g) => g.handedness === 'Left');
    const rightGrip = grips.find((g) => g.handedness === 'Right');

    if (leftGrip) {
      const open = leftGrip.opennessRatio;
      setPartialLowGrabLeft(partialLowGrabLeft ? open < 0.8 : open < 0.65);
    } else {
      setPartialLowGrabLeft(false);
    }

    if (rightGrip) {
      const open = rightGrip.opennessRatio;
      setPartialLowGrabRight(partialLowGrabRight ? open < 0.8 : open < 0.65);
    } else {
      setPartialLowGrabRight(false);
    }

    // --- Edge detection: check if any hand is near screen edges ---
    if (isReady && hands.length === 0) {
      setEdgeWarning('out');
    } else if (hands.length > 0) {
      let nearEdge = false;
      for (const hand of hands) {
        for (const lm of [hand.landmarks[0], hand.landmarks[8]]) { // wrist + index tip
          if (
            lm.x < EDGE_THRESHOLD || lm.x > 1 - EDGE_THRESHOLD ||
            lm.y < EDGE_THRESHOLD || lm.y > 1 - EDGE_THRESHOLD
          ) {
            nearEdge = true;
            break;
          }
        }
        if (nearEdge) break;
      }
      setEdgeWarning(nearEdge ? 'near' : 'none');
    } else {
      setEdgeWarning('none');
    }

    // Record + log
    record(hands, physics, grips, motions, now);
    processFrame(physics, grips, motions, now);

    // --- Shake-to-clear: only when TWO hands ---
    if (hands.length >= 2 && physics.length > 0 && now - shakeHistoryRef.current.lastClearTime > SHAKE_CLEAR_DEBOUNCE_MS) {
      const maxSpeed = Math.max(...physics.map((p) => magnitude3(p.palmVelocity)));
      if (maxSpeed > SHAKE_CLEAR_VELOCITY) {
        const fastestHand = physics.reduce((a, b) =>
          magnitude3(a.palmVelocity) > magnitude3(b.palmVelocity) ? a : b
        );
        const dir = Math.atan2(fastestHand.palmVelocity.y, fastestHand.palmVelocity.x);
        const hist = shakeHistoryRef.current.directions;
        hist.push(dir);
        if (hist.length > 15) hist.shift();

        let reversals = 0;
        for (let j = 2; j < hist.length; j++) {
          const prev = hist[j - 1] - hist[j - 2];
          const curr = hist[j] - hist[j - 1];
          if (prev * curr < 0 && Math.abs(curr) > 0.3) reversals++;
        }

        if (reversals >= SHAKE_CLEAR_REVERSALS && objects.length > 0 && !shakeClearingRef.current) {
          shakeClearingRef.current = true;
          shakeHistoryRef.current.lastClearTime = now;
          shakeHistoryRef.current.directions = [];
          const ids = objects.map((o) => o.id);
          ids.forEach((id, i) => {
            setTimeout(() => {
              removeObject(id);
              if (i === ids.length - 1) shakeClearingRef.current = false;
            }, i * 150);
          });
        }
      } else {
        if (shakeHistoryRef.current.directions.length > 0) shakeHistoryRef.current.directions.pop();
      }
    }

    // Timeline entry
    const primaryPhysics = physics[0];
    const primarySpeed = primaryPhysics ? magnitude3(primaryPhysics.palmVelocity) * W : 0;

    if (useHands) {
      const gesture = detectGesture(hands);
      if (!gesture.primaryCursor) return;
      cursorPixel = normalizedToPixel(gesture.primaryCursor, W, H);
      isPinching = gesture.isPinching;
      isBothPinching = gesture.isBothPinching;
      isBothSpreading = gesture.isBothSpreading;
    } else {
      cursorPixel = normalizedToPixel(mousePos, W, H);
      isPinching = mouseGrabbing;
      isBothPinching = false;
      isBothSpreading = false;
    }

    // Drive cursor + grip indicator imperatively
    if (cursorRef.current) {
      cursorRef.current.style.transform = `translate3d(${cursorPixel.x}px, ${cursorPixel.y}px, 0)`;
    }
    if (gripIndicatorRef.current) {
      gripIndicatorRef.current.style.transform = `translate3d(${cursorPixel.x}px, ${cursorPixel.y}px, 0)`;
    }

    const hovered = hitTest(cursorPixel);
    setHoveredId(hovered);

    // Gesture state
    let newGestureState: GestureState = 'idle';

    if (isBothSpreading && hovered) {
      removeObject(hovered);
      newGestureState = 'deleting';
    } else if (isBothPinching) {
      addObject(cursorPixel);
      newGestureState = 'creating';
    } else if (isPinching) {
      if (grabbedId) {
        moveObject(grabbedId, {
          x: cursorPixel.x - grabOffsetRef.current.x,
          y: cursorPixel.y - grabOffsetRef.current.y,
        });
        newGestureState = 'grabbing';
      } else if (hovered) {
        const obj = objects.find((o) => o.id === hovered);
        if (obj) {
          grabOffsetRef.current = { x: cursorPixel.x - obj.x, y: cursorPixel.y - obj.y };
          setGrabbedId(hovered);
          newGestureState = 'grabbing';
        }
      }
    } else {
      if (grabbedId) setGrabbedId(null);
      newGestureState = hovered ? 'hovering' : 'idle';
    }

    // Left hand grab
    if (useHands && partialLowGrabLeft) {
      const leftHand = hands.find((h) => h.handedness === 'Left');
      if (leftHand) {
        const leftCursor = normalizedToPixel({ x: leftHand.landmarks[8].x, y: leftHand.landmarks[8].y }, W, H);
        if (grabbedIdLeft) {
          moveObject(grabbedIdLeft, {
            x: leftCursor.x - grabOffsetLeftRef.current.x,
            y: leftCursor.y - grabOffsetLeftRef.current.y,
          });
        } else {
          const leftHovered = hitTest(leftCursor);
          if (leftHovered && leftHovered !== grabbedId) {
            const obj = objects.find((o) => o.id === leftHovered);
            if (obj) {
              grabOffsetLeftRef.current = { x: leftCursor.x - obj.x, y: leftCursor.y - obj.y };
              setGrabbedIdLeft(leftHovered);
            }
          }
        }
      }
    } else {
      if (grabbedIdLeft) setGrabbedIdLeft(null);
    }

    setGestureState(newGestureState);

    setTimelineEntries((prev) => {
      const entry = { timestamp: now, gesture: newGestureState, velocity: primarySpeed };
      const cutoff = now - 5000;
      const filtered = prev.length > 300 ? prev.slice(-200) : prev;
      return [...filtered.filter((e) => e.timestamp > cutoff), entry];
    });
  }, [useHands, hands, detectGesture, mousePos, mouseGrabbing, hitTest, grabbedId, grabbedIdLeft, partialLowGrabLeft, partialLowGrabRight, objects, addObject, removeObject, moveObject, computePhysics, detectGrip, classifyMotion, record, processFrame, clearAll, W, H, isReady]);

  useEffect(() => {
    updateInteraction();
  }, [updateInteraction]);

  const primaryGrip = gripData[0];

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

  // Hand cursors for draggable panels
  const panelHandCursors = hands.map((hand) => {
    const grip = gripData.find((g) => g.handedness === hand.handedness);
    const isPinching = hand.landmarks[4] && hand.landmarks[8]
      ? Math.hypot(hand.landmarks[4].x - hand.landmarks[8].x, hand.landmarks[4].y - hand.landmarks[8].y) < 0.07
      : false;
    const isPartialLow = grip ? grip.opennessRatio < 0.65 : false;
    const pixel = normalizedToPixel({ x: hand.landmarks[8].x, y: hand.landmarks[8].y }, W, H);
    return { x: pixel.x, y: pixel.y, isGrabbing: isPinching || isPartialLow };
  });

  // Edge border style
  const borderStyle = (): React.CSSProperties => {
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
  };

  return (
    <>
      <style>{`
        @keyframes edgePulse {
          0%, 100% { border-color: #FF5032; box-shadow: inset 0 0 20px rgba(255, 80, 50, 0.3); }
          50% { border-color: transparent; box-shadow: none; }
        }
      `}</style>

      <div
        ref={containerRef}
        style={{
          position: 'fixed',
          inset: 0,
          width: '100vw',
          height: '100vh',
          background: '#fff',
          overflow: 'hidden',
          ...borderStyle(),
          transition: edgeWarning === 'near' ? 'none' : 'border-color 300ms ease, box-shadow 300ms ease',
        }}
      >
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
          <GestureTimeline
            entries={timelineEntries}
            workspaceWidth={W}
          />
        </TelemetryOverlay>

        {/* Status overlays */}
        {error && (
          <div style={{
            position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(255, 95, 87, 0.9)', color: 'white',
            padding: '8px 16px', borderRadius: 6, fontSize: 13, zIndex: 500,
          }}>
            {error} — Using mouse fallback
          </div>
        )}

        {!isReady && !error && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: 'rgba(0, 0, 0, 0.85)', color: 'white',
            padding: '20px 32px', borderRadius: 12, fontSize: 14, textAlign: 'center', zIndex: 500,
          }}>
            <div style={{ marginBottom: 8, fontSize: 18 }}>Loading hand tracking...</div>
            <div style={{ opacity: 0.7 }}>First load downloads ~6MB model</div>
            <div style={{ opacity: 0.5, marginTop: 8, fontSize: 12 }}>Mouse fallback active — press T for telemetry</div>
          </div>
        )}
        {/* Panels — same depth as cubes */}
        <DraggablePanel
          initialX={W - 340}
          initialY={H - 290}
          handCursors={panelHandCursors}
        >
          <CameraPreview videoRef={videoRef} visible={true} />
        </DraggablePanel>

        {telemetryVisible && (
          <>
            <DraggablePanel initialX={W - 340} initialY={20} handCursors={panelHandCursors}>
              <EventLog entries={log} onClear={clearLog} onExport={handleExport} />
            </DraggablePanel>

            <DraggablePanel initialX={20} initialY={20} handCursors={panelHandCursors}>
              <DualHandHUD physicsData={physicsData} gripData={gripData} motionData={motionData} fps={fps} />
            </DraggablePanel>
          </>
        )}
      </div>
    </>
  );
}
