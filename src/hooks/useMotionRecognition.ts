import { useRef, useCallback } from 'react';
import type { HandPhysics, MotionPattern, SwipeDirection } from '../types/telemetry';
import type { GesturePhase } from '../types/features';
import { magnitude3, clamp } from '../utils/geometry';
import { wrapAngleDelta } from '../utils/motion';
import { MOTION, FEATURES } from '../config';

// ─── Ring buffer frame type ───────────────────────────────────────────────────

interface FrameSnapshot {
  palmVelocity: { x: number; y: number; z: number };
  speed: number;
  timestamp: number;
  /** atan2(vy, vx) of palmVelocity in the XY plane */
  angle: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Classifies a stream of HandPhysics frames into MotionPatterns.
 *
 * Returns a stable callback that accepts (physics, timestamp) and returns the
 * best-matching MotionPattern for the current frame.  All state lives in refs
 * so the hook never triggers re-renders.
 *
 * Priority: swipe > circular > acceleration-burst > static-hold > none
 */
export function useMotionRecognition(): (physics: HandPhysics, timestamp: number) => MotionPattern {
  /**
   * Ring buffer stored as a fixed-length array with a head pointer.
   * `size` tracks how many valid entries exist (up to MOTION.BUFFER_CAPACITY).
   */
  const bufferRef = useRef<FrameSnapshot[]>([]);
  const headRef = useRef<number>(0);
  const sizeRef = useRef<number>(0);

  // Gesture phase detection refs
  const prevPhaseRef = useRef<GesturePhase>('idle');
  const phaseCountRef = useRef(0);
  const prevSpeedRef = useRef(0);

  // ─── Buffer helpers (captured once via closure, not recreated) ─────────────

  /** Push a new frame into the ring buffer. */
  function push(frame: FrameSnapshot): void {
    const buf = bufferRef.current;
    buf[headRef.current] = frame;
    headRef.current = (headRef.current + 1) % MOTION.BUFFER_CAPACITY;
    if (sizeRef.current < MOTION.BUFFER_CAPACITY) sizeRef.current++;
  }

  /**
   * Iterate frames from oldest to newest.
   * Callback receives (frame, indexFromOldest).
   */
  function forEachOldToNew(cb: (frame: FrameSnapshot, i: number) => void): void {
    const size = sizeRef.current;
    const head = headRef.current;
    const buf = bufferRef.current;
    // oldest slot when buffer is full: headRef.current; otherwise slot 0
    const startSlot = size < MOTION.BUFFER_CAPACITY ? 0 : head;
    for (let i = 0; i < size; i++) {
      const slot = (startSlot + i) % MOTION.BUFFER_CAPACITY;
      cb(buf[slot]!, i);
    }
  }

  /** Get the frame at offset from the newest (0 = newest, 1 = one before, …). */
  function fromNewest(offset: number): FrameSnapshot | undefined {
    const size = sizeRef.current;
    if (offset >= size) return undefined;
    const head = headRef.current;
    // head points to the NEXT write slot, so newest = head - 1
    const slot = (head - 1 - offset + MOTION.BUFFER_CAPACITY * 2) % MOTION.BUFFER_CAPACITY;
    return bufferRef.current[slot];
  }

  // ─── Pattern detectors ─────────────────────────────────────────────────────

  function detectSwipe(timestamp: number, currentPhase: GesturePhase): MotionPattern | null {
    // Only block swipe during retraction — allow idle so fast flicks aren't missed
    if (currentPhase === 'retraction') return null;

    const SPEED_THRESHOLD = MOTION.SWIPE_SPEED_THRESHOLD;
    const MIN_FRAMES = MOTION.SWIPE_MIN_FRAMES;

    // Walk from newest backwards, counting consecutive frames above threshold
    // on the same dominant axis with the same sign.
    let consecutiveX = 0;
    let consecutiveY = 0;
    let latestSpeed = 0;
    let dominantVx = 0;
    let dominantVy = 0;

    for (let i = 0; i < sizeRef.current; i++) {
      const frame = fromNewest(i);
      if (!frame) break;

      const absX = Math.abs(frame.palmVelocity.x);
      const absY = Math.abs(frame.palmVelocity.y);
      const absZ = Math.abs(frame.palmVelocity.z);

      // Dominant axis for this frame: whichever component has the largest
      // absolute value.  Depth axis (z) is not mapped to a swipe direction.
      const isXDominant = absX >= absY && absX >= absZ && absX > SPEED_THRESHOLD;
      const isYDominant = absY > absX && absY >= absZ && absY > SPEED_THRESHOLD;

      if (i === 0) {
        latestSpeed = frame.speed;
        dominantVx = frame.palmVelocity.x;
        dominantVy = frame.palmVelocity.y;
      }

      if (isXDominant && Math.sign(frame.palmVelocity.x) === Math.sign(dominantVx)) {
        consecutiveX++;
      } else {
        consecutiveX = 0;
      }

      if (isYDominant && Math.sign(frame.palmVelocity.y) === Math.sign(dominantVy)) {
        consecutiveY++;
      } else {
        consecutiveY = 0;
      }

      // Stop walking back once both streaks have been broken
      if (consecutiveX === 0 && consecutiveY === 0 && i >= MIN_FRAMES) break;
    }

    const absX = Math.abs(dominantVx);
    const absY = Math.abs(dominantVy);

    // Boost confidence when phase is 'stroke' (user was "winding up" through preparation)
    const phaseBoost = currentPhase === 'stroke' ? 0.1 : 0;

    if (consecutiveX >= MIN_FRAMES && absX >= absY) {
      const direction: SwipeDirection = dominantVx > 0 ? 'right' : 'left';
      const newest = fromNewest(0);
      const oldest = fromNewest(consecutiveX - 1);
      const durationMs = newest && oldest ? newest.timestamp - oldest.timestamp : 0;
      return {
        type: 'swipe',
        confidence: clamp((latestSpeed / 1.5) + phaseBoost, 0, 1),
        swipeDirection: direction,
        durationMs,
        timestamp,
      };
    }

    if (consecutiveY >= MIN_FRAMES) {
      // In screen-space Y increases downward; map positive vy → 'down'.
      const direction: SwipeDirection = dominantVy > 0 ? 'down' : 'up';
      const newest = fromNewest(0);
      const oldest = fromNewest(consecutiveY - 1);
      const durationMs = newest && oldest ? newest.timestamp - oldest.timestamp : 0;
      return {
        type: 'swipe',
        confidence: clamp((latestSpeed / 1.5) + phaseBoost, 0, 1),
        swipeDirection: direction,
        durationMs,
        timestamp,
      };
    }

    return null;
  }

  function detectStaticHold(timestamp: number): MotionPattern | null {
    const SPEED_LIMIT = MOTION.STATIC_SPEED_LIMIT;
    const MIN_FRAMES = MOTION.STATIC_MIN_FRAMES;

    let count = 0;
    let totalDeltaMs = 0;
    let latestSpeed = 0;

    for (let i = 0; i < sizeRef.current; i++) {
      const frame = fromNewest(i);
      if (!frame) break;

      if (i === 0) latestSpeed = frame.speed;

      if (magnitude3(frame.palmVelocity) < SPEED_LIMIT) {
        count++;
        // Reconstruct deltaMs from timestamp gaps where possible
        const next = fromNewest(i + 1);
        if (next) {
          totalDeltaMs += frame.timestamp - next.timestamp;
        } else {
          totalDeltaMs += 1000 / MOTION.TARGET_FPS; // fallback
        }
      } else {
        break; // streak broken
      }
    }

    if (count >= MIN_FRAMES) {
      return {
        type: 'static-hold',
        confidence: clamp(1 - latestSpeed / SPEED_LIMIT, 0.5, 1),
        durationMs: totalDeltaMs,
        timestamp,
      };
    }

    return null;
  }

  function detectAccelerationBurst(timestamp: number): MotionPattern | null {
    const SPEED_NOW_THRESHOLD = MOTION.ACCEL_BURST_SPEED_NOW;
    const SPEED_PREV_THRESHOLD = MOTION.ACCEL_BURST_SPEED_PREV;
    const LOOKBACK = MOTION.ACCEL_BURST_LOOKBACK;

    const newest = fromNewest(0);
    const older = fromNewest(LOOKBACK);

    if (!newest || !older) return null;

    if (newest.speed > SPEED_NOW_THRESHOLD && older.speed < SPEED_PREV_THRESHOLD) {
      const delta = newest.speed - older.speed;
      return {
        type: 'acceleration-burst',
        confidence: clamp(delta / 0.8, 0, 1),
        durationMs: newest.timestamp - older.timestamp,
        timestamp,
      };
    }

    return null;
  }

  function detectCircular(timestamp: number): MotionPattern | null {
    const TWO_PI = 2 * Math.PI;
    const size = sizeRef.current;
    if (size < 2) return null;

    // Accumulate signed angle deltas across the whole buffer (oldest → newest)
    let accumulated = 0;
    let prevAngle: number | undefined;

    // Also track smoothness: count direction reversals
    let reversals = 0;
    let prevDelta: number | undefined;

    forEachOldToNew((frame) => {
      if (prevAngle === undefined) {
        prevAngle = frame.angle;
        return;
      }
      const delta = wrapAngleDelta(frame.angle - prevAngle);
      accumulated += delta;

      if (prevDelta !== undefined && Math.sign(delta) !== Math.sign(prevDelta) && Math.abs(delta) > MOTION.CIRCULAR_MIN_ANGLE_CHANGE) {
        reversals++;
      }
      prevDelta = delta;
      prevAngle = frame.angle;
    });

    if (Math.abs(accumulated) > TWO_PI) {
      // Smoothness: fewer reversals = smoother circle.  Max expected reversals
      // in a noisy but genuine circle is roughly 20% of frames.
      const maxReversals = size * MOTION.CIRCULAR_MAX_REVERSAL_RATIO;
      const smoothness = clamp(1 - reversals / Math.max(maxReversals, 1), 0, 1);

      return {
        type: 'circular',
        circularDirection: accumulated > 0 ? 1 : -1,
        confidence: clamp(smoothness, 0, 1),
        durationMs: (() => {
          const oldest = fromNewest(size - 1);
          const newest = fromNewest(0);
          return oldest && newest ? newest.timestamp - oldest.timestamp : 0;
        })(),
        timestamp,
      };
    }

    return null;
  }

  // ─── Gesture phase detection ────────────────────────────────────────────────

  function detectGesturePhase(speed: number, prevSpeed: number): GesturePhase {
    const acceleration = speed - prevSpeed;

    if (speed < FEATURES.PHASE_IDLE_THRESHOLD) return 'idle';
    if (acceleration > FEATURES.PHASE_PREPARATION_ACCEL_THRESHOLD) return 'preparation';
    if (speed > FEATURES.PHASE_RETRACTION_SPEED_THRESHOLD && acceleration >= FEATURES.PHASE_STROKE_DECEL_THRESHOLD) return 'stroke';
    if (acceleration < FEATURES.PHASE_STROKE_DECEL_THRESHOLD) return 'retraction';
    return 'idle';
  }

  // ─── Main callback ─────────────────────────────────────────────────────────

  const classify = useCallback(
    (physics: HandPhysics, timestamp: number): MotionPattern => {
      const vel = physics.palmVelocity;
      const speed = magnitude3(vel);
      const angle = Math.atan2(vel.y, vel.x);

      push({ palmVelocity: { x: vel.x, y: vel.y, z: vel.z }, speed, timestamp, angle });

      // Gesture phase detection with hysteresis
      const rawPhase = detectGesturePhase(speed, prevSpeedRef.current);
      prevSpeedRef.current = speed;

      if (rawPhase === prevPhaseRef.current) {
        phaseCountRef.current++;
      } else {
        phaseCountRef.current = 1;
        prevPhaseRef.current = rawPhase;
      }

      const confirmedPhase = phaseCountRef.current >= FEATURES.PHASE_HYSTERESIS_FRAMES
        ? prevPhaseRef.current
        : (prevPhaseRef.current === rawPhase ? rawPhase : 'idle');

      const none: MotionPattern = { type: 'none', confidence: 0, durationMs: 0, timestamp, gesturePhase: confirmedPhase };

      // Priority: swipe > circular > acceleration-burst > static-hold > none
      const pattern =
        detectSwipe(timestamp, confirmedPhase) ??
        detectCircular(timestamp) ??
        detectAccelerationBurst(timestamp) ??
        detectStaticHold(timestamp) ??
        none;

      return { ...pattern, gesturePhase: confirmedPhase };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return classify;
}
