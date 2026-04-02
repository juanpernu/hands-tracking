import { useRef, useCallback } from 'react';
import type { HandData } from '../types';
import { distance, lerp } from '../utils/geometry';
import { LANDMARK, GESTURE } from '../config';

export interface GestureResult {
  primaryCursor: { x: number; y: number } | null;
  isPinching: boolean;
  isBothPinching: boolean;
  isBothSpreading: boolean;
}

/**
 * Pure gesture detection hook — no object or scene awareness.
 *
 * Processes raw MediaPipe HandData[] into actionable gesture state:
 * - Tracks the primary hand's index-finger-tip position (normalized 0–1)
 * - Detects single-hand and two-hand pinch/spread gestures
 * - Applies lerp smoothing to the cursor via a ref to avoid re-renders
 */
export function useGestureDetection() {
  // Smoothed cursor stored in a ref so lerp updates don't trigger re-renders
  const smoothCursorRef = useRef<{ x: number; y: number } | null>(null);

  // Per-hand pinch state for hysteresis (keyed by handedness)
  const pinchStateRef = useRef<Record<string, boolean>>({});

  const detect = useCallback((hands: HandData[]): GestureResult => {
    if (hands.length === 0) {
      smoothCursorRef.current = null;
      pinchStateRef.current = {};
      return {
        primaryCursor: null,
        isPinching: false,
        isBothPinching: false,
        isBothSpreading: false,
      };
    }

    // Clear pinch state for hands that are no longer present to prevent
    // stale true values when a hand disappears mid-pinch and reappears.
    if (hands.length === 1) {
      const presentHand = hands[0].handedness;
      const otherHand = presentHand === 'Left' ? 'Right' : 'Left';
      delete pinchStateRef.current[otherHand];
    }

    // Prefer the right hand as primary; fall back to the first detected hand
    const primaryHand =
      hands.find((h) => h.handedness === 'Right') ?? hands[0];

    // --- Cursor position (normalized, before pixel conversion) ---
    const indexTip = primaryHand.landmarks[LANDMARK.INDEX_TIP];
    const rawCursor = { x: indexTip.x, y: indexTip.y };

    if (smoothCursorRef.current === null) {
      smoothCursorRef.current = { ...rawCursor };
    } else {
      smoothCursorRef.current = {
        x: lerp(smoothCursorRef.current.x, rawCursor.x, GESTURE.LERP_FACTOR),
        y: lerp(smoothCursorRef.current.y, rawCursor.y, GESTURE.LERP_FACTOR),
      };
    }

    // --- Per-hand pinch / spread detection ---
    const pinchResults = hands.map((hand) => {
      const thumb = hand.landmarks[LANDMARK.THUMB_TIP];
      const index = hand.landmarks[LANDMARK.INDEX_TIP];
      const dist = distance(thumb, index);
      const key = hand.handedness;

      const wasPinching = pinchStateRef.current[key] ?? false;

      let isPinching: boolean;
      if (wasPinching) {
        // Already pinching — only exit when clearly above the exit threshold
        isPinching = dist < GESTURE.PINCH_EXIT_THRESHOLD;
      } else {
        // Not pinching — only enter when clearly below the enter threshold
        isPinching = dist < GESTURE.PINCH_ENTER_THRESHOLD;
      }

      pinchStateRef.current[key] = isPinching;

      const isSpreading = dist > GESTURE.SPREAD_THRESHOLD;

      return { isPinching, isSpreading };
    });

    const primaryHandedness = primaryHand.handedness;
    const primaryPinchState = pinchStateRef.current[primaryHandedness] ?? false;

    const isBothPinching =
      hands.length >= 2 && pinchResults.every((r) => r.isPinching);

    const isBothSpreading =
      hands.length >= 2 && pinchResults.every((r) => r.isSpreading);

    return {
      primaryCursor: { ...smoothCursorRef.current },
      isPinching: primaryPinchState,
      isBothPinching,
      isBothSpreading,
    };
  }, []);

  return detect;
}
