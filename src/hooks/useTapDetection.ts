import { useRef, useCallback } from 'react';
import type { HandData } from '../types';
import { distance3d } from '../utils/geometry';
import { TAP } from '../config';

export interface TapEvent {
  handedness: 'Left' | 'Right';
  position: { x: number; y: number; z: number };
  timestamp: number;
}

export interface UseTapDetectionReturn {
  detect: (hands: HandData[], timestamp: number) => TapEvent[];
}

type TapState = 'idle' | 'tap-down' | 'first-tap' | 'double-tap-down';

interface HandTapState {
  state: TapState;
  firstTapTime: number;
}

const PALM_LANDMARK_INDICES = [0, 5, 9, 13, 17] as const;

export function useTapDetection(): UseTapDetectionReturn {
  const stateMap = useRef<Map<string, HandTapState>>(new Map());

  const detect = useCallback((hands: HandData[], timestamp: number): TapEvent[] => {
    const events: TapEvent[] = [];
    const activeHands = new Set<string>();

    for (const hand of hands) {
      const key = hand.handedness;
      activeHands.add(key);

      const palmLandmarks = PALM_LANDMARK_INDICES.map((i) => hand.landmarks[i]);
      const palmCenter = {
        x: palmLandmarks.reduce((s, l) => s + l.x, 0) / 5,
        y: palmLandmarks.reduce((s, l) => s + l.y, 0) / 5,
        z: palmLandmarks.reduce((s, l) => s + l.z, 0) / 5,
      };

      const indexTip = hand.landmarks[8];
      const tipToPalmDist = distance3d(indexTip, palmCenter);

      let handState = stateMap.current.get(key);
      if (!handState) {
        handState = { state: 'idle', firstTapTime: 0 };
        stateMap.current.set(key, handState);
      }

      switch (handState.state) {
        case 'idle':
          if (tipToPalmDist < TAP.THRESHOLD) {
            handState.state = 'tap-down';
          }
          break;

        case 'tap-down':
          if (tipToPalmDist > TAP.RELEASE_THRESHOLD) {
            handState.state = 'first-tap';
            handState.firstTapTime = timestamp;
          }
          break;

        case 'first-tap':
          if (timestamp - handState.firstTapTime > TAP.DOUBLE_TAP_WINDOW_MS) {
            handState.state = 'idle';
          } else if (tipToPalmDist < TAP.THRESHOLD) {
            handState.state = 'double-tap-down';
          }
          break;

        case 'double-tap-down':
          if (tipToPalmDist > TAP.RELEASE_THRESHOLD) {
            events.push({
              handedness: hand.handedness,
              position: { x: indexTip.x, y: indexTip.y, z: indexTip.z },
              timestamp,
            });
            handState.state = 'idle';
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

  return { detect };
}
