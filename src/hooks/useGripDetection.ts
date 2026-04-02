import { useCallback, useRef } from 'react';

import type { GripState, GripType } from '../types/telemetry';
import type { HandData, Landmark } from '../types/index';
import { clamp, distance3d, dot3, normalize3, sub3 } from '../utils/geometry';

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

/**
 * Compute the curl for a single finger using the bone-angle method.
 *
 * bone1 = direction from PIP toward MCP (proximal bone)
 * bone2 = direction from PIP toward TIP (distal bone)
 * angle  = acos(dot(bone1, bone2))
 * curl   = 1 - angle / PI  →  0 = straight, 1 = fully bent back
 *
 * We use PIP (index 2 inside the chain) as the pivot because it is the
 * knuckle that moves the most and gives the cleanest signal.
 */
function computeFingerCurl(landmarks: Landmark[], chain: readonly number[]): number {
  const [, mcpIdx, pipIdx, tipIdx] = chain;

  const mcp = landmarks[mcpIdx];
  const pip = landmarks[pipIdx];
  const tip = landmarks[tipIdx];

  if (!mcp || !pip || !tip) return 0;

  const bone1 = normalize3(sub3(mcp, pip)); // PIP → MCP direction
  const bone2 = normalize3(sub3(tip, pip)); // PIP → TIP direction

  const dotVal = clamp(dot3(bone1, bone2), -1, 1);
  const angle = Math.acos(dotVal); // 0 (straight) … PI (fully folded)

  return clamp(1 - angle / Math.PI, 0, 1);
}

/**
 * Classify raw curl values into a grip type.
 * Thresholds match the spec exactly.
 */
function classifyGrip(
  fingerCurl: readonly [number, number, number, number, number],
  landmarks: Landmark[],
): GripType {
  const [thumbCurl, indexCurl, middleCurl, ringCurl, pinkyCurl] = fingerCurl;

  // Fist: every finger tightly curled.
  if (thumbCurl > 0.7 && indexCurl > 0.7 && middleCurl > 0.7 && ringCurl > 0.7 && pinkyCurl > 0.7) {
    return 'fist';
  }

  // Open: every finger extended.
  if (thumbCurl < 0.3 && indexCurl < 0.3 && middleCurl < 0.3 && ringCurl < 0.3 && pinkyCurl < 0.3) {
    return 'open';
  }

  // Pinch: thumb + index extended, others curled, and tips close together.
  if (
    thumbCurl < 0.3 &&
    indexCurl < 0.3 &&
    middleCurl > 0.5 &&
    ringCurl > 0.5 &&
    pinkyCurl > 0.5
  ) {
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    if (thumbTip && indexTip && distance3d(thumbTip, indexTip) < 0.05) {
      return 'pinch';
    }
  }

  // Point: index extended, middle/ring/pinky curled.
  if (indexCurl < 0.3 && middleCurl > 0.6 && ringCurl > 0.6 && pinkyCurl > 0.6) {
    return 'point';
  }

  return 'partial';
}

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
        computeFingerCurl(landmarks, FINGER_CHAINS[0]),
        computeFingerCurl(landmarks, FINGER_CHAINS[1]),
        computeFingerCurl(landmarks, FINGER_CHAINS[2]),
        computeFingerCurl(landmarks, FINGER_CHAINS[3]),
        computeFingerCurl(landmarks, FINGER_CHAINS[4]),
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
