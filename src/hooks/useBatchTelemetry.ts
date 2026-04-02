import { useRef, useCallback, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { HandData } from '../types';
import type {
  HandPhysics,
  GripState,
  MotionPattern,
  HandTelemetry,
  GestureEvent,
} from '../types/telemetry';

interface BatchConfig {
  maxFrames: number;
  maxIntervalMs: number;
  enabled: boolean;
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

const MAX_RETRIES = 3;

export function useBatchTelemetry(config: BatchConfig): BatchTelemetryResult {
  const { maxFrames, maxIntervalMs, enabled } = config;

  // sessionId is stable for the lifetime of the component.
  const [sessionId] = useState(() => uuidv4());

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

  const flush = useCallback(() => {
    const buf = bufferRef.current;
    if (buf.frames.length === 0) return;

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
    setPendingFrames(0);
    setBatchCount(seq);

    fetch('/api/telemetry/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }).catch(() => {
      retryQueueRef.current.push({ payload, retries: 0 });
    });

    const queue = retryQueueRef.current;
    retryQueueRef.current = [];
    for (const item of queue) {
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
  }, []);

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

      setPendingFrames(buf.frames.length);

      if (buf.frames.length >= maxFrames) {
        flush();
      }
    },
    [enabled, maxFrames, flush],
  );

  // Interval-based flush check.
  useEffect(() => {
    if (!enabled) return;

    const id = setInterval(() => {
      const elapsed = Date.now() - lastFlushRef.current;
      if (elapsed >= maxIntervalMs && bufferRef.current.frames.length > 0) {
        flush();
      }
    }, 1000);

    return () => clearInterval(id);
  }, [enabled, maxIntervalMs, flush]);

  // Flush on unload.
  useEffect(() => {
    const handleUnload = () => {
      const buf = bufferRef.current;
      const stats = statsRef.current;
      const sid = sessionIdRef.current;

      if (buf.frames.length > 0) {
        sequenceRef.current++;
        const batchPayload = JSON.stringify({
          sessionId: sid,
          sequenceNum: sequenceRef.current,
          startTime: buf.startTime,
          endTime: buf.endTime,
          frames: buf.frames,
          events: buf.events,
        });
        navigator.sendBeacon('/api/telemetry/batch', batchPayload);
      }

      const durationSec = (stats.lastTimestamp - stats.firstTimestamp) / 1000;
      const summary = JSON.stringify({
        sessionId: sid,
        startTime: stats.firstTimestamp,
        endTime: stats.lastTimestamp,
        totalFrames: stats.totalFrames,
        totalEvents: stats.totalEvents,
        totalBatches: sequenceRef.current,
        avgSampleRateFps: durationSec > 0 ? stats.totalFrames / durationSec : 0,
        eventBreakdown: stats.eventBreakdown,
      });
      navigator.sendBeacon('/api/telemetry/session-end', summary);
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
