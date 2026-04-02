import { useRef, useCallback } from 'react';
import type { HandData, Landmark } from '../types/index';
import type { Vec3, LandmarkPhysics, HandPhysics } from '../types/telemetry';
import {
  sub3,
  magnitude3,
  cross3,
  normalize3,
  dot3,
} from '../utils/geometry';

// ─── constants ────────────────────────────────────────────────────────────────

const EMA_ALPHA = 0.4;
const DOMINANT_AXIS_THRESHOLD = 0.01;

/** Landmark indices that form the palm base. */
const PALM_INDICES = [0, 5, 9, 13, 17] as const;

// ─── helpers ──────────────────────────────────────────────────────────────────

function zeroVec3(): Vec3 {
  return { x: 0, y: 0, z: 0 };
}

/**
 * Compute the finite difference velocity for a single landmark.
 * v = (pos[t] - pos[t-1]) / deltaSeconds
 */
function landmarkVelocity(curr: Landmark, prev: Landmark, deltaSeconds: number): Vec3 {
  const delta = sub3(curr, prev);
  return {
    x: delta.x / deltaSeconds,
    y: delta.y / deltaSeconds,
    z: delta.z / deltaSeconds,
  };
}

/**
 * Compute acceleration from two consecutive velocity samples.
 * a = (vel[t] - vel[t-1]) / deltaSeconds
 */
function landmarkAcceleration(currVel: Vec3, prevVel: Vec3, deltaSeconds: number): Vec3 {
  const delta = sub3(currVel, prevVel);
  return {
    x: delta.x / deltaSeconds,
    y: delta.y / deltaSeconds,
    z: delta.z / deltaSeconds,
  };
}

/**
 * Exponential moving average blend.
 * result = alpha * newValue + (1 - alpha) * prevValue
 */
function emaVec3(newValue: Vec3, prevValue: Vec3, alpha: number): Vec3 {
  const beta = 1 - alpha;
  return {
    x: alpha * newValue.x + beta * prevValue.x,
    y: alpha * newValue.y + beta * prevValue.y,
    z: alpha * newValue.z + beta * prevValue.z,
  };
}

/**
 * Average a set of Vec3 values by their indices into a Vec3 array.
 */
function averageVelocities(velocities: Vec3[], indices: readonly number[]): Vec3 {
  const n = indices.length;
  if (n === 0) return zeroVec3();
  let x = 0, y = 0, z = 0;
  for (const i of indices) {
    x += velocities[i].x;
    y += velocities[i].y;
    z += velocities[i].z;
  }
  return { x: x / n, y: y / n, z: z / n };
}

/**
 * Palm plane normal from three landmarks.
 * normal = cross(lm[5] - lm[0], lm[17] - lm[0])
 *
 * Returns a zero vector when the landmarks list is too short.
 */
function palmNormal(landmarks: Landmark[]): Vec3 {
  if (landmarks.length <= 17) return zeroVec3();
  const wrist = landmarks[0];
  const indexBase = landmarks[5];
  const pinkyBase = landmarks[17];
  return cross3(sub3(indexBase, wrist), sub3(pinkyBase, wrist));
}

/**
 * Angular velocity in radians/second between two palm normals.
 * Uses the angle between normalized normals divided by the elapsed time.
 */
function computeAngularVelocity(
  normalCurr: Vec3,
  normalPrev: Vec3,
  deltaSeconds: number,
): number {
  const n1 = normalize3(normalCurr);
  const n2 = normalize3(normalPrev);

  // Guard: if either normal is degenerate (zero magnitude), return 0.
  if (magnitude3(n1) === 0 || magnitude3(n2) === 0) return 0;

  // Clamp dot product to [-1, 1] to protect acos from floating-point drift.
  const cosAngle = Math.min(1, Math.max(-1, dot3(n1, n2)));
  const angle = Math.acos(cosAngle);
  return angle / deltaSeconds;
}

/**
 * Determine the dominant motion axis from a palm velocity vector.
 * Compares absolute components; returns 'none' when all are below threshold.
 */
function dominantAxis(palmVel: Vec3): HandPhysics['dominantAxis'] {
  const ax = Math.abs(palmVel.x);
  const ay = Math.abs(palmVel.y);
  const az = Math.abs(palmVel.z);

  if (ax < DOMINANT_AXIS_THRESHOLD && ay < DOMINANT_AXIS_THRESHOLD && az < DOMINANT_AXIS_THRESHOLD) {
    return 'none';
  }

  if (ax >= ay && ax >= az) return 'horizontal';
  if (ay >= ax && ay >= az) return 'vertical';
  return 'depth';
}

