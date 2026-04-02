/**
 * useInteractionController
 *
 * Owns all interaction logic that was previously scattered across App.tsx.
 *
 * Architecture:
 *  - All frame-to-frame mutable state lives in refs (zero re-renders per frame).
 *  - `update()` is called once per RAF frame; it reads from refs and writes back.
 *  - Reactive setState fires ONLY on MEANINGFUL transitions (gesture state change,
 *    hovered/grabbed id changes, edge warning changes) — not every frame.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import type { GestureResult } from './useGestureDetection';
import type { HandData, GestureState, DraggableObjectData } from '../types';
import type { GripState } from '../types/telemetry';
import { normalizedToPixel, magnitude3 } from '../utils/geometry';
import { INTERACTION } from '../config';

export interface InteractionOutput {
  gestureState: GestureState;
  hoveredId: string | null;
  grabbedId: string | null;
  grabbedIdLeft: string | null;
  edgeWarning: 'none' | 'near' | 'out';
}

export interface UpdateInput {
  hands: HandData[];
  isReady: boolean;
  useHands: boolean;
  gesture: GestureResult;
  mousePos: { x: number; y: number };
  mouseGrabbing: boolean;
  objects: DraggableObjectData[];
  hitTest: (point: { x: number; y: number }) => string | null;
  addObject: (point: { x: number; y: number }) => void;
  removeObject: (id: string) => void;
  moveObject: (id: string, point: { x: number; y: number }) => void;
  gripData: GripState[];
  W: number;
  H: number;
}

export function useInteractionController() {
  // --- Reactive output state (only updates on meaningful transitions) ---
  const [gestureState, setGestureState] = useState<GestureState>('idle');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [grabbedId, setGrabbedId] = useState<string | null>(null);
  const [grabbedIdLeft, setGrabbedIdLeft] = useState<string | null>(null);
  const [edgeWarning, setEdgeWarning] = useState<'none' | 'near' | 'out'>('none');

  // --- Refs for current reactive values (avoid stale closures in update) ---
  const gestureStateRef = useRef<GestureState>('idle');
  const hoveredIdRef = useRef<string | null>(null);
  const grabbedIdRef = useRef<string | null>(null);
  const grabbedIdLeftRef = useRef<string | null>(null);
  const edgeWarningRef = useRef<'none' | 'near' | 'out'>('none');

  // --- Grab offsets ---
  const grabOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const grabOffsetLeftRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // --- Partial-low grip (refs only — don't drive rendering) ---
  const partialLowGrabLeftRef = useRef(false);
  const partialLowGrabRightRef = useRef(false);

  // --- Rising-edge detection for both-pinch / both-spread ---
  const prevBothPinchingRef = useRef(false);
  const prevBothSpreadingRef = useRef(false);

  // --- Shake-to-clear ---
  const shakeHistoryRef = useRef<{ directions: number[]; lastClearTime: number }>({
    directions: [],
    lastClearTime: 0,
  });
  const shakeClearingRef = useRef(false);
  const shakeTimeoutIdsRef = useRef<number[]>([]);

  // Helper: set grabbed id with ref sync
  const applyGrabbedId = useCallback((id: string | null) => {
    if (grabbedIdRef.current !== id) {
      grabbedIdRef.current = id;
      setGrabbedId(id);
    }
  }, []);

  const applyGrabbedIdLeft = useCallback((id: string | null) => {
    if (grabbedIdLeftRef.current !== id) {
      grabbedIdLeftRef.current = id;
      setGrabbedIdLeft(id);
    }
  }, []);

  const applyGestureState = useCallback((s: GestureState) => {
    if (gestureStateRef.current !== s) {
      gestureStateRef.current = s;
      setGestureState(s);
    }
  }, []);

  const applyHoveredId = useCallback((id: string | null) => {
    if (hoveredIdRef.current !== id) {
      hoveredIdRef.current = id;
      setHoveredId(id);
    }
  }, []);

  const applyEdgeWarning = useCallback((w: 'none' | 'near' | 'out') => {
    if (edgeWarningRef.current !== w) {
      edgeWarningRef.current = w;
      setEdgeWarning(w);
    }
  }, []);

  const update = useCallback((input: UpdateInput) => {
    const {
      hands,
      isReady,
      useHands,
      gesture,
      mousePos,
      mouseGrabbing,
      objects,
      hitTest,
      addObject,
      removeObject,
      moveObject,
      gripData,
      W,
      H,
    } = input;

    // --- Update partial low grab state (refs only) ---
    const leftGrip = gripData.find((g) => g.handedness === 'Left');
    const rightGrip = gripData.find((g) => g.handedness === 'Right');

    if (leftGrip) {
      const open = leftGrip.opennessRatio;
      partialLowGrabLeftRef.current = partialLowGrabLeftRef.current ? open < INTERACTION.PARTIAL_GRAB_EXIT : open < INTERACTION.PARTIAL_GRAB_ENTER;
    } else {
      partialLowGrabLeftRef.current = false;
    }

    if (rightGrip) {
      const open = rightGrip.opennessRatio;
      partialLowGrabRightRef.current = partialLowGrabRightRef.current ? open < INTERACTION.PARTIAL_GRAB_EXIT : open < INTERACTION.PARTIAL_GRAB_ENTER;
    } else {
      partialLowGrabRightRef.current = false;
    }

    // --- Edge detection ---
    if (isReady && hands.length === 0) {
      applyEdgeWarning('out');
    } else if (hands.length > 0) {
      let nearEdge = false;
      for (const hand of hands) {
        for (const lm of INTERACTION.EDGE_LANDMARK_INDICES.map(i => hand.landmarks[i])) {
          if (
            lm.x < INTERACTION.EDGE_THRESHOLD || lm.x > 1 - INTERACTION.EDGE_THRESHOLD ||
            lm.y < INTERACTION.EDGE_THRESHOLD || lm.y > 1 - INTERACTION.EDGE_THRESHOLD
          ) {
            nearEdge = true;
            break;
          }
        }
        if (nearEdge) break;
      }
      applyEdgeWarning(nearEdge ? 'near' : 'none');
    } else {
      applyEdgeWarning('none');
    }

    // --- Determine cursor position and gesture flags ---
    let cursorPixel: { x: number; y: number };
    let isPinching: boolean;
    let isBothPinching: boolean;
    let isBothSpreading: boolean;

    if (useHands) {
      if (!gesture.primaryCursor) return null;
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

    const hovered = hitTest(cursorPixel);
    applyHoveredId(hovered);

    // --- Rising-edge detection ---
    const bothSpreadingRising = isBothSpreading && !prevBothSpreadingRef.current;
    const bothPinchingRising = isBothPinching && !prevBothPinchingRef.current;
    prevBothSpreadingRef.current = isBothSpreading;
    prevBothPinchingRef.current = isBothPinching;

    // --- Gesture-to-action mapping ---
    let newGestureState: GestureState = 'idle';

    if (bothSpreadingRising && hovered) {
      removeObject(hovered);
      if (grabbedIdRef.current === hovered) applyGrabbedId(null);
      if (grabbedIdLeftRef.current === hovered) applyGrabbedIdLeft(null);
      newGestureState = 'deleting';
    } else if (bothPinchingRising) {
      addObject(cursorPixel);
      newGestureState = 'creating';
    } else if (isPinching) {
      const currentGrabbedId = grabbedIdRef.current;
      if (currentGrabbedId) {
        const obj = objects.find((o) => o.id === currentGrabbedId);
        if (obj) {
          moveObject(currentGrabbedId, {
            x: cursorPixel.x - grabOffsetRef.current.x,
            y: cursorPixel.y - grabOffsetRef.current.y,
          });
          newGestureState = 'grabbing';
        } else {
          applyGrabbedId(null);
        }
      } else if (hovered) {
        const obj = objects.find((o) => o.id === hovered);
        if (obj) {
          grabOffsetRef.current = { x: cursorPixel.x - obj.x, y: cursorPixel.y - obj.y };
          applyGrabbedId(hovered);
          newGestureState = 'grabbing';
        }
      }
    } else {
      if (grabbedIdRef.current) applyGrabbedId(null);
      newGestureState = hovered ? 'hovering' : 'idle';
    }

    // --- Left hand grab (partial low grip) ---
    if (useHands && partialLowGrabLeftRef.current) {
      const leftHand = hands.find((h) => h.handedness === 'Left');
      if (leftHand) {
        const leftCursor = normalizedToPixel(
          { x: leftHand.landmarks[8].x, y: leftHand.landmarks[8].y },
          W,
          H,
        );
        const currentGrabbedIdLeft = grabbedIdLeftRef.current;
        if (currentGrabbedIdLeft) {
          const obj = objects.find((o) => o.id === currentGrabbedIdLeft);
          if (obj) {
            moveObject(currentGrabbedIdLeft, {
              x: leftCursor.x - grabOffsetLeftRef.current.x,
              y: leftCursor.y - grabOffsetLeftRef.current.y,
            });
          } else {
            applyGrabbedIdLeft(null);
          }
        } else {
          const leftHovered = hitTest(leftCursor);
          if (leftHovered && leftHovered !== grabbedIdRef.current) {
            const obj = objects.find((o) => o.id === leftHovered);
            if (obj) {
              grabOffsetLeftRef.current = { x: leftCursor.x - obj.x, y: leftCursor.y - obj.y };
              applyGrabbedIdLeft(leftHovered);
            }
          }
        }
      }
    } else {
      if (grabbedIdLeftRef.current) applyGrabbedIdLeft(null);
    }

    applyGestureState(newGestureState);

    return { cursorPixel, resolvedGestureState: newGestureState };
  }, [applyGestureState, applyGrabbedId, applyGrabbedIdLeft, applyHoveredId, applyEdgeWarning]);

  /**
   * Shake-to-clear update — separated so it can receive physics data.
   * Call once per frame after computeFrame().
   */
  const updateShake = useCallback((
    hands: HandData[],
    physicsData: { palmVelocity: { x: number; y: number; z: number } }[],
    objects: DraggableObjectData[],
    removeObject: (id: string) => void,
    now: number,
  ) => {
    if (
      hands.length >= 2 &&
      physicsData.length > 0 &&
      now - shakeHistoryRef.current.lastClearTime > INTERACTION.SHAKE_CLEAR_DEBOUNCE_MS
    ) {
      const maxSpeed = Math.max(...physicsData.map((p) => magnitude3(p.palmVelocity)));
      if (maxSpeed > INTERACTION.SHAKE_CLEAR_VELOCITY) {
        const fastestHand = physicsData.reduce((a, b) =>
          magnitude3(a.palmVelocity) > magnitude3(b.palmVelocity) ? a : b,
        );
        const dir = Math.atan2(fastestHand.palmVelocity.y, fastestHand.palmVelocity.x);
        const hist = shakeHistoryRef.current.directions;
        hist.push(dir);
        if (hist.length > INTERACTION.SHAKE_HISTORY_SIZE) hist.shift();

        let reversals = 0;
        for (let j = 2; j < hist.length; j++) {
          const prev = hist[j - 1] - hist[j - 2];
          const curr = hist[j] - hist[j - 1];
          if (prev * curr < 0 && Math.abs(curr) > 0.3) reversals++;
        }

        if (reversals >= INTERACTION.SHAKE_CLEAR_REVERSALS && objects.length > 0 && !shakeClearingRef.current) {
          shakeClearingRef.current = true;
          shakeHistoryRef.current.lastClearTime = now;
          shakeHistoryRef.current.directions = [];
          shakeTimeoutIdsRef.current.forEach((tid) => clearTimeout(tid));
          shakeTimeoutIdsRef.current = [];
          const ids = objects.map((o) => o.id);
          ids.forEach((id, i) => {
            const tid = window.setTimeout(() => {
              removeObject(id);
              if (i === ids.length - 1) shakeClearingRef.current = false;
            }, i * INTERACTION.SHAKE_CLEAR_INTERVAL_MS);
            shakeTimeoutIdsRef.current.push(tid);
          });
        }
      } else {
        if (shakeHistoryRef.current.directions.length > 0) shakeHistoryRef.current.directions.pop();
      }
    }
  }, []);

  // Cleanup shake timeouts on unmount
  useEffect(() => {
    return () => {
      shakeTimeoutIdsRef.current.forEach((tid) => clearTimeout(tid));
    };
  }, []);

  return {
    // Reactive state for rendering
    gestureState,
    hoveredId,
    grabbedId,
    grabbedIdLeft,
    edgeWarning,
    // Imperative updates called from RAF
    update,
    updateShake,
  };
}
