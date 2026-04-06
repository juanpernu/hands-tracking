# Telemetry Feature Engineering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the hand feature extraction pipeline with full joint angles, extrinsic/intrinsic decomposition, temporal dynamics (jerk, gesture phases), and joint constraint filtering — all backed by academic research.

**Architecture:** A new `useHandFeatures` hook produces a 51-element feature vector per hand per frame from raw landmarks. It sits between `useHandTracking` and `useHandAnalysis`, feeding richer features into existing analysis hooks. Pure math functions live in `src/utils/hand-features.ts`. Existing hooks are extended (not replaced) for backwards compatibility.

**Tech Stack:** React 19, TypeScript 5.9, Vitest, existing MediaPipe 21-landmark pipeline.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/types/features.ts` | Create | HandFeatureVector, JointAngles, PalmOrientation, GesturePhase types |
| `src/utils/hand-features.ts` | Create | Pure functions: joint angles, palm orientation, inter-finger spread, thumb opposition, hand size, joint constraints |
| `src/utils/__tests__/hand-features.test.ts` | Create | Unit tests for all pure functions |
| `src/config.ts` | Modify | Add FEATURES config section with joint limits |
| `src/hooks/useHandFeatures.ts` | Create | Compositor hook producing HandFeatureVector per hand per frame |
| `src/hooks/useHandPhysics.ts` | Modify | Add jerk computation |
| `src/hooks/useMotionRecognition.ts` | Modify | Add gesture phase detection |
| `src/hooks/useHandAnalysis.ts` | Modify | Compose useHandFeatures, expose featuresData |
| `src/types/telemetry.ts` | Modify | Add optional features field to HandTelemetry |

---

## Wave 1: Foundation (Parallel — No Dependencies)

### Task 1: Feature Types

**Files:**
- Create: `src/types/features.ts`

- [ ] **Step 1: Create feature type definitions**

```typescript
// src/types/features.ts

import type { Vec3 } from './telemetry';

/** 15 joint angles: MCP, PIP, DIP flexion per finger (radians) */
export interface JointAngles {
  thumb:  { mcp: number; pip: number; dip: number };
  index:  { mcp: number; pip: number; dip: number };
  middle: { mcp: number; pip: number; dip: number };
  ring:   { mcp: number; pip: number; dip: number };
  pinky:  { mcp: number; pip: number; dip: number };
}

/** Palm orientation as Euler angles (radians) */
export interface PalmOrientation {
  pitch: number;  // rotation around X axis
  yaw: number;    // rotation around Y axis
  roll: number;   // rotation around Z axis
  normal: Vec3;   // palm plane normal vector
}

/** Gesture phase from velocity profile */
export type GesturePhase = 'idle' | 'preparation' | 'stroke' | 'retraction';

/** Complete feature vector per hand per frame */
export interface HandFeatureVector {
  handedness: 'Left' | 'Right';
  timestamp: number;

  // Static features (32)
  jointAngles: JointAngles;                          // 15 angles
  palmOrientation: PalmOrientation;                   // 3 Euler + normal
  interFingerSpread: [number, number, number, number]; // thumb-index, index-middle, middle-ring, ring-pinky
  thumbOpposition: [number, number, number, number];   // thumb-to-index, thumb-to-middle, thumb-to-ring, thumb-to-pinky (normalized)
  fingerCurlRatios: [number, number, number, number, number]; // tip-to-MCP / bone-length (0=extended, 1=folded)
  handOpenness: number;                               // avg fingertip-to-palm distance, normalized

  // Normalization
  handSize: number;                                   // wrist-to-middle_MCP distance (scale factor)

