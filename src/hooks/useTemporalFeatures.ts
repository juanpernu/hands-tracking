import { useRef, useCallback } from 'react';
import type { HandFeatureVector, GesturePhase } from '../types/features';

const TEMPORAL_WINDOW_SIZE = 30; // 1 second at 30fps

export interface TemporalStats {
  handedness: 'Left' | 'Right';
  windowSize: number;
  dominantPhase: GesturePhase;
  avgHandOpenness: number;
  avgThumbIndexOpposition: number;
  curlDelta: [number, number, number, number, number];
  palmPitchDelta: number;
  palmRollDelta: number;
}

export interface UseTemporalFeaturesReturn {
  /** Push a frame into the temporal buffer. Call every frame. */
  push: (features: HandFeatureVector[]) => void;
  /** Get the current window for a hand */
  getWindow: (handedness: 'Left' | 'Right') => HandFeatureVector[];
  /** Get aggregate temporal stats */
  getStats: (handedness: 'Left' | 'Right') => TemporalStats | null;
}

interface RingBuffer {
  data: (HandFeatureVector | undefined)[];
  head: number;
  size: number;
}

function makeRingBuffer(): RingBuffer {
  return { data: new Array<HandFeatureVector | undefined>(TEMPORAL_WINDOW_SIZE), head: 0, size: 0 };
}

function pushToRing(buf: RingBuffer, frame: HandFeatureVector): void {
  buf.data[buf.head] = frame;
  buf.head = (buf.head + 1) % TEMPORAL_WINDOW_SIZE;
  if (buf.size < TEMPORAL_WINDOW_SIZE) buf.size++;
}

/** Get the oldest item in the ring buffer (index 0 = oldest). */
function ringAt(buf: RingBuffer, index: number): HandFeatureVector {
  const start = buf.size < TEMPORAL_WINDOW_SIZE ? 0 : buf.head;
  return buf.data[(start + index) % TEMPORAL_WINDOW_SIZE] as HandFeatureVector;
}

export function useTemporalFeatures(): UseTemporalFeaturesReturn {
  const buffersRef = useRef<Record<string, RingBuffer>>({});

  const getOrCreateBuffer = (handedness: string): RingBuffer => {
    if (!buffersRef.current[handedness]) {
      buffersRef.current[handedness] = makeRingBuffer();
    }
    return buffersRef.current[handedness];
  };

  const push = useCallback((features: HandFeatureVector[]) => {
    for (let i = 0; i < features.length; i++) {
      const f = features[i];
      const buf = getOrCreateBuffer(f.handedness);
      pushToRing(buf, f);
    }
  }, []);

  const getWindow = useCallback((handedness: 'Left' | 'Right'): HandFeatureVector[] => {
    const buf = buffersRef.current[handedness];
    if (!buf || buf.size === 0) return [];
    const result: HandFeatureVector[] = [];
    const start = buf.size < TEMPORAL_WINDOW_SIZE ? 0 : buf.head;
    for (let i = 0; i < buf.size; i++) {
      result.push(buf.data[(start + i) % TEMPORAL_WINDOW_SIZE] as HandFeatureVector);
    }
    return result;
  }, []);

  const getStats = useCallback((handedness: 'Left' | 'Right'): TemporalStats | null => {
    const buf = buffersRef.current[handedness];
    if (!buf || buf.size === 0) return null;

    const size = buf.size;

    // Compute dominant phase — iterate in place, no allocations
    let idleCount = 0;
    let prepCount = 0;
    let strokeCount = 0;
    let retractCount = 0;
    let opennessSum = 0;
    let thumbIdxSum = 0;

    for (let i = 0; i < size; i++) {
      const frame = ringAt(buf, i);
      switch (frame.gesturePhase) {
        case 'idle': idleCount++; break;
        case 'preparation': prepCount++; break;
        case 'stroke': strokeCount++; break;
        case 'retraction': retractCount++; break;
      }
      opennessSum += frame.handOpenness;
      thumbIdxSum += frame.thumbOpposition[0];
    }

    // Find dominant phase
    let maxCount = idleCount;
    let dominantPhase: GesturePhase = 'idle';
    if (prepCount > maxCount) { maxCount = prepCount; dominantPhase = 'preparation'; }
    if (strokeCount > maxCount) { maxCount = strokeCount; dominantPhase = 'stroke'; }
    if (retractCount > maxCount) { dominantPhase = 'retraction'; }

    // First and last frames for deltas
    const first = ringAt(buf, 0);
    const last = ringAt(buf, size - 1);

    const curlDelta: [number, number, number, number, number] = [
      last.fingerCurlRatios[0] - first.fingerCurlRatios[0],
      last.fingerCurlRatios[1] - first.fingerCurlRatios[1],
      last.fingerCurlRatios[2] - first.fingerCurlRatios[2],
      last.fingerCurlRatios[3] - first.fingerCurlRatios[3],
      last.fingerCurlRatios[4] - first.fingerCurlRatios[4],
    ];

    return {
      handedness,
      windowSize: size,
      dominantPhase,
      avgHandOpenness: opennessSum / size,
      avgThumbIndexOpposition: thumbIdxSum / size,
      curlDelta,
      palmPitchDelta: last.palmOrientation.pitch - first.palmOrientation.pitch,
      palmRollDelta: last.palmOrientation.roll - first.palmOrientation.roll,
    };
  }, []);

  return { push, getWindow, getStats };
}
