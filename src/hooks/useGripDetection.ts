import { useCallback, useRef } from 'react';

import type { GripState, GripType } from '../types/telemetry';
import type { HandData } from '../types/index';
import { clamp } from '../utils/geometry';
import { computeFingerCurl, classifyGrip } from '../utils/grip';

// MediaPipe landmark index chains per finger: [CMC/base, MCP, PIP, TIP]
const FINGER_CHAINS = [
  [1, 2, 3, 4],   // Thumb
  [5, 6, 7, 8],   // Index
  [9, 10, 11, 12], // Middle
  [13, 14, 15, 16], // Ring
  [17, 18, 19, 20], // Pinky
] as const;

// Number of consecutive frames required before the grip type switches (hysteresis).
const HYSTERESIS_FRAMES = 3;

// Per-hand mutable state that lives outside React renders.
interface HandState {
  prevOpennessRatio: number;
  prevTimestamp: number;
  // Hysteresis: candidate type accumulates until HYSTERESIS_FRAMES is reached.
  candidateType: GripType;
  candidateCount: number;
  confirmedType: GripType;
}

function makeHandState(): HandState {
  return {
    prevOpennessRatio: 1,
    prevTimestamp: 0,
    candidateType: 'open',
    candidateCount: 0,
    confirmedType: 'open',
  };
}

/**
 * useGripDetection
 *
 * Returns a stable callback that, given an array of hand detections and the
 * current timestamp (ms), produces one GripState per hand.
 *
 * All mutable state is held in refs — no useState, no re-renders triggered
 * by this hook alone.
 */
export function useGripDetection(): (hands: HandData[], timestamp: number) => GripState[] {
  // Map from handedness string to per-hand state so we track each hand
  // independently across frames.
  const handStates = useRef<Record<string, HandState>>({});

  const detect = useCallback((hands: HandData[], timestamp: number): GripState[] => {
    const states = handStates.current;

    return hands.map((hand): GripState => {
      const { landmarks, handedness } = hand;

      // Lazily initialise per-hand state.
      if (!states[handedness]) {
        states[handedness] = makeHandState();
      }
      const hs = states[handedness];

      // --- 1. Compute per-finger curl ---
      const fingerCurl: [number, number, number, number, number] = [
        computeFingerCurl(landmarks, FINGER_CHAINS[0][1], FINGER_CHAINS[0][2], FINGER_CHAINS[0][3]),
        computeFingerCurl(landmarks, FINGER_CHAINS[1][1], FINGER_CHAINS[1][2], FINGER_CHAINS[1][3]),
        computeFingerCurl(landmarks, FINGER_CHAINS[2][1], FINGER_CHAINS[2][2], FINGER_CHAINS[2][3]),
        computeFingerCurl(landmarks, FINGER_CHAINS[3][1], FINGER_CHAINS[3][2], FINGER_CHAINS[3][3]),
        computeFingerCurl(landmarks, FINGER_CHAINS[4][1], FINGER_CHAINS[4][2], FINGER_CHAINS[4][3]),
      ];

      // --- 2. Openness ratio (exclude thumb) ---
      const opennessRatio = clamp(
        1 - (fingerCurl[1] + fingerCurl[2] + fingerCurl[3] + fingerCurl[4]) / 4,
        0,
        1,
      );

      // --- 3. Grip force: rate of closure, clamped to [0, 1] ---
      let gripForce = 0;
      const deltaSeconds = (timestamp - hs.prevTimestamp) / 1000;

      if (hs.prevTimestamp > 0 && deltaSeconds > 0) {
        const closure = -(opennessRatio - hs.prevOpennessRatio) / deltaSeconds;
        gripForce = clamp(closure, 0, 1);
      }

      // Persist for next frame.
      hs.prevOpennessRatio = opennessRatio;
      hs.prevTimestamp = timestamp;

      // --- 4 & 5. Grip type classification with hysteresis ---
      const rawType = classifyGrip(fingerCurl, landmarks);

      if (rawType === hs.candidateType) {
        hs.candidateCount += 1;
      } else {
        hs.candidateType = rawType;
        hs.candidateCount = 1;
      }

      if (hs.candidateCount >= HYSTERESIS_FRAMES) {
        hs.confirmedType = hs.candidateType;
      }

      return {
        handedness,
        opennessRatio,
        gripForce,
        gripType: hs.confirmedType,
        fingerCurl,
        timestamp,
      };
    });
  }, []);

  return detect;
}
