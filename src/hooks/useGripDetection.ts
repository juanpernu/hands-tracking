import { useCallback, useRef } from 'react';

import type { GripState, GripType } from '../types/telemetry';
import type { HandData } from '../types/index';
import { clamp } from '../utils/geometry';
import { computeFingerCurl, classifyGripAdvanced } from '../utils/grip';
import { extractJointAngles, extractThumbOpposition, extractPalmOrientation, computeHandSize } from '../utils/hand-features';
import { GRIP, FINGER_CHAINS } from '../config';

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
        1 - (fingerCurl[1] + fingerCurl[2] + fingerCurl[3] + fingerCurl[4]) / GRIP.NON_THUMB_FINGER_COUNT,
        0,
        1,
      );

      // --- 3. Grip force: rate of closure, clamped to [0, 1] ---
      const deltaSeconds = (timestamp - hs.prevTimestamp) / 1000;
      let gripForce = 0;

      if (hs.prevTimestamp > 0 && deltaSeconds > 0) {
        const closure = -(opennessRatio - hs.prevOpennessRatio) / deltaSeconds;
        gripForce = clamp(closure, 0, 1);
      } else if (hs.prevTimestamp > 0) {
        // deltaSeconds is 0 (duplicate timestamp) — keep previous grip force
        gripForce = 0;
      }

      // Persist for next frame.
      hs.prevOpennessRatio = opennessRatio;
      hs.prevTimestamp = timestamp;

      // --- 4 & 5. Grip type classification with hysteresis ---
      const jointAngles = extractJointAngles(landmarks);
      const handSize = computeHandSize(landmarks);
      const thumbOpp = extractThumbOpposition(landmarks, handSize);
      const palmOri = extractPalmOrientation(landmarks);

      const rawType = classifyGripAdvanced(fingerCurl, landmarks, jointAngles, thumbOpp, palmOri);

      if (rawType === hs.candidateType) {
        hs.candidateCount += 1;
      } else {
        hs.candidateType = rawType;
        hs.candidateCount = 1;
      }

      if (hs.candidateCount >= GRIP.HYSTERESIS_FRAMES) {
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
