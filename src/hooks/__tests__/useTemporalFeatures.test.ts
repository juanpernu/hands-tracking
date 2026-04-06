// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTemporalFeatures } from '../useTemporalFeatures';
import type { HandFeatureVector, GesturePhase } from '../../types/features';

function makeFeatureVector(
  overrides: Partial<HandFeatureVector> = {},
): HandFeatureVector {
  return {
    handedness: 'Right',
    timestamp: 0,
    jointAngles: {
      thumb:  { mcp: 0, pip: 0, dip: 0 },
      index:  { mcp: 0, pip: 0, dip: 0 },
      middle: { mcp: 0, pip: 0, dip: 0 },
      ring:   { mcp: 0, pip: 0, dip: 0 },
      pinky:  { mcp: 0, pip: 0, dip: 0 },
    },
    palmOrientation: { pitch: 0, yaw: 0, roll: 0, normal: { x: 0, y: 1, z: 0 } },
    interFingerSpread: [0, 0, 0, 0],
    thumbOpposition: [0.5, 0.5, 0.5, 0.5],
    fingerCurlRatios: [0, 0, 0, 0, 0],
    handOpenness: 0.8,
    handSize: 0.1,
    gesturePhase: 'idle' as GesturePhase,
    ...overrides,
  };
}

describe('useTemporalFeatures', () => {
  describe('push and getWindow', () => {
    it('returns empty window for unknown handedness', () => {
      const { result } = renderHook(() => useTemporalFeatures());
      expect(result.current.getWindow('Left')).toEqual([]);
    });

    it('accumulates frames in order', () => {
      const { result } = renderHook(() => useTemporalFeatures());

      act(() => {
        result.current.push([makeFeatureVector({ timestamp: 100 })]);
        result.current.push([makeFeatureVector({ timestamp: 200 })]);
        result.current.push([makeFeatureVector({ timestamp: 300 })]);
      });

      const window = result.current.getWindow('Right');
      expect(window).toHaveLength(3);
      expect(window[0].timestamp).toBe(100);
      expect(window[1].timestamp).toBe(200);
      expect(window[2].timestamp).toBe(300);
    });

    it('handles multiple hands independently', () => {
      const { result } = renderHook(() => useTemporalFeatures());

      act(() => {
        result.current.push([
          makeFeatureVector({ handedness: 'Left', timestamp: 10 }),
          makeFeatureVector({ handedness: 'Right', timestamp: 10 }),
        ]);
      });

      expect(result.current.getWindow('Left')).toHaveLength(1);
      expect(result.current.getWindow('Right')).toHaveLength(1);
    });
  });

  describe('ring buffer overflow', () => {
    it('wraps around at window size 30, keeping newest frames', () => {
      const { result } = renderHook(() => useTemporalFeatures());

      act(() => {
        for (let i = 0; i < 40; i++) {
          result.current.push([makeFeatureVector({ timestamp: i * 100 })]);
        }
      });

      const window = result.current.getWindow('Right');
      expect(window).toHaveLength(30);
      // oldest should be frame 10 (timestamp 1000), newest frame 39 (timestamp 3900)
      expect(window[0].timestamp).toBe(1000);
      expect(window[29].timestamp).toBe(3900);
    });
  });

  describe('getStats', () => {
    it('returns null for empty buffer', () => {
      const { result } = renderHook(() => useTemporalFeatures());
      expect(result.current.getStats('Right')).toBeNull();
    });

    it('computes correct averages', () => {
      const { result } = renderHook(() => useTemporalFeatures());

      act(() => {
        result.current.push([
          makeFeatureVector({ handOpenness: 0.6, thumbOpposition: [0.2, 0, 0, 0] }),
        ]);
        result.current.push([
          makeFeatureVector({ handOpenness: 0.8, thumbOpposition: [0.4, 0, 0, 0] }),
        ]);
      });

      const stats = result.current.getStats('Right');
      expect(stats).not.toBeNull();
      expect(stats!.avgHandOpenness).toBeCloseTo(0.7);
      expect(stats!.avgThumbIndexOpposition).toBeCloseTo(0.3);
      expect(stats!.windowSize).toBe(2);
    });

    it('computes dominant phase correctly', () => {
      const { result } = renderHook(() => useTemporalFeatures());

      act(() => {
        // 3 strokes, 2 idles, 1 preparation
        result.current.push([makeFeatureVector({ gesturePhase: 'stroke' })]);
        result.current.push([makeFeatureVector({ gesturePhase: 'stroke' })]);
        result.current.push([makeFeatureVector({ gesturePhase: 'stroke' })]);
        result.current.push([makeFeatureVector({ gesturePhase: 'idle' })]);
        result.current.push([makeFeatureVector({ gesturePhase: 'idle' })]);
        result.current.push([makeFeatureVector({ gesturePhase: 'preparation' })]);
      });

      const stats = result.current.getStats('Right');
      expect(stats!.dominantPhase).toBe('stroke');
    });

    it('computes curlDelta as last minus first', () => {
      const { result } = renderHook(() => useTemporalFeatures());

      act(() => {
        result.current.push([
          makeFeatureVector({ fingerCurlRatios: [0.1, 0.2, 0.3, 0.4, 0.5] }),
        ]);
        result.current.push([
          makeFeatureVector({ fingerCurlRatios: [0.3, 0.5, 0.1, 0.6, 0.2] }),
        ]);
      });

      const stats = result.current.getStats('Right');
      expect(stats!.curlDelta[0]).toBeCloseTo(0.2);
      expect(stats!.curlDelta[1]).toBeCloseTo(0.3);
      expect(stats!.curlDelta[2]).toBeCloseTo(-0.2);
      expect(stats!.curlDelta[3]).toBeCloseTo(0.2);
      expect(stats!.curlDelta[4]).toBeCloseTo(-0.3);
    });

    it('computes palmPitchDelta and palmRollDelta', () => {
      const { result } = renderHook(() => useTemporalFeatures());

      act(() => {
        result.current.push([
          makeFeatureVector({
            palmOrientation: { pitch: 0.1, yaw: 0, roll: 0.5, normal: { x: 0, y: 1, z: 0 } },
          }),
        ]);
        result.current.push([
          makeFeatureVector({
            palmOrientation: { pitch: 0.4, yaw: 0, roll: -0.2, normal: { x: 0, y: 1, z: 0 } },
          }),
        ]);
      });

      const stats = result.current.getStats('Right');
      expect(stats!.palmPitchDelta).toBeCloseTo(0.3);
      expect(stats!.palmRollDelta).toBeCloseTo(-0.7);
    });

    it('returns correct handedness', () => {
      const { result } = renderHook(() => useTemporalFeatures());

      act(() => {
        result.current.push([makeFeatureVector({ handedness: 'Left' })]);
      });

      const stats = result.current.getStats('Left');
      expect(stats!.handedness).toBe('Left');
    });
  });
});
