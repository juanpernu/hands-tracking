import { useRef, useCallback } from 'react';
import type { AgentGestureEvent, AgentGestureType } from '../types';
import type { HandFeatureVector } from '../../types/features';
import type { UseTemporalFeaturesReturn } from '../../hooks/useTemporalFeatures';
import type { MotionPattern } from '../../types/telemetry';

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

  const emit = (type: AgentGestureType, now: number): void => {
    debounceRef.current[type] = { lastEmitMs: now };
    onGestureEvent({
      type,
      hands: [],
      timestamp: now,
    });
  };

  const detectCircle = (handedness: 'Left' | 'Right', now: number): boolean => {
    const window = temporalFeatures.getWindow(handedness);
    if (window.length < CIRCLE_MIN_FRAMES) return false;

    const first = window[0];
    const last = window[window.length - 1];
    if (last.timestamp - first.timestamp < CIRCLE_MIN_DURATION_MS) return false;

    // Check motion data for circular pattern
    const motions = motionRef.current;
    const motion = motions.find(m => m.handedness === handedness);
    if (!motion) return false;
    if (motion.type !== 'circular' || motion.confidence < CIRCLE_MIN_CONFIDENCE) return false;

    if (!canEmit('circular', now)) return false;
    emit('circular', now);
    return true;
  };

  const detectPinchHold = (handedness: 'Left' | 'Right', now: number): boolean => {
    const window = temporalFeatures.getWindow(handedness);
    if (window.length < PINCH_HOLD_MIN_FRAMES) return false;

    // Check the last PINCH_HOLD_MIN_FRAMES frames for sustained pinch
    const startIdx = window.length - PINCH_HOLD_MIN_FRAMES;
    let sum = 0;
    let sumSq = 0;

    for (let i = startIdx; i < window.length; i++) {
      const val = window[i].thumbOpposition[0];
      if (val >= PINCH_HOLD_THRESHOLD) return false; // Must stay below threshold
      sum += val;
      sumSq += val * val;
    }

    const count = PINCH_HOLD_MIN_FRAMES;
    const mean = sum / count;
    const variance = sumSq / count - mean * mean;
    if (variance >= PINCH_HOLD_MAX_VARIANCE) return false;

    if (!canEmit('pinch-hold', now)) return false;
    emit('pinch-hold', now);
    return true;
  };

  const detectWave = (handedness: 'Left' | 'Right', now: number): boolean => {
    const window = temporalFeatures.getWindow(handedness);
    if (window.length < 10) return false;

    const first = window[0];
    const last = window[window.length - 1];
    if (last.timestamp - first.timestamp < WAVE_MIN_DURATION_MS) return false;

    // Check hand openness — must be open
    let opennessSum = 0;
    for (let i = 0; i < window.length; i++) {
      opennessSum += window[i].handOpenness;
    }
    if (opennessSum / window.length < WAVE_MIN_OPENNESS) return false;

    // Count sign changes in palmRoll between consecutive frames
    let signChanges = 0;
    let prevDelta = 0;

    for (let i = 1; i < window.length; i++) {
      const delta = window[i].palmOrientation.roll - window[i - 1].palmOrientation.roll;
      if (prevDelta !== 0 && delta !== 0) {
        if ((prevDelta > 0 && delta < 0) || (prevDelta < 0 && delta > 0)) {
          signChanges++;
        }
      }
      if (delta !== 0) prevDelta = delta;
    }

    if (signChanges < WAVE_MIN_SIGN_CHANGES) return false;

    if (!canEmit('wave', now)) return false;
    emit('wave', now);
    return true;
  };

  const updateMotion = useCallback((motions: MotionPattern[]) => {
    motionRef.current = motions;
  }, []);

  const detect = useCallback(() => {
    const now = performance.now();
    const handedness: ('Left' | 'Right')[] = ['Left', 'Right'];

    for (const h of handedness) {
      // Priority order: circle, pinch-hold, wave
      if (detectCircle(h, now)) continue;
      if (detectPinchHold(h, now)) continue;
      detectWave(h, now);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temporalFeatures, onGestureEvent]);

  return { detect, updateMotion };
}
