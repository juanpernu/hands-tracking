import { useRef, useCallback } from 'react';
import type { AgentGestureEvent, AgentGestureType } from '../types';
import type { HandFeatureVector } from '../../types/features';
import type { UseTemporalFeaturesReturn } from '../../hooks/useTemporalFeatures';
import type { MotionPattern } from '../../types/telemetry';
import type { HandData } from '../../types';

interface DebounceState {
  lastEmitMs: number;
}

interface TemporalGestureDetectorConfig {
  temporalFeatures: UseTemporalFeaturesReturn;
  onGestureEvent: (event: AgentGestureEvent) => void;
}

const DEBOUNCE_MS: Record<string, number> = {
  circular: 2000,
  'pinch-hold': 3000,
  wave: 2000,
};

const CIRCLE_MIN_FRAMES = 15;
const CIRCLE_MIN_DURATION_MS = 500;
const CIRCLE_MIN_CONFIDENCE = 0.5;

const PINCH_HOLD_MIN_FRAMES = 20;
const PINCH_HOLD_THRESHOLD = 0.15;
const PINCH_HOLD_MAX_VARIANCE = 0.02;

const WAVE_MIN_SIGN_CHANGES = 3;
const WAVE_MIN_OPENNESS = 0.5;
const WAVE_MIN_DURATION_MS = 500;

const ROLL_DELTA_EPSILON = 0.01;
const isSignificant = (v: number) => Math.abs(v) > ROLL_DELTA_EPSILON;

export function useTemporalGestureDetector(config: TemporalGestureDetectorConfig) {
  const { temporalFeatures, onGestureEvent } = config;

  const debounceRef = useRef<Record<string, DebounceState>>({});
  const motionRef = useRef<MotionPattern[]>([]);

  const canEmit = (type: string, now: number): boolean => {
    const state = debounceRef.current[type];
    const cooldown = DEBOUNCE_MS[type] ?? 2000;
    if (!state) return true;
    return now - state.lastEmitMs >= cooldown;
  };

  const emit = (type: AgentGestureType, now: number, hands: HandData[]): void => {
    debounceRef.current[type] = { lastEmitMs: now };
    onGestureEvent({
      type,
      hands,
      timestamp: now,
    });
  };

  const detectCircle = (now: number, hands: HandData[]): boolean => {
    // Circle detection checks if ANY motion pattern is circular with sufficient confidence.
    // Circle is inherently a single-hand gesture, so we emit once per detect() call.
    const motions = motionRef.current;
    const motion = motions.find(m => m.type === 'circular' && m.confidence >= CIRCLE_MIN_CONFIDENCE);
    if (!motion) return false;

    // Verify we have enough temporal data from either hand
    let hasEnoughFrames = false;
    for (const h of (['Left', 'Right'] as const)) {
      let frameCount = 0;
      let firstTs = Infinity;
      let lastTs = 0;
      temporalFeatures.forEachInWindow(h, (frame, _i, total) => {
        frameCount = total;
        if (frame.timestamp < firstTs) firstTs = frame.timestamp;
        if (frame.timestamp > lastTs) lastTs = frame.timestamp;
      });
      if (frameCount >= CIRCLE_MIN_FRAMES && lastTs - firstTs >= CIRCLE_MIN_DURATION_MS) {
        hasEnoughFrames = true;
        break;
      }
    }
    if (!hasEnoughFrames) return false;

    if (!canEmit('circular', now)) return false;
    emit('circular', now, hands);
    return true;
  };

  const detectPinchHold = (handedness: 'Left' | 'Right', now: number, hands: HandData[]): boolean => {
    // Count frames and collect the last PINCH_HOLD_MIN_FRAMES values in-place
    let totalFrames = 0;
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    let aboveThreshold = false;

    // First pass: count total frames
    temporalFeatures.forEachInWindow(handedness, (_frame, _i, total) => {
      totalFrames = total;
    });
    if (totalFrames < PINCH_HOLD_MIN_FRAMES) return false;

    const startIdx = totalFrames - PINCH_HOLD_MIN_FRAMES;

    temporalFeatures.forEachInWindow(handedness, (frame, i) => {
      if (i < startIdx) return;
      const val = frame.thumbOpposition[0];
      if (val >= PINCH_HOLD_THRESHOLD) {
        aboveThreshold = true;
        return;
      }
      sum += val;
      sumSq += val * val;
      count++;
    });

    if (aboveThreshold || count < PINCH_HOLD_MIN_FRAMES) return false;

    const mean = sum / count;
    const variance = Math.max(0, sumSq / count - mean * mean);
    if (variance >= PINCH_HOLD_MAX_VARIANCE) return false;

    if (!canEmit('pinch-hold', now)) return false;
    emit('pinch-hold', now, hands);
    return true;
  };

  const detectWave = (handedness: 'Left' | 'Right', now: number, hands: HandData[]): boolean => {
    let totalFrames = 0;
    let firstTs = Infinity;
    let lastTs = 0;
    let opennessSum = 0;
    let signChanges = 0;
    let prevDelta = 0;
    let prevRoll: number | null = null;

    temporalFeatures.forEachInWindow(handedness, (frame, _i, total) => {
      totalFrames = total;
      if (frame.timestamp < firstTs) firstTs = frame.timestamp;
      if (frame.timestamp > lastTs) lastTs = frame.timestamp;
      opennessSum += frame.handOpenness;

      const roll = frame.palmOrientation.roll;
      if (prevRoll !== null) {
        const delta = roll - prevRoll;
        if (isSignificant(prevDelta) && isSignificant(delta)) {
          if ((prevDelta > 0 && delta < 0) || (prevDelta < 0 && delta > 0)) {
            signChanges++;
          }
        }
        if (isSignificant(delta)) prevDelta = delta;
      }
      prevRoll = roll;
    });

    if (totalFrames < 10) return false;
    if (lastTs - firstTs < WAVE_MIN_DURATION_MS) return false;
    if (opennessSum / totalFrames < WAVE_MIN_OPENNESS) return false;
    if (signChanges < WAVE_MIN_SIGN_CHANGES) return false;

    if (!canEmit('wave', now)) return false;
    emit('wave', now, hands);
    return true;
  };

  const updateMotion = useCallback((motions: MotionPattern[]) => {
    motionRef.current = motions;
  }, []);

  const detect = useCallback((hands: HandData[]) => {
    const now = performance.now();

    // M4: Clear stale motion data when no hands are present
    if (hands.length === 0) {
      motionRef.current = [];
      return;
    }

    // Circle detection is hand-agnostic — check once
    if (detectCircle(now, hands)) {
      // Circle found; skip per-hand detection for this frame
    } else {
      const handedness: ('Left' | 'Right')[] = ['Left', 'Right'];
      for (const h of handedness) {
        // Priority order: pinch-hold, wave
        if (detectPinchHold(h, now, hands)) continue;
        detectWave(h, now, hands);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temporalFeatures, onGestureEvent]);

  return { detect, updateMotion };
}
