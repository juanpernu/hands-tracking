import { useRef, useCallback, useEffect, useState } from 'react';
import type { HandData } from '../types';
import type {
  HandPhysics,
  GripState,
  MotionPattern,
  HandTelemetry,
  GestureEvent,
} from '../types/telemetry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BatchConfig {
  maxFrames?: number;
  maxIntervalMs?: number;
  enabled?: boolean;
}

interface BatchTelemetryResult {
  record: (
    hands: HandData[],
    physics: HandPhysics[],
    grips: GripState[],
    motions: MotionPattern[],
    timestamp: number,
  ) => void;
  sessionId: string;
  batchCount: number;
  pendingFrames: number;
}

interface PendingBatch {
  frames: HandTelemetry[];
  events: GestureEvent[];
  startTime: number;
  endTime: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const MAX_RETRY_QUEUE = 10;
const BEACON_CHUNK_SIZE = 15; // ~15 frames * ~3KB ≈ 45KB, well under sendBeacon's 64KB limit
const DEFAULT_MAX_FRAMES = 500;
const DEFAULT_MAX_INTERVAL_MS = 10_000;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBatchTelemetry(config: BatchConfig = {}): BatchTelemetryResult {
  const maxFrames = config.maxFrames ?? DEFAULT_MAX_FRAMES;
  const maxIntervalMs = config.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS;
  const enabled = config.enabled ?? true;

  // sessionId is stable for the lifetime of the component.
  const [sessionId] = useState(() => generateId());

  const frameCounterRef = useRef(0);
  const sequenceRef = useRef(0);
  const [batchCount, setBatchCount] = useState(0);
  const [pendingFrames, setPendingFrames] = useState(0);

  const bufferRef = useRef<PendingBatch>({
    frames: [],
    events: [],
    startTime: 0,
    endTime: 0,
  });
  const lastFlushRef = useRef(0);

  const statsRef = useRef({
    totalFrames: 0,
    totalEvents: 0,
    firstTimestamp: 0,
    lastTimestamp: 0,
    eventBreakdown: {} as Record<string, number>,
  });

  const retryQueueRef = useRef<{ payload: string; retries: number }[]>([]);

  // Keep sessionId accessible in callbacks without stale closures.
  const sessionIdRef = useRef(sessionId);

  // -----------------------------------------------------------------------
  // flush – process retry queue FIRST, then send the new batch
  // -----------------------------------------------------------------------
  const flush = useCallback(() => {
    const buf = bufferRef.current;
    if (buf.frames.length === 0) return;

    // Process retry queue FIRST
    const retries = retryQueueRef.current;
    retryQueueRef.current = [];
    for (const item of retries) {
      if (item.retries >= MAX_RETRIES) {
        console.warn('[batch-telemetry] Dropping batch after max retries');
        continue;
      }
      fetch('/api/telemetry/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: item.payload,
      }).catch(() => {
        retryQueueRef.current.push({ payload: item.payload, retries: item.retries + 1 });
      });
    }

    // THEN send the new batch
    sequenceRef.current++;
    const seq = sequenceRef.current;
    const payload = JSON.stringify({
      sessionId: sessionIdRef.current,
      sequenceNum: seq,
      startTime: buf.startTime,
      endTime: buf.endTime,
      frames: buf.frames,
      events: buf.events,
    });

    bufferRef.current = { frames: [], events: [], startTime: 0, endTime: 0 };
    lastFlushRef.current = Date.now();
    setBatchCount(seq);

    fetch('/api/telemetry/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }).catch(() => {
      if (retryQueueRef.current.length < MAX_RETRY_QUEUE) {
        retryQueueRef.current.push({ payload, retries: 0 });
      }
    });
  }, []);

  // -----------------------------------------------------------------------
  // record – hot path, NO setState here to avoid re-renders at 30fps
  // -----------------------------------------------------------------------
  const record = useCallback(
    (
      hands: HandData[],
      physics: HandPhysics[],
      grips: GripState[],
      motions: MotionPattern[],
      timestamp: number,
    ) => {
      if (!enabled) return;

      const buf = bufferRef.current;
      const stats = statsRef.current;

      for (let i = 0; i < hands.length; i++) {
        const hand = hands[i];
        const p = physics[i];
        const g = grips[i];
        const m = motions[i];
        if (!hand || !p || !g || !m) continue;

        const frameId = frameCounterRef.current++;
        const frame: HandTelemetry = {
          frameId,
          timestamp,
          deltaMs: p.deltaMs,
          handedness: hand.handedness,
          landmarks: hand.landmarks,
          physics: p,
          grip: g,
          motion: m,
        };

        buf.frames.push(frame);
        if (buf.startTime === 0) buf.startTime = timestamp;
        buf.endTime = timestamp;

        stats.totalFrames++;
        if (stats.firstTimestamp === 0) stats.firstTimestamp = timestamp;
        stats.lastTimestamp = timestamp;
      }

      // NOTE: setPendingFrames is NOT called here to avoid 30fps re-renders.
      // It is updated in the 1-second interval instead.

      if (buf.frames.length >= maxFrames) {
        flush();
      }
    },
    [enabled, maxFrames, flush],
  );

  // -----------------------------------------------------------------------
  // Interval-based flush check + pendingFrames update (1 Hz)
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!enabled) return;

    const id = setInterval(() => {
      setPendingFrames(bufferRef.current.frames.length);

      const elapsed = Date.now() - lastFlushRef.current;
      if (elapsed >= maxIntervalMs && bufferRef.current.frames.length > 0) {
        flush();
      }
    }, 1000);

    return () => clearInterval(id);
  }, [enabled, maxIntervalMs, flush]);

  // -----------------------------------------------------------------------
  // Flush on unload – chunked sendBeacon to respect the 64KB limit
  // -----------------------------------------------------------------------
  useEffect(() => {
    const handleUnload = () => {
      const buf = bufferRef.current;
      const stats = statsRef.current;
      const sid = sessionIdRef.current;

      // Flush remaining frames in chunks that fit sendBeacon's 64KB limit
      if (buf.frames.length > 0) {
        for (let i = 0; i < buf.frames.length; i += BEACON_CHUNK_SIZE) {
          sequenceRef.current++;
          const chunk = buf.frames.slice(i, i + BEACON_CHUNK_SIZE);
          const payload = new Blob([JSON.stringify({
            sessionId: sid,
            sequenceNum: sequenceRef.current,
            startTime: chunk[0].timestamp,
            endTime: chunk[chunk.length - 1].timestamp,
            frames: chunk,
            events: i === 0 ? buf.events : [],
          })], { type: 'application/json' });
          navigator.sendBeacon('/api/telemetry/batch', payload);
        }
      }

      // Session summary is small, always fits
      const durationSec = (stats.lastTimestamp - stats.firstTimestamp) / 1000;
      const summaryBlob = new Blob([JSON.stringify({
        sessionId: sid,
        startTime: stats.firstTimestamp,
        endTime: stats.lastTimestamp,
        totalFrames: stats.totalFrames,
        totalEvents: stats.totalEvents,
        totalBatches: sequenceRef.current,
        avgSampleRateFps: durationSec > 0 ? stats.totalFrames / durationSec : 0,
        eventBreakdown: stats.eventBreakdown,
      })], { type: 'application/json' });
      navigator.sendBeacon('/api/telemetry/session-end', summaryBlob);
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, []);

  return {
    record,
    sessionId,
    batchCount,
    pendingFrames,
  };
}
