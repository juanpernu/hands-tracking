// src/hooks/useHandFeatures.ts

import { useCallback } from 'react';
import type { HandData } from '../types';
import type { HandFeatureVector } from '../types/features';
import { FINGER_CHAINS } from '../config';
import {
  extractJointAngles,
  extractPalmOrientation,
  extractInterFingerSpread,
  extractThumbOpposition,
  computeHandSize,
  applyJointConstraints,
  computeFingerCurlRatio,
  computeHandOpenness,
} from '../utils/hand-features';

/**
 * useHandFeatures
 *
 * Produces a complete HandFeatureVector per hand per frame.
 * All functions are pure — no refs, no state, no re-renders.
 * The gesture phase is set to 'idle' here; it is updated by useMotionRecognition.
 */
export function useHandFeatures(): (hands: HandData[], timestamp: number) => HandFeatureVector[] {
  const compute = useCallback((hands: HandData[], timestamp: number): HandFeatureVector[] => {
    return hands.map((hand): HandFeatureVector => {
      const { landmarks, handedness } = hand;

      // 1. Hand size (normalization factor)
      const handSize = computeHandSize(landmarks);

      // 2. Joint angles (15 angles, constrained)
      const rawAngles = extractJointAngles(landmarks);
      const jointAngles = applyJointConstraints(rawAngles);

      // 3. Palm orientation (3 Euler + normal)
      const palmOrientation = extractPalmOrientation(landmarks);

      // 4. Inter-finger spread (4 angles)
      const interFingerSpread = extractInterFingerSpread(landmarks);

      // 5. Thumb opposition (4 normalized distances)
      const thumbOpposition = extractThumbOpposition(landmarks, handSize);

      // 6. Finger curl ratios (5 values)
      const fingerCurlRatios: [number, number, number, number, number] = [
        computeFingerCurlRatio(
          landmarks[FINGER_CHAINS[0][0]], landmarks[FINGER_CHAINS[0][1]],
          landmarks[FINGER_CHAINS[0][2]], landmarks[FINGER_CHAINS[0][3]],
        ),
        computeFingerCurlRatio(
          landmarks[FINGER_CHAINS[1][0]], landmarks[FINGER_CHAINS[1][1]],
          landmarks[FINGER_CHAINS[1][2]], landmarks[FINGER_CHAINS[1][3]],
        ),
        computeFingerCurlRatio(
          landmarks[FINGER_CHAINS[2][0]], landmarks[FINGER_CHAINS[2][1]],
          landmarks[FINGER_CHAINS[2][2]], landmarks[FINGER_CHAINS[2][3]],
        ),
        computeFingerCurlRatio(
          landmarks[FINGER_CHAINS[3][0]], landmarks[FINGER_CHAINS[3][1]],
          landmarks[FINGER_CHAINS[3][2]], landmarks[FINGER_CHAINS[3][3]],
        ),
        computeFingerCurlRatio(
          landmarks[FINGER_CHAINS[4][0]], landmarks[FINGER_CHAINS[4][1]],
          landmarks[FINGER_CHAINS[4][2]], landmarks[FINGER_CHAINS[4][3]],
        ),
      ];

      // 7. Hand openness
      const handOpenness = computeHandOpenness(landmarks, handSize);

      return {
        handedness,
        timestamp,
        jointAngles,
        palmOrientation,
        interFingerSpread,
        thumbOpposition,
        fingerCurlRatios,
        handOpenness,
        handSize,
        gesturePhase: 'idle', // Updated by useMotionRecognition
      };
    });
  }, []);

  return compute;
}
