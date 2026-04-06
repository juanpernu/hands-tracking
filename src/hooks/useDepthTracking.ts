import { useRef, useCallback } from 'react';
import type { HandData } from '../types';
import { DEPTH } from '../config';

export type DepthZone = 'calibrating' | 'too-far' | 'optimal' | 'too-close';

export interface DepthState {
  handSize: number;           // current smoothed hand size (normalized)
  zone: DepthZone;            // current zone
  calibratedMean: number;     // mean hand size from calibration
  confidence: number;         // 0-1, how confident the calibration is
}

export interface UseDepthTrackingReturn {
  update: (hands: HandData[]) => void;
  stateRef: React.MutableRefObject<{ left: DepthState | null; right: DepthState | null }>;
}

interface PerHandState {
  smoothedSize: number;
  calibrationSamples: number[];
  calibratedMean: number;
  isCalibrated: boolean;
}

function measureHandSize(hand: HandData): number {
  const wrist = hand.landmarks[0];
  const middleTip = hand.landmarks[12];
  const dx = wrist.x - middleTip.x;
  const dy = wrist.y - middleTip.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function classifyZone(handSize: number, mean: number): DepthZone {
  if (handSize > mean * DEPTH.TOO_CLOSE_MULTIPLIER) return 'too-close';
  if (handSize < mean * DEPTH.TOO_FAR_MULTIPLIER) return 'too-far';
  return 'optimal';
}

export function useDepthTracking(): UseDepthTrackingReturn {
  const perHandRef = useRef<Map<string, PerHandState>>(new Map());
  const stateRef = useRef<{ left: DepthState | null; right: DepthState | null }>({
    left: null,
    right: null,
  });

  const update = useCallback((hands: HandData[]) => {
    const perHand = perHandRef.current;

    for (const hand of hands) {
      if (!hand.landmarks || hand.landmarks.length < 13) continue;

      const key = hand.handedness === 'Left' ? 'left' : 'right';
      const rawSize = measureHandSize(hand);

      let state = perHand.get(key);
      if (!state) {
        state = {
          smoothedSize: rawSize,
          calibrationSamples: [],
          calibratedMean: 0,
          isCalibrated: false,
        };
        perHand.set(key, state);
      }

      // EMA smoothing
      state.smoothedSize =
        DEPTH.SMOOTHING_ALPHA * rawSize +
        (1 - DEPTH.SMOOTHING_ALPHA) * state.smoothedSize;

      const confidence = Math.min(
        1,
        state.calibrationSamples.length / DEPTH.CALIBRATION_FRAMES,
      );

      if (!state.isCalibrated) {
        state.calibrationSamples.push(state.smoothedSize);

        if (state.calibrationSamples.length >= DEPTH.CALIBRATION_FRAMES) {
          const sum = state.calibrationSamples.reduce((a, b) => a + b, 0);
          state.calibratedMean = sum / state.calibrationSamples.length;
          state.isCalibrated = true;
        }

        stateRef.current[key] = {
          handSize: state.smoothedSize,
          zone: 'calibrating',
          calibratedMean: state.calibratedMean,
          confidence,
        };
      } else {
        const zone = classifyZone(state.smoothedSize, state.calibratedMean);

        stateRef.current[key] = {
          handSize: state.smoothedSize,
          zone,
          calibratedMean: state.calibratedMean,
          confidence: 1,
        };
      }
    }
  }, []);

  return { update, stateRef };
}
