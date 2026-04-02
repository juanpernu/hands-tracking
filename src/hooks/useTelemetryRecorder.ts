import { useRef, useState, useCallback } from 'react';
import type { HandData } from '../types/index';
import type {
  HandPhysics,
  GripState,
  GripType,
  MotionPattern,
  MotionPatternType,
  HandTelemetry,
  TelemetryBuffer,
  GestureEvent,
  GestureType,
  TelemetrySession,
  Vec3,
} from '../types/telemetry';

const DEFAULT_CAPACITY = 90;

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function makeEmptyBuffer(capacity: number): TelemetryBuffer {
  return {
    capacity,
    head: 0,
    size: 0,
    frames: new Array(capacity).fill(null),
  };
}

// Maps GripType values that have a corresponding GestureType to their event type.
// 'open' → 'open-palm', 'fist' → 'fist', 'point' → 'point'.
// 'pinch' and 'partial' do not produce grip-transition events here.
const GRIP_TO_GESTURE: Partial<Record<GripType, GestureType>> = {
  open: 'open-palm',
  fist: 'fist',
  point: 'point',
};

// Maps MotionPatternType values that have a corresponding GestureType.
const MOTION_TO_GESTURE: Partial<Record<MotionPatternType, GestureType>> = {
  swipe: 'swipe',
  'static-hold': 'hold',
};

// Per-hand previous-state bookkeeping.
interface PrevHandState {
  gripType: GripType | null;
  motionType: MotionPatternType | null;
}

export interface TelemetryRecorderResult {
  bufferRef: React.RefObject<TelemetryBuffer>;
  gestureEvents: GestureEvent[];
  exportSession: () => TelemetrySession;
  reset: () => void;
  record: (
    hands: HandData[],
    physics: HandPhysics[],
    grips: GripState[],
    motions: MotionPattern[],
    timestamp: number
  ) => void;
}