  // Temporal features (computed by physics hook, included here for completeness)
  gesturePhase: GesturePhase;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/features.ts
git commit -m "feat(types): add hand feature vector type definitions"
```

---

### Task 2: Config — Joint Limits and Feature Constants

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Add FEATURES config section**

Add after the existing `INTERACTION` config block in `src/config.ts`:

```typescript
// --- Hand Features ---
export const FEATURES = {
  // Joint constraint limits (radians) — from D-H kinematic model
  MCP_FLEXION_MIN: 0,
  MCP_FLEXION_MAX: Math.PI / 2,          // 90°
  MCP_ABDUCTION_MIN: -Math.PI / 12,      // -15°
  MCP_ABDUCTION_MAX: Math.PI / 12,       // 15°
  PIP_FLEXION_MIN: 0,
  PIP_FLEXION_MAX: (110 / 180) * Math.PI, // 110°
  DIP_FLEXION_MIN: 0,
  DIP_FLEXION_MAX: Math.PI / 2,           // 90°
  // Gesture phase velocity thresholds (normalized units/sec)
  PHASE_IDLE_THRESHOLD: 0.02,
  PHASE_PREPARATION_ACCEL_THRESHOLD: 0.1,
  PHASE_STROKE_DECEL_THRESHOLD: -0.05,
  PHASE_RETRACTION_SPEED_THRESHOLD: 0.05,
  PHASE_HYSTERESIS_FRAMES: 3,
} as const;
```

- [ ] **Step 2: Commit**

```bash
git add src/config.ts
git commit -m "feat(config): add FEATURES section with joint limits and gesture phase thresholds"
```

---

### Task 3: Hand Features Utility Functions + Tests

**Files:**
- Create: `src/utils/hand-features.ts`
- Create: `src/utils/__tests__/hand-features.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
// src/utils/__tests__/hand-features.test.ts

import { describe, it, expect } from 'vitest';
import {
  computeJointAngle,
  extractJointAngles,
  extractPalmOrientation,
  extractInterFingerSpread,
  extractThumbOpposition,
  computeHandSize,
  applyJointConstraints,
  computeFingerCurlRatio,
  computeHandOpenness,
} from '../hand-features';
import type { Landmark } from '../../types';

// Helper: create a landmark at a known position
function lm(x: number, y: number, z: number): Landmark {
  return { x, y, z };
}

// A straight finger: MCP, PIP, DIP, TIP in a line along X axis
function straightFinger(baseX: number): Landmark[] {
  return [
    lm(baseX, 0, 0),       // MCP
    lm(baseX + 1, 0, 0),   // PIP
    lm(baseX + 2, 0, 0),   // DIP
    lm(baseX + 3, 0, 0),   // TIP
  ];
}

// A 90-degree bent finger at PIP
function bentFinger(baseX: number): Landmark[] {
  return [
    lm(baseX, 0, 0),       // MCP
    lm(baseX + 1, 0, 0),   // PIP
    lm(baseX + 1, 1, 0),   // DIP (bent 90° downward)
    lm(baseX + 1, 2, 0),   // TIP
  ];
}

describe('computeJointAngle', () => {
  it('returns ~0 for straight joints (3 collinear points)', () => {
    const angle = computeJointAngle(lm(0, 0, 0), lm(1, 0, 0), lm(2, 0, 0));
    expect(angle).toBeCloseTo(0, 1);
  });

  it('returns ~PI/2 for a 90-degree bend', () => {
    const angle = computeJointAngle(lm(0, 0, 0), lm(1, 0, 0), lm(1, 1, 0));
    expect(angle).toBeCloseTo(Math.PI / 2, 1);
  });

  it('returns ~PI for a fully folded joint (180° bend)', () => {
    const angle = computeJointAngle(lm(0, 0, 0), lm(1, 0, 0), lm(0, 0, 0));
    // When tip is at parent position, angle approaches PI
    expect(angle).toBeCloseTo(Math.PI, 0);
  });
});

describe('extractPalmOrientation', () => {
  it('computes a non-zero normal for a valid hand', () => {
    // Flat hand on XY plane
    const landmarks: Landmark[] = new Array(21).fill(lm(0, 0, 0));
    landmarks[0] = lm(0, 0, 0);   // wrist
    landmarks[5] = lm(1, 0, 0);   // index MCP
    landmarks[17] = lm(0, 1, 0);  // pinky MCP
    landmarks[9] = lm(0.5, 0.5, 0); // middle MCP

    const result = extractPalmOrientation(landmarks);
    // Normal should point in Z direction for a flat XY hand
    expect(Math.abs(result.normal.z)).toBeGreaterThan(0);
  });
});

describe('extractInterFingerSpread', () => {
  it('returns 4 spread angles', () => {
    const landmarks: Landmark[] = new Array(21).fill(lm(0, 0, 0));
    // Set MCP positions for spread calculation
    landmarks[0] = lm(0, 0, 0);   // wrist
    landmarks[2] = lm(0.5, 1, 0); // thumb MCP
    landmarks[5] = lm(1, 1, 0);   // index MCP
    landmarks[9] = lm(1.5, 1, 0); // middle MCP
    landmarks[13] = lm(2, 1, 0);  // ring MCP
    landmarks[17] = lm(2.5, 1, 0); // pinky MCP

    const result = extractInterFingerSpread(landmarks);
    expect(result).toHaveLength(4);
    result.forEach(angle => {
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThanOrEqual(Math.PI);
    });
  });
});

describe('extractThumbOpposition', () => {
  it('returns 4 normalized distances', () => {
    const landmarks: Landmark[] = new Array(21).fill(lm(0, 0, 0));
    landmarks[0] = lm(0, 0, 0);   // wrist
    landmarks[9] = lm(1, 0, 0);   // middle MCP (for handSize)
    landmarks[4] = lm(0.5, 0.5, 0);  // thumb tip
    landmarks[8] = lm(1, 0.5, 0);    // index tip
    landmarks[12] = lm(1.5, 0.5, 0); // middle tip
    landmarks[16] = lm(2, 0.5, 0);   // ring tip
    landmarks[20] = lm(2.5, 0.5, 0); // pinky tip

    const handSize = 1.0;
    const result = extractThumbOpposition(landmarks, handSize);
    expect(result).toHaveLength(4);
    result.forEach(d => {
      expect(d).toBeGreaterThanOrEqual(0);
    });
    // Thumb is closest to index, farthest from pinky
    expect(result[0]).toBeLessThan(result[3]);
  });
});

describe('computeHandSize', () => {
  it('computes distance from wrist to middle MCP', () => {
    const landmarks: Landmark[] = new Array(21).fill(lm(0, 0, 0));
    landmarks[0] = lm(0, 0, 0); // wrist
    landmarks[9] = lm(3, 4, 0); // middle MCP
    const size = computeHandSize(landmarks);
    expect(size).toBeCloseTo(5, 5); // 3-4-5 triangle
  });

  it('returns a minimum value to prevent division by zero', () => {
    const landmarks: Landmark[] = new Array(21).fill(lm(0, 0, 0));
    const size = computeHandSize(landmarks);
    expect(size).toBeGreaterThan(0);
  });
});

describe('applyJointConstraints', () => {
  it('clamps angles within physiological limits', () => {
    const result = applyJointConstraints({
      thumb:  { mcp: -0.5, pip: 0.5, dip: 0.5 },
      index:  { mcp: 0.3, pip: 2.5, dip: 0.3 },  // PIP over limit
      middle: { mcp: 0.3, pip: 0.5, dip: 2.0 },   // DIP over limit
      ring:   { mcp: 0.3, pip: 0.5, dip: 0.3 },
      pinky:  { mcp: 0.3, pip: 0.5, dip: 0.3 },
    });

    // MCP should be clamped to >= 0
    expect(result.thumb.mcp).toBeGreaterThanOrEqual(0);
    // PIP should be clamped to <= 110° (1.9199 rad)
    expect(result.index.pip).toBeLessThanOrEqual((110 / 180) * Math.PI + 0.001);
    // DIP should be clamped to <= 90° (PI/2)
    expect(result.middle.dip).toBeLessThanOrEqual(Math.PI / 2 + 0.001);
  });
});

describe('computeFingerCurlRatio', () => {
  it('returns ~0 for a straight finger', () => {
    const [mcp, pip, dip, tip] = straightFinger(0);
    const ratio = computeFingerCurlRatio(mcp, pip, dip, tip);
    expect(ratio).toBeCloseTo(0, 1);
  });

  it('returns > 0 for a bent finger', () => {
    const [mcp, pip, dip, tip] = bentFinger(0);
    const ratio = computeFingerCurlRatio(mcp, pip, dip, tip);
    expect(ratio).toBeGreaterThan(0.1);
  });
});

describe('computeHandOpenness', () => {
  it('returns higher value for spread fingers', () => {
    const landmarks: Landmark[] = new Array(21).fill(lm(0, 0, 0));
    // Palm center approx at wrist
    landmarks[0] = lm(0, 0, 0);
    // Fingertips far away
    landmarks[4] = lm(2, 2, 0);
    landmarks[8] = lm(3, 2, 0);
    landmarks[12] = lm(4, 2, 0);
    landmarks[16] = lm(3, 3, 0);
    landmarks[20] = lm(2, 3, 0);
    // Middle MCP for hand size
    landmarks[9] = lm(2, 0, 0);

    const handSize = 2.0;
    const open = computeHandOpenness(landmarks, handSize);
    expect(open).toBeGreaterThan(0.5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/__tests__/hand-features.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement hand-features.ts**

```typescript
// src/utils/hand-features.ts

import type { Landmark } from '../types';
import type { Vec3 } from '../types/telemetry';
import type { JointAngles, PalmOrientation } from '../types/features';
import { sub3, normalize3, dot3, cross3, magnitude3, distance3d, clamp } from './geometry';
import { LANDMARK, FINGER_CHAINS, FINGERTIP_INDICES, FEATURES } from '../config';

/**
 * Compute the flexion angle at a joint from three consecutive landmarks.
 * parent → joint → child. Returns angle in radians (0 = straight, PI = fully folded).
 */
export function computeJointAngle(parent: Landmark, joint: Landmark, child: Landmark): number {
  const v1 = normalize3(sub3(parent, joint));
  const v2 = normalize3(sub3(child, joint));
  const d = clamp(dot3(v1, v2), -1, 1);
  return Math.acos(d);
}

/**
 * Extract all 15 joint angles (MCP, PIP, DIP per finger).
 * Uses the wrist as the parent for MCP angles.
 */
export function extractJointAngles(landmarks: Landmark[]): JointAngles {
  const wrist = landmarks[LANDMARK.WRIST];

  function fingerAngles(chainIdx: number): { mcp: number; pip: number; dip: number } {
    const chain = FINGER_CHAINS[chainIdx];
    const mcpLm = landmarks[chain[0]];
    const pipLm = landmarks[chain[1]];
    const dipLm = landmarks[chain[2]];
    const tipLm = landmarks[chain[3]];

    return {
      mcp: computeJointAngle(wrist, mcpLm, pipLm),
      pip: computeJointAngle(mcpLm, pipLm, dipLm),
      dip: computeJointAngle(pipLm, dipLm, tipLm),
    };
  }

  return {
    thumb:  fingerAngles(0),
    index:  fingerAngles(1),
    middle: fingerAngles(2),
    ring:   fingerAngles(3),
    pinky:  fingerAngles(4),
  };
}

/**
 * Extract palm orientation as Euler angles and normal vector.
 * Palm plane is defined by wrist, index_MCP, and pinky_MCP.
 */
export function extractPalmOrientation(landmarks: Landmark[]): PalmOrientation {
  const wrist = landmarks[LANDMARK.WRIST];
  const indexMcp = landmarks[LANDMARK.INDEX_MCP];
  const pinkyMcp = landmarks[LANDMARK.PINKY_MCP];

  const v1 = sub3(indexMcp, wrist);
  const v2 = sub3(pinkyMcp, wrist);
  const normal = normalize3(cross3(v1, v2));

  // Euler angles from the normal vector
  const mag = magnitude3(normal);
  if (mag === 0) return { pitch: 0, yaw: 0, roll: 0, normal: { x: 0, y: 0, z: 0 } };

  const pitch = Math.asin(clamp(-normal.y, -1, 1));
  const yaw = Math.atan2(normal.x, normal.z);

  // Roll: angle of the index→pinky vector projected onto the plane perpendicular to normal
  const palmDir = normalize3(sub3(indexMcp, pinkyMcp));
  const roll = Math.atan2(palmDir.y, palmDir.x);

  return { pitch, yaw, roll, normal };
}

/**
 * Compute spread angles between adjacent fingers at MCP level.
 * Returns [thumb-index, index-middle, middle-ring, ring-pinky].
 */
export function extractInterFingerSpread(landmarks: Landmark[]): [number, number, number, number] {
  const wrist = landmarks[LANDMARK.WRIST];
  const mcpIndices = [LANDMARK.THUMB_MCP, LANDMARK.INDEX_MCP, LANDMARK.MIDDLE_MCP, LANDMARK.RING_MCP, LANDMARK.PINKY_MCP];

  const result: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const v1 = normalize3(sub3(landmarks[mcpIndices[i]], wrist));
    const v2 = normalize3(sub3(landmarks[mcpIndices[i + 1]], wrist));
    const d = clamp(dot3(v1, v2), -1, 1);
    result[i] = Math.acos(d);
  }
  return result;
}

/**
 * Compute normalized distances from thumb tip to each other fingertip.
 * Returns [thumb-index, thumb-middle, thumb-ring, thumb-pinky].
 */
export function extractThumbOpposition(
  landmarks: Landmark[],
  handSize: number,
): [number, number, number, number] {
  const thumbTip = landmarks[LANDMARK.THUMB_TIP];
  const tips = [LANDMARK.INDEX_TIP, LANDMARK.MIDDLE_TIP, LANDMARK.RING_TIP, LANDMARK.PINKY_TIP];
  const safeSize = Math.max(handSize, 0.001);

  return tips.map(idx => distance3d(thumbTip, landmarks[idx]) / safeSize) as [number, number, number, number];
}

/**
 * Compute hand size as distance from wrist to middle finger MCP.
 * Used as normalization factor for all distance-based features.
 */
export function computeHandSize(landmarks: Landmark[]): number {
  const d = distance3d(landmarks[LANDMARK.WRIST], landmarks[LANDMARK.MIDDLE_MCP]);
  return Math.max(d, 0.001); // prevent division by zero
}

/**
 * Clamp all joint angles to physiological limits.
 * Reduces jitter from MediaPipe by filtering impossible poses.
 */
export function applyJointConstraints(angles: JointAngles): JointAngles {
  function clampJoint(joint: { mcp: number; pip: number; dip: number }) {
    return {
      mcp: clamp(joint.mcp, FEATURES.MCP_FLEXION_MIN, FEATURES.MCP_FLEXION_MAX),
      pip: clamp(joint.pip, FEATURES.PIP_FLEXION_MIN, FEATURES.PIP_FLEXION_MAX),
      dip: clamp(joint.dip, FEATURES.DIP_FLEXION_MIN, FEATURES.DIP_FLEXION_MAX),
    };
  }

  return {
    thumb:  clampJoint(angles.thumb),
    index:  clampJoint(angles.index),
    middle: clampJoint(angles.middle),
    ring:   clampJoint(angles.ring),
    pinky:  clampJoint(angles.pinky),
  };
}

/**
 * Compute curl ratio for a single finger.
 * Ratio of tip-to-MCP distance vs total bone chain length.
 * 0 = fully extended, 1 = fully folded.
 */
export function computeFingerCurlRatio(
  mcp: Landmark,
  pip: Landmark,
  dip: Landmark,
  tip: Landmark,
): number {
  const boneLength = distance3d(mcp, pip) + distance3d(pip, dip) + distance3d(dip, tip);
  if (boneLength < 0.001) return 0;
  const directDistance = distance3d(mcp, tip);
  return clamp(1 - directDistance / boneLength, 0, 1);
}

/**
 * Compute hand openness as average fingertip-to-palm-center distance, normalized by hand size.
 */
export function computeHandOpenness(landmarks: Landmark[], handSize: number): number {
  const palmCenter = landmarks[LANDMARK.WRIST]; // simplified: use wrist as palm center
  const safeSize = Math.max(handSize, 0.001);
  let total = 0;
  for (const tipIdx of FINGERTIP_INDICES) {
    total += distance3d(palmCenter, landmarks[tipIdx]);
  }
  return (total / FINGERTIP_INDICES.length) / safeSize;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/hand-features.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/hand-features.ts src/utils/__tests__/hand-features.test.ts
git commit -m "feat(utils): add hand feature extraction functions with tests"
```

---

## Wave 2: Hooks (Depends on Wave 1)

### Task 4: useHandFeatures Hook

**Files:**
- Create: `src/hooks/useHandFeatures.ts`

- [ ] **Step 1: Implement useHandFeatures**

```typescript
// src/hooks/useHandFeatures.ts

import { useCallback } from 'react';
import type { HandData } from '../types';
import type { HandFeatureVector } from '../types/features';
import { FINGER_CHAINS } from '../config';
import {
  extractJointAngles,
  extractPalmOrientation,
  extractInterFingerSpread,
  extractThumbOpposition,
  computeHandSize,
  applyJointConstraints,
  computeFingerCurlRatio,
  computeHandOpenness,
} from '../utils/hand-features';

/**
 * useHandFeatures
 *
 * Produces a complete HandFeatureVector per hand per frame.
 * All functions are pure — no refs, no state, no re-renders.
 * The gesture phase is set to 'idle' here; it is updated by useMotionRecognition.
 */
export function useHandFeatures(): (hands: HandData[], timestamp: number) => HandFeatureVector[] {
  const compute = useCallback((hands: HandData[], timestamp: number): HandFeatureVector[] => {
    return hands.map((hand): HandFeatureVector => {
      const { landmarks, handedness } = hand;

      // 1. Hand size (normalization factor)
      const handSize = computeHandSize(landmarks);

      // 2. Joint angles (15 angles, constrained)
      const rawAngles = extractJointAngles(landmarks);
      const jointAngles = applyJointConstraints(rawAngles);

      // 3. Palm orientation (3 Euler + normal)
      const palmOrientation = extractPalmOrientation(landmarks);

      // 4. Inter-finger spread (4 angles)
      const interFingerSpread = extractInterFingerSpread(landmarks);

      // 5. Thumb opposition (4 normalized distances)
      const thumbOpposition = extractThumbOpposition(landmarks, handSize);

      // 6. Finger curl ratios (5 values)
      const fingerCurlRatios: [number, number, number, number, number] = [
        computeFingerCurlRatio(
          landmarks[FINGER_CHAINS[0][0]], landmarks[FINGER_CHAINS[0][1]],
          landmarks[FINGER_CHAINS[0][2]], landmarks[FINGER_CHAINS[0][3]],
        ),
        computeFingerCurlRatio(
          landmarks[FINGER_CHAINS[1][0]], landmarks[FINGER_CHAINS[1][1]],
          landmarks[FINGER_CHAINS[1][2]], landmarks[FINGER_CHAINS[1][3]],
        ),
        computeFingerCurlRatio(
          landmarks[FINGER_CHAINS[2][0]], landmarks[FINGER_CHAINS[2][1]],
          landmarks[FINGER_CHAINS[2][2]], landmarks[FINGER_CHAINS[2][3]],
        ),
        computeFingerCurlRatio(
          landmarks[FINGER_CHAINS[3][0]], landmarks[FINGER_CHAINS[3][1]],
          landmarks[FINGER_CHAINS[3][2]], landmarks[FINGER_CHAINS[3][3]],
        ),
        computeFingerCurlRatio(
          landmarks[FINGER_CHAINS[4][0]], landmarks[FINGER_CHAINS[4][1]],
          landmarks[FINGER_CHAINS[4][2]], landmarks[FINGER_CHAINS[4][3]],
        ),
      ];

      // 7. Hand openness
      const handOpenness = computeHandOpenness(landmarks, handSize);

      return {
        handedness,
        timestamp,
        jointAngles,
        palmOrientation,
        interFingerSpread,
        thumbOpposition,
        fingerCurlRatios,
        handOpenness,
        handSize,
        gesturePhase: 'idle', // Updated by useMotionRecognition
      };
    });
  }, []);

  return compute;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useHandFeatures.ts
git commit -m "feat(hooks): add useHandFeatures hook for complete feature vector extraction"
```

---

### Task 5: Extend useHandPhysics with Jerk

**Files:**
- Modify: `src/hooks/useHandPhysics.ts`
- Modify: `src/types/telemetry.ts`

- [ ] **Step 1: Add jerk field to HandPhysics type**

In `src/types/telemetry.ts`, add `wristJerk` to `HandPhysics`:

```typescript
// Add after palmVelocity in HandPhysics interface:
  wristJerk: Vec3;
```

- [ ] **Step 2: Add acceleration to FrameCache and compute jerk in useHandPhysics**

In `src/hooks/useHandPhysics.ts`:

1. Extend `FrameCache` to store previous acceleration:

```typescript
interface FrameCache {
  landmarks: Landmark[];
  timestamp: number;
  velocities: Vec3[];
  wristAcceleration: Vec3; // NEW
}
```

2. Initialize `wristAcceleration` in the seed (where `frameCache.current[handedness]` is first set):

```typescript
frameCache.current[handedness] = {
  landmarks,
  timestamp,
  velocities: landmarks.map(() => zeroVec3()),
  wristAcceleration: zeroVec3(),
};
```

3. Compute jerk after computing `wristVelocity`:

```typescript
// After computing wristVelocity and before axis = dominantAxis(...)
const wristAcceleration = landmarkAcceleration(
  wristVelocity,
  prev.velocities[0] ?? zeroVec3(),
  deltaSeconds,
);
const wristJerk: Vec3 = {
  x: clampComponent((wristAcceleration.x - prev.wristAcceleration.x) / deltaSeconds, -10000, 10000),
  y: clampComponent((wristAcceleration.y - prev.wristAcceleration.y) / deltaSeconds, -10000, 10000),
  z: clampComponent((wristAcceleration.z - prev.wristAcceleration.z) / deltaSeconds, -10000, 10000),
};
```

4. Include `wristJerk` in the result object and `wristAcceleration` in the cache update:

```typescript
// In cache update:
frameCache.current[handedness] = {
  landmarks,
  timestamp,
  velocities: smoothedVelocities,
  wristAcceleration,
};

// In result.push:
result.push({
  handedness,
  landmarks: landmarkPhysics,
  wristVelocity,
  palmVelocity,
  wristJerk,
  angularVelocity,
  dominantAxis: axis,
  timestamp,
  deltaMs,
});
```

5. Add `wristJerk: zeroVec3()` to `buildZeroPhysics`.

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: PASS (existing tests should still pass, wristJerk is additive)

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useHandPhysics.ts src/types/telemetry.ts
git commit -m "feat(physics): add wrist jerk computation (3rd derivative of position)"
```

---

### Task 6: Add Gesture Phase Detection to useMotionRecognition

**Files:**
- Modify: `src/hooks/useMotionRecognition.ts`
- Modify: `src/types/telemetry.ts`

- [ ] **Step 1: Add gesturePhase to MotionPattern**

In `src/types/telemetry.ts`, import GesturePhase and add to MotionPattern:

```typescript
// At top of file, add import:
import type { GesturePhase } from './features';

// Add to MotionPattern interface:
  gesturePhase: GesturePhase;
```

- [ ] **Step 2: Add phase detection to useMotionRecognition**

In `src/hooks/useMotionRecognition.ts`, add a phase detector:

1. Add import and refs:

```typescript
import type { GesturePhase } from '../types/features';
import { FEATURES } from '../config';

// Inside the hook, add refs:
const prevPhaseRef = useRef<GesturePhase>('idle');
const phaseCountRef = useRef(0);
const prevSpeedRef = useRef(0);
```

2. Add the phase detection function (before the classify callback):

```typescript
function detectGesturePhase(speed: number, prevSpeed: number): GesturePhase {
  const acceleration = speed - prevSpeed;

  if (speed < FEATURES.PHASE_IDLE_THRESHOLD) return 'idle';
  if (acceleration > FEATURES.PHASE_PREPARATION_ACCEL_THRESHOLD) return 'preparation';
  if (acceleration < FEATURES.PHASE_STROKE_DECEL_THRESHOLD) return 'retraction';
  if (speed > FEATURES.PHASE_RETRACTION_SPEED_THRESHOLD) return 'stroke';
  return 'idle';
}
```

3. In the `classify` callback, after `push(...)`, compute phase with hysteresis:

```typescript
// After push({ ... }) line:
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
```

4. Add `gesturePhase: confirmedPhase` to all return paths (the detected patterns and the `none` fallback):

```typescript
const none: MotionPattern = { type: 'none', confidence: 0, durationMs: 0, timestamp, gesturePhase: confirmedPhase };

// For each pattern result, add gesturePhase before returning:
// In detectSwipe, detectCircular, etc., add gesturePhase to the returned object
```

The simplest approach: add `gesturePhase` to the final return, not inside each detector:

```typescript
const pattern =
  detectSwipe(timestamp) ??
  detectCircular(timestamp) ??
  detectAccelerationBurst(timestamp) ??
  detectStaticHold(timestamp) ??
  none;

return { ...pattern, gesturePhase: confirmedPhase };
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useMotionRecognition.ts src/types/telemetry.ts
git commit -m "feat(motion): add gesture phase detection (idle/preparation/stroke/retraction)"
```

---

## Wave 3: Integration (Depends on Wave 2)

### Task 7: Wire useHandFeatures into useHandAnalysis

**Files:**
- Modify: `src/hooks/useHandAnalysis.ts`

- [ ] **Step 1: Add useHandFeatures to composition**

```typescript
// Add imports:
import { useHandFeatures } from './useHandFeatures';
import type { HandFeatureVector } from '../types/features';

// In the hook, add:
const computeFeatures = useHandFeatures();

// Add ref and state:
const featuresRef = useRef<HandFeatureVector[]>([]);
const [uiFeatures, setUiFeatures] = useState<HandFeatureVector[]>([]);

// In computeFrame, after motions computation:
const features = computeFeatures(hands, timestamp);

// Update features with gesture phase from motion data:
const enrichedFeatures = features.map((f, i) => ({
  ...f,
  gesturePhase: motions[i]?.gesturePhase ?? 'idle',
}));

featuresRef.current = enrichedFeatures;

// In throttled UI update block, add:
setUiFeatures(enrichedFeatures);

// Update return type:
return { physicsData: physics, gripData: grips, motionData: motions, featuresData: enrichedFeatures };
```

2. Update `HandAnalysisData` interface:

```typescript
export interface HandAnalysisData {
  physicsData: HandPhysics[];
  gripData: GripState[];
  motionData: MotionPattern[];
  featuresData: HandFeatureVector[];
}
```

3. Update `UseHandAnalysisReturn` interface:

```typescript
export interface UseHandAnalysisReturn {
  physicsData: HandPhysics[];
  gripData: GripState[];
  motionData: MotionPattern[];
  featuresData: HandFeatureVector[];
  gripRef: React.RefObject<GripState[]>;
  computeFrame: (hands: HandData[], timestamp: number) => HandAnalysisData;
}
```

4. Update the return object:

```typescript
return {
  physicsData: uiPhysics,
  gripData: uiGrip,
  motionData: uiMotion,
  featuresData: uiFeatures,
  gripRef,
  computeFrame,
};
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean (App.tsx destructures from useHandAnalysis — the new `featuresData` field is available but not required anywhere yet)

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useHandAnalysis.ts
git commit -m "feat(analysis): wire useHandFeatures into useHandAnalysis compositor"
```

---

### Task 8: Add Features to HandTelemetry

**Files:**
- Modify: `src/types/telemetry.ts`

- [ ] **Step 1: Add optional features field**

In `src/types/telemetry.ts`, add to `HandTelemetry`:

```typescript
import type { HandFeatureVector } from './features';

// Add to HandTelemetry interface:
  features?: HandFeatureVector;
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean (field is optional, backwards compatible)

- [ ] **Step 3: Commit**

```bash
git add src/types/telemetry.ts
git commit -m "feat(telemetry): add optional HandFeatureVector to HandTelemetry type"
```

---

## Summary

| Wave | Tasks | Parallelizable | Files |
|------|-------|---------------|-------|
| 1 - Foundation | Types, Config, Utils+Tests | All 3 in parallel | 4 new files |
| 2 - Hooks | useHandFeatures, Physics jerk, Motion phases | All 3 in parallel | 1 new, 2 modified |
| 3 - Integration | Wire into useHandAnalysis, Telemetry type | Sequential | 2 modified |

**Total: 8 tasks, 5 new files, 5 modified files, ~51 features per hand per frame.**
