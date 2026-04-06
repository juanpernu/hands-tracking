import { useRef, useCallback } from 'react';
import type { HandData } from '../types';
import { TAP } from '../config';

export interface TapEvent {
  handedness: 'Left' | 'Right';
  position: { x: number; y: number; z: number };
  timestamp: number;
  fingerDip: number; // how much the finger dipped (relative Y)
}

export type TapState = 'idle' | 'tap-down' | 'first-tap' | 'double-tap-down';

export interface TapDebugState {
  fingerExtension: number; // current finger extension (tip Y - MCP Y, normalized)
  velocity: number;        // rate of change of finger extension
  state: TapState;
}

export interface UseTapDetectionReturn {
  detect: (hands: HandData[], timestamp: number) => TapEvent[];
  debugRef: React.MutableRefObject<{ left: TapDebugState | null; right: TapDebugState | null }>;
}

interface HandTapState {
  state: TapState;
  firstTapTime: number;
  prevExtension: number;   // previous frame's finger extension
  smoothVelocity: number;  // EMA-smoothed velocity
  baselineExtension: number; // calibrated resting extension
  calibrationFrames: number;
  calibrationSum: number;
}

/**
 * Tap detection using index finger flexion (landmarks 5→7→8).
 *
 * Measures "finger extension" = Y distance from index MCP (5) to index TIP (8).
 * When the finger flexes (tap), the tip moves toward the MCP → extension decreases.
 * A tap is a rapid decrease (dip) followed by a return to baseline.
 *
 * Uses landmarks:
 *   5 = INDEX_MCP (knuckle, stable reference)
 *   7 = INDEX_DIP (tracks flexion)
 *   8 = INDEX_TIP (most movement during tap)
 */
export function useTapDetection(): UseTapDetectionReturn {
  const stateMap = useRef<Map<string, HandTapState>>(new Map());
  const debugRef = useRef<{ left: TapDebugState | null; right: TapDebugState | null }>({ left: null, right: null });

  const detect = useCallback((hands: HandData[], timestamp: number): TapEvent[] => {
    const events: TapEvent[] = [];
    const activeHands = new Set<string>();

    for (const hand of hands) {
      const key = hand.handedness;
      activeHands.add(key);

      const mcp = hand.landmarks[5];  // INDEX_MCP — stable knuckle
      const dip = hand.landmarks[7];  // INDEX_DIP — mid joint
      const tip = hand.landmarks[8];  // INDEX_TIP — fingertip

      // Finger extension = how far tip+dip are from MCP in Y axis
      // Higher Y = further down on screen = finger extended
      // When finger flexes (tap), tip Y moves UP toward MCP Y → extension decreases
      const tipExtension = tip.y - mcp.y;
      const dipExtension = dip.y - mcp.y;
      const fingerExtension = (tipExtension + dipExtension) / 2;

      let s = stateMap.current.get(key);
      if (!s) {
        s = {
          state: 'idle',
          firstTapTime: 0,
          prevExtension: fingerExtension,
          smoothVelocity: 0,
          baselineExtension: 0,
          calibrationFrames: 0,
          calibrationSum: 0,
        };
        stateMap.current.set(key, s);
      }

      // Calibrate baseline extension over first 30 frames
      if (s.calibrationFrames < 30) {
        s.calibrationSum += fingerExtension;
        s.calibrationFrames++;
        s.baselineExtension = s.calibrationSum / s.calibrationFrames;
        s.prevExtension = fingerExtension;
        const debugKey = key === 'Left' ? 'left' : 'right';
        debugRef.current[debugKey] = { fingerExtension, velocity: 0, state: 'idle' };
        continue;
      }

      // Velocity = rate of change (negative = finger flexing/dipping)
      const rawVelocity = fingerExtension - s.prevExtension;
      s.smoothVelocity = s.smoothVelocity * 0.5 + rawVelocity * 0.5; // EMA
      s.prevExtension = fingerExtension;

      // How far the finger has dipped from baseline
      const dipFromBaseline = s.baselineExtension - fingerExtension;

      const debugKey = key === 'Left' ? 'left' : 'right';
      debugRef.current[debugKey] = { fingerExtension, velocity: s.smoothVelocity, state: s.state };

      switch (s.state) {
        case 'idle':
          // Detect downward dip — finger flexing toward palm
          if (dipFromBaseline > TAP.THRESHOLD && s.smoothVelocity < -TAP.VELOCITY_THRESHOLD) {
            s.state = 'tap-down';
          }
          break;

        case 'tap-down':
          // Detect return — finger extending back
          if (dipFromBaseline < TAP.RELEASE_THRESHOLD) {
            s.state = 'first-tap';
            s.firstTapTime = timestamp;
          }
          break;

        case 'first-tap':
          if (timestamp - s.firstTapTime > TAP.DOUBLE_TAP_WINDOW_MS) {
            s.state = 'idle';
          } else if (dipFromBaseline > TAP.THRESHOLD && s.smoothVelocity < -TAP.VELOCITY_THRESHOLD) {
            s.state = 'double-tap-down';
          }
          break;

        case 'double-tap-down':
          if (dipFromBaseline < TAP.RELEASE_THRESHOLD) {
            events.push({
              handedness: hand.handedness,
              position: { x: tip.x, y: tip.y, z: tip.z },
              timestamp,
              fingerDip: dipFromBaseline,
            });
            s.state = 'idle';
          }
          break;
      }
    }

    // Clean up state for hands that disappeared
    for (const key of stateMap.current.keys()) {
      if (!activeHands.has(key)) {
        stateMap.current.delete(key);
      }
    }

    return events;
  }, []);

  return { detect, debugRef };
}
