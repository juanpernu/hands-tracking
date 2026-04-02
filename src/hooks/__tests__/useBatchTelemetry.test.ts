// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useBatchTelemetry } from '../useBatchTelemetry';
import type { HandData } from '../../types';
import type { HandPhysics, GripState, MotionPattern } from '../../types/telemetry';

// Mock fetch globally
const fetchMock = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal('fetch', fetchMock);

// Mock navigator.sendBeacon
const sendBeaconMock = vi.fn().mockReturnValue(true);
Object.defineProperty(globalThis, 'navigator', {
  value: { sendBeacon: sendBeaconMock },
  writable: true,
  configurable: true,
});

// Minimal fixture factories
function makeHand(handedness: 'Left' | 'Right' = 'Right'): HandData {
  const lm = { x: 0.5, y: 0.5, z: 0 };
  return { handedness, landmarks: Array(21).fill(lm) };
}

function makePhysics(handedness: 'Left' | 'Right' = 'Right'): HandPhysics {
  return {
    handedness,
    landmarks: [],
    wristVelocity: { x: 0, y: 0, z: 0 },
    palmVelocity: { x: 0, y: 0, z: 0 },
    angularVelocity: 0,
    dominantAxis: 'none',
    timestamp: 0,
    deltaMs: 16,
  };
}

function makeGrip(handedness: 'Left' | 'Right' = 'Right'): GripState {
  return {
    handedness,
    opennessRatio: 1,
    gripForce: 0,
    gripType: 'open',
    fingerCurl: [0, 0, 0, 0, 0],
    timestamp: 0,
  };
}

function makeMotion(): MotionPattern {
  return { type: 'none', confidence: 0, durationMs: 0, timestamp: 0 };
}

describe('useBatchTelemetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockClear();
    sendBeaconMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('does not flush before reaching maxFrames', () => {
    const { result } = renderHook(() =>
      useBatchTelemetry({ maxFrames: 10, maxIntervalMs: 60_000, enabled: true }),
    );

    for (let i = 0; i < 9; i++) {
      act(() => result.current.record([makeHand()], [makePhysics()], [makeGrip()], [makeMotion()], i));
    }
    expect(fetchMock).not.toHaveBeenCalled();

    // pendingFrames is updated via interval, not in record(), so advance the timer
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.pendingFrames).toBe(9);
  });

  it('flushes when maxFrames is reached', () => {
    const { result } = renderHook(() =>
      useBatchTelemetry({ maxFrames: 5, maxIntervalMs: 60_000, enabled: true }),
    );

    for (let i = 0; i < 5; i++) {
      act(() => result.current.record([makeHand()], [makePhysics()], [makeGrip()], [makeMotion()], i));
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('/api/telemetry/batch');
    const body = JSON.parse(call[1].body);
    expect(body.frames.length).toBe(5);
    expect(body.sequenceNum).toBe(1);

    // pendingFrames resets after flush is reflected by the interval
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.pendingFrames).toBe(0);
    expect(result.current.batchCount).toBe(1);
  });

  it('flushes on time interval', () => {
    const { result } = renderHook(() =>
      useBatchTelemetry({ maxFrames: 1000, maxIntervalMs: 5000, enabled: true }),
    );

    act(() => result.current.record([makeHand()], [makePhysics()], [makeGrip()], [makeMotion()], 100));

    act(() => vi.advanceTimersByTime(6000));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not record when disabled', () => {
    const { result } = renderHook(() =>
      useBatchTelemetry({ maxFrames: 2, maxIntervalMs: 60_000, enabled: false }),
    );

    for (let i = 0; i < 5; i++) {
      act(() => result.current.record([makeHand()], [makePhysics()], [makeGrip()], [makeMotion()], i));
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.pendingFrames).toBe(0);
  });

  it('uses default config when no arguments provided', () => {
    const { result } = renderHook(() => useBatchTelemetry());

    // Should not throw and should have sensible defaults
    expect(result.current.sessionId).toBeTruthy();
    expect(result.current.batchCount).toBe(0);
    expect(result.current.pendingFrames).toBe(0);
  });

  it('sends sendBeacon on beforeunload with chunked data', () => {
    const { result } = renderHook(() =>
      useBatchTelemetry({ maxFrames: 1000, maxIntervalMs: 60_000, enabled: true }),
    );

    // Record 20 frames (more than BEACON_CHUNK_SIZE of 15)
    for (let i = 0; i < 20; i++) {
      act(() => result.current.record([makeHand()], [makePhysics()], [makeGrip()], [makeMotion()], i));
    }

    // Trigger beforeunload
    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    // Should have called sendBeacon: 2 batch chunks (15 + 5) + 1 summary = 3 calls
    expect(sendBeaconMock).toHaveBeenCalledTimes(3);
    // First call should be batch endpoint
    expect(sendBeaconMock.mock.calls[0][0]).toBe('/api/telemetry/batch');
    // Last call should be session-end
    expect(sendBeaconMock.mock.calls[2][0]).toBe('/api/telemetry/session-end');
  });

  it('retries failed batches on next flush', async () => {
    // First flush will fail
    fetchMock.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() =>
      useBatchTelemetry({ maxFrames: 3, maxIntervalMs: 60_000, enabled: true }),
    );

    // Fill buffer to trigger flush (will fail)
    for (let i = 0; i < 3; i++) {
      act(() => result.current.record([makeHand()], [makePhysics()], [makeGrip()], [makeMotion()], i));
    }

    // Wait for the .catch to run
    await act(async () => { await Promise.resolve(); });

    // Reset mock -- next flush should succeed
    fetchMock.mockResolvedValue({ ok: true });

    // Record more frames to trigger second flush
    for (let i = 0; i < 3; i++) {
      act(() => result.current.record([makeHand()], [makePhysics()], [makeGrip()], [makeMotion()], 100 + i));
    }

    // Should have called fetch: 1 (failed) + 1 (retry of failed) + 1 (new batch) = 3
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