// ─── frame cache ──────────────────────────────────────────────────────────────

interface FrameCache {
  landmarks: Landmark[];
  timestamp: number;
  /** Smoothed velocities from the previous frame (post-EMA). */
  velocities: Vec3[];
}

// ─── hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns a stable callback that, given the current hands and timestamp,
 * computes per-landmark and whole-hand physics for each detected hand.
 *
 * All mutable state lives in refs — no re-renders are triggered.
 */
export function useHandPhysics(): (hands: HandData[], timestamp: number) => HandPhysics[] {
  const frameCache = useRef<Record<string, FrameCache>>({});

  const compute = useCallback(
    (hands: HandData[], timestamp: number): HandPhysics[] => {
      const result: HandPhysics[] = [];

      for (const hand of hands) {
        const { handedness, landmarks } = hand;
        const prev = frameCache.current[handedness];

        // ── No previous frame: emit zeroed-out physics and seed the cache ──
        if (!prev) {
          // Seed with zero velocities so the next frame can compute acceleration.
          frameCache.current[handedness] = {
            landmarks,
            timestamp,
            velocities: landmarks.map(() => zeroVec3()),
          };

          result.push(buildZeroPhysics(handedness, timestamp, 0));
          continue;
        }

        const deltaMs = timestamp - prev.timestamp;

        // Guard against zero or negative deltas (duplicate frames, clock jitter).
        if (deltaMs <= 0) {
          result.push(buildZeroPhysics(handedness, timestamp, deltaMs));
          continue;
        }

        const deltaSeconds = deltaMs / 1000;

        // ── Per-landmark velocity (raw) and EMA-smoothed velocity ───────────
        const landmarkCount = Math.min(landmarks.length, prev.landmarks.length);
        const rawVelocities: Vec3[] = [];
        const smoothedVelocities: Vec3[] = [];

        for (let i = 0; i < landmarkCount; i++) {
          const raw = landmarkVelocity(landmarks[i], prev.landmarks[i], deltaSeconds);
          const smoothed = emaVec3(raw, prev.velocities[i] ?? zeroVec3(), EMA_ALPHA);
          rawVelocities.push(raw);
          smoothedVelocities.push(smoothed);
        }

        // ── Per-landmark acceleration (using smoothed velocities) ────────────
        const landmarkPhysics: LandmarkPhysics[] = [];

        for (let i = 0; i < landmarkCount; i++) {
          const vel = smoothedVelocities[i];
          const acc = landmarkAcceleration(vel, prev.velocities[i] ?? zeroVec3(), deltaSeconds);
          const speed = magnitude3(vel);

          landmarkPhysics.push({ index: i, velocity: vel, speed, acceleration: acc });
        }

        // ── Whole-hand aggregate metrics ─────────────────────────────────────
        const wristVelocity = smoothedVelocities[0] ?? zeroVec3();

        const palmVelocity = averageVelocities(
          smoothedVelocities,
          PALM_INDICES.filter((i) => i < smoothedVelocities.length),
        );

        const normalCurr = palmNormal(landmarks);
        const normalPrev = palmNormal(prev.landmarks);
        const angularVelocity = computeAngularVelocity(normalCurr, normalPrev, deltaSeconds);

        const axis = dominantAxis(palmVelocity);

        // ── Update cache with smoothed velocities for next frame ─────────────
        frameCache.current[handedness] = {
          landmarks,
          timestamp,
          velocities: smoothedVelocities,
        };

        result.push({
          handedness,
          landmarks: landmarkPhysics,
          wristVelocity,
          palmVelocity,
          angularVelocity,
          dominantAxis: axis,
          timestamp,
          deltaMs,
        });
      }

      return result;
    },
    // frameCache.current is mutated in place — the ref itself never changes,
    // so this callback is intentionally stable across renders.
    [],
  );

  return compute;
}

// ─── private factory ──────────────────────────────────────────────────────────

function buildZeroPhysics(
  handedness: 'Left' | 'Right',
  timestamp: number,
  deltaMs: number,
): HandPhysics {
  return {
    handedness,
    landmarks: [],
    wristVelocity: zeroVec3(),
    palmVelocity: zeroVec3(),
    angularVelocity: 0,
    dominantAxis: 'none',
    timestamp,
    deltaMs,
  };
}