export function useTelemetryRecorder(capacity: number = DEFAULT_CAPACITY): TelemetryRecorderResult {
  const bufferRef = useRef<TelemetryBuffer>(makeEmptyBuffer(capacity));
  const frameCounterRef = useRef<number>(0);

  // Keyed by handedness so Left and Right are tracked independently.
  const prevStateRef = useRef<Record<'Left' | 'Right', PrevHandState>>({
    Left: { gripType: null, motionType: null },
    Right: { gripType: null, motionType: null },
  });

  const [gestureEvents, setGestureEvents] = useState<GestureEvent[]>([]);

  const record = useCallback(
    (
      hands: HandData[],
      physics: HandPhysics[],
      grips: GripState[],
      motions: MotionPattern[],
      timestamp: number
    ) => {
      const buffer = bufferRef.current;
      const frameId = frameCounterRef.current++;
      const newEvents: GestureEvent[] = [];

      for (let i = 0; i < hands.length; i++) {
        const hand = hands[i];
        const handPhysics = physics[i];
        const grip = grips[i];
        const motion = motions[i];

        if (!hand || !handPhysics || !grip || !motion) continue;

        const handedness = hand.handedness;

        // Assemble the per-frame snapshot.
        const frame: HandTelemetry = {
          frameId,
          timestamp,
          deltaMs: handPhysics.deltaMs,
          handedness,
          landmarks: hand.landmarks,
          physics: handPhysics,
          grip,
          motion,
        };

        // Write into the ring buffer — O(1), no allocation.
        const slot = buffer.head % capacity;
        buffer.frames[slot] = frame;
        buffer.head++;
        buffer.size = Math.min(buffer.size + 1, capacity);

        // Transition detection — only emit when state actually changes.
        const prev = prevStateRef.current[handedness];

        // Wrist position for event metadata — landmark 0 is the wrist.
        const wristLandmark = hand.landmarks[0];
        const wristPosition: Vec3 = wristLandmark
          ? { x: wristLandmark.x, y: wristLandmark.y, z: wristLandmark.z }
          : { x: 0, y: 0, z: 0 };

        // Grip-type transition.
        if (grip.gripType !== prev.gripType) {
          const gestureType = GRIP_TO_GESTURE[grip.gripType];
          if (gestureType !== undefined) {
            const event: GestureEvent = {
              id: generateId(),
              type: gestureType,
              handedness,
              confidence: grip.opennessRatio,
              startTimestamp: timestamp,
              timestamp,
              durationMs: 0,
              wristPosition,
              metadata: {
                gripType: grip.gripType,
                gripForce: grip.gripForce,
                previousGripType: prev.gripType,
              },
            };
            newEvents.push(event);
          }
          prev.gripType = grip.gripType;
        }

        // Motion-type transition.
        if (motion.type !== prev.motionType) {
          const gestureType = MOTION_TO_GESTURE[motion.type];
          if (gestureType !== undefined) {
            const metadata: Record<string, unknown> = {
              motionType: motion.type,
              confidence: motion.confidence,
              durationMs: motion.durationMs,
              previousMotionType: prev.motionType,
            };
            if (motion.swipeDirection !== undefined) {
              metadata.swipeDirection = motion.swipeDirection;
            }
            if (motion.circularDirection !== undefined) {
              metadata.circularDirection = motion.circularDirection;
            }
            const event: GestureEvent = {
              id: generateId(),
              type: gestureType,
              handedness,
              confidence: motion.confidence,
              startTimestamp: timestamp,
              timestamp,
              durationMs: motion.durationMs,
              wristPosition,
              metadata,
            };
            newEvents.push(event);
          }
          prev.motionType = motion.type;
        }
      }

      // Only trigger a re-render when there are new discrete events.
      if (newEvents.length > 0) {
        setGestureEvents((prev) => [...prev, ...newEvents]);
      }
    },
    // capacity is stable — only changes if the consumer passes a different value,
    // which would require remounting anyway.
    [capacity]
  );

  const exportSession = useCallback((): TelemetrySession => {
    const buffer = bufferRef.current;

    // Flatten ring buffer in chronological order (oldest → newest).
    const frames: HandTelemetry[] = [];

    if (buffer.size > 0) {
      if (buffer.size < capacity) {
        // Buffer has not wrapped yet — frames live from index 0 to size-1.
        for (let i = 0; i < buffer.size; i++) {
          const frame = buffer.frames[i];
          if (frame !== null) frames.push(frame);
        }
      } else {
        // Buffer is full and has wrapped — oldest frame is at head % capacity.
        const oldest = buffer.head % capacity;
        for (let i = 0; i < capacity; i++) {
          const frame = buffer.frames[(oldest + i) % capacity];
          if (frame !== null) frames.push(frame);
        }
      }
    }

    const startTime = frames.length > 0 ? frames[0].timestamp : 0;
    const endTime = frames.length > 0 ? frames[frames.length - 1].timestamp : 0;
    const durationSec = (endTime - startTime) / 1000;
    const sampleRateFps =
      durationSec > 0 && frames.length > 1 ? (frames.length - 1) / durationSec : 0;

    return {
      id: generateId(),
      startTime,
      endTime,
      frameCount: frames.length,
      frames,
      events: gestureEvents,
      sampleRateFps,
    };
    // gestureEvents is intentionally included so the snapshot captures the
    // current event list at call time.
  }, [capacity, gestureEvents]);

  const reset = useCallback(() => {
    const buffer = bufferRef.current;
    buffer.frames.fill(null);
    buffer.head = 0;
    buffer.size = 0;

    frameCounterRef.current = 0;

    prevStateRef.current = {
      Left: { gripType: null, motionType: null },
      Right: { gripType: null, motionType: null },
    };

    setGestureEvents([]);
  }, []);

  return { bufferRef, gestureEvents, exportSession, reset, record };
}
