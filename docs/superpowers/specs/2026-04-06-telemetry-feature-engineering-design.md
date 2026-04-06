# Telemetry Feature Engineering Upgrade — Design Spec

**Date:** 2026-04-06
**Status:** Approved
**Author:** Juan Manuel Pernumian + Claude
**Research basis:** 6 academic papers on hand gesture recognition (ACM, ScienceDirect, arXiv, PMC, yzhu.io, Google/MediaPipe)

---

## 1. Objective

Upgrade the telemetry and feature extraction pipeline to produce richer, more accurate hand features that improve gesture detection robustness. The current system uses basic PIP-joint curl and raw landmark physics. The upgrade introduces full joint angle extraction, extrinsic/intrinsic feature decomposition, temporal dynamics, and physiological constraint filtering — all techniques validated across the research literature.

## 2. Research-Backed Decisions

| Decision | Choice | Source |
|---|---|---|
| Feature decomposition | Separate palm pose (extrinsic) from finger config (intrinsic) | Google/MediaPipe paper (2021) |
| Joint angles | Full MCP + PIP + DIP per finger (15 angles) | PMC Glove, Data Glove D-H model |
| Scale invariance | Normalize all distances by wrist→middle_MCP distance | Google, ScienceDirect survey |
| Joint constraint filtering | Clamp to physiological limits to reduce jitter | Data Glove paper (D-H model) |
| Temporal features | Per-finger angular velocity, curl velocity, jerk | PMC Glove (3-phase gesture model) |
| Gesture phase detection | Velocity profile zero-crossings for preparation/stroke/retraction | PMC Glove |
| Classification approach | Features > model complexity. 3 FC layers × 50 neurons = sufficient | Google/MediaPipe paper |
| Temporal windowing | 30-frame sliding window (1s at 30fps) | ScienceDirect, ACM surveys |

## 3. Architecture

### 3.1 New Hook: `useHandFeatures`

A compositor hook that sits between `useHandTracking` (sensing) and the existing analysis hooks. It produces a complete, normalized feature vector per hand per frame.

```
useHandTracking (21 landmarks × 2 hands)
       │
       ▼
useHandFeatures (NEW)
  ├── extractJointAngles()      → 15 angles per hand
  ├── extractPalmOrientation()  → 3 Euler angles per hand
  ├── extractInterFingerSpread() → 4 spread angles per hand
  ├── extractThumbOpposition()  → 4 distances per hand
  ├── computeHandSize()         → 1 normalization factor
  ├── applyJointConstraints()   → clamp angles to physio limits
  └── normalizeFeatures()       → scale-invariant output
       │
       ▼
useHandAnalysis (MODIFIED — consumes feature vector instead of raw landmarks)
  ├── useHandPhysics (EXTENDED — adds jerk, per-finger angular velocity)
  ├── useGripDetection (IMPROVED — uses 15 angles instead of 5 curls)
  └── useMotionRecognition (IMPROVED — uses gesture phases, temporal window)
```

### 3.2 Feature Vector (per hand, per frame)

**Static features (32 per hand):**

| Feature Group | Count | Description |
|---|---|---|
| Joint angles | 15 | MCP, PIP, DIP flexion for each of 5 fingers |
| Palm Euler angles | 3 | Pitch, yaw, roll from palm normal + wrist vectors |
| Inter-finger spread | 4 | Angle between adjacent finger MCP vectors |
| Thumb opposition | 4 | Normalized distance from thumb tip to index/middle/ring/pinky tips |
| Finger curl ratios | 5 | Tip-to-MCP distance / total finger bone length (normalized) |
| Hand openness | 1 | Average fingertip-to-palm-center distance, normalized |

**Temporal features (19 per hand):**

| Feature Group | Count | Description |
|---|---|---|
| Wrist velocity | 3 | dx/dt of landmark 0 (EMA smoothed) |
| Wrist acceleration | 3 | d²x/dt² of landmark 0 |
| Wrist jerk | 3 | d³x/dt³ of landmark 0 |
| Finger angular velocity | 5 | Rate of change of curl ratio per finger |
| Gesture phase | 1 | Enum: idle, preparation, stroke, retraction |
| Per-finger angular velocity (aggregate) | 4 | Not per-joint — aggregate per finger from dominant joint change |

**Total: 51 features per hand per frame.**

### 3.3 Normalization Strategy

1. **Translation invariance**: All positions relative to wrist (landmark 0)
2. **Scale invariance**: All distances divided by `handSize = distance(wrist, middle_MCP)`
3. **Rotation invariance** (intrinsic features only): Finger angles computed in the palm's local coordinate frame after factoring out palm rotation
4. **Temporal smoothing**: EMA with alpha=0.4 on all velocity-derived features (consistent with existing `useHandPhysics`)

### 3.4 Joint Constraint Filtering

Clamp computed angles to physiological limits before downstream consumption:

| Joint | Min | Max | Source |
|---|---|---|---|
| MCP flexion | 0° | 90° | Data Glove D-H model |
| MCP abduction | -15° | 15° | Data Glove D-H model |
| PIP flexion | 0° | 110° | Data Glove D-H model |
| DIP flexion | 0° | 90° | Data Glove D-H model |

This acts as a jitter filter: when MediaPipe produces a physically impossible angle (e.g., PIP at 140°), it gets clamped to 110°, reducing noise in downstream features.

## 4. Modifications to Existing Code

### 4.1 `useHandPhysics` — Extended

Add to existing physics computation:
- **Jerk**: 3rd derivative of wrist position (finite difference of acceleration)
- **Per-finger angular velocity**: Rate of change of curl ratio (already computed in `useGripDetection`, need to expose the delta)

No existing features removed. Backwards compatible.

### 4.2 `useGripDetection` — Improved

Replace the current 5-value PIP-only curl with full 15-angle joint extraction. The existing `classifyGrip` function gets richer input:

**Current:** `fingerCurl: [thumb, index, middle, ring, pinky]` (PIP angle only)
**New:** Same 5-value tuple remains for backwards compat, but computed as weighted average of MCP+PIP+DIP per finger. The full 15 angles are available in the feature vector for consumers that need them.

Grip classification thresholds may need re-tuning with the richer input.

### 4.3 `useMotionRecognition` — Improved

Add gesture phase detection:
- Track wrist velocity magnitude over the existing ring buffer
- Detect phases via velocity profile:
  - `idle`: speed < threshold
  - `preparation`: speed increasing (acceleration positive)
  - `stroke`: speed at peak or decreasing from peak
  - `retraction`: speed decreasing toward zero
- Rising-edge of `preparation → stroke` transition = gesture onset
- Falling-edge of `stroke → retraction → idle` = gesture end

Improves swipe and shake detection with formal segmentation instead of ad-hoc heuristics.

### 4.4 `useHandAnalysis` — Modified

Currently composes physics + grip + motion. Extended to also compose `useHandFeatures` and expose the full feature vector:

```typescript
const { physicsData, gripData, motionData, featuresData, gripRef, computeFrame } = useHandAnalysis();
```

`featuresData` is the 51-element feature vector per hand, updated at the same 10Hz throttle as other analysis data.

### 4.5 Telemetry Recording

`useTelemetryRecorder` extended to include the feature vector in `HandTelemetry`:

```typescript
interface HandTelemetry {
  // ... existing fields ...
  features?: HandFeatureVector;  // Optional for backwards compat
}
```

## 5. New Files

```
src/
  utils/
    hand-features.ts              # Pure functions: extractJointAngles, extractPalmOrientation,
                                  # extractInterFingerSpread, extractThumbOpposition,
                                  # computeHandSize, applyJointConstraints
    hand-features.test.ts         # Tests with known landmark positions
  hooks/
    useHandFeatures.ts            # Compositor hook
  types/
    features.ts                   # HandFeatureVector, JointAngles, PalmOrientation, GesturePhase
```

## 6. Modified Files

| File | Change |
|---|---|
| `src/hooks/useHandAnalysis.ts` | Add `useHandFeatures` composition, expose `featuresData` |
| `src/hooks/useHandPhysics.ts` | Add jerk computation |
| `src/hooks/useGripDetection.ts` | Use full joint angles, improve grip classification |
| `src/hooks/useMotionRecognition.ts` | Add gesture phase detection |
| `src/types/telemetry.ts` | Add `HandFeatureVector` to `HandTelemetry` |
| `src/config.ts` | Add `FEATURES` config section with joint limits and thresholds |

## 7. Unchanged Code

- `useHandTracking` — MediaPipe integration unchanged
- `useGestureDetection` — Pinch/spread hysteresis unchanged
- `useInteractionController` — Consumes same interfaces
- Agent layer — Consumes gesture events, unaffected
- Plugin system — Unaffected
- All components — Unaffected

## 8. Testing Strategy

| Target | Approach |
|---|---|
| `extractJointAngles` | Unit: known landmark triangles → expected angles |
| `extractPalmOrientation` | Unit: known palm normal → expected Euler angles |
| `applyJointConstraints` | Unit: out-of-range angles → clamped values |
| `computeHandSize` | Unit: known wrist/MCP positions → expected scale factor |
| `extractInterFingerSpread` | Unit: known MCP positions → expected spread angles |
| `extractThumbOpposition` | Unit: known tip positions → expected distances |
| `useHandFeatures` | Integration: mock HandData → complete feature vector |
| Gesture phase detection | Unit: velocity profiles → expected phase transitions |
| Improved grip classification | Regression: existing test cases must still pass with new algorithm |

## 9. What This Does NOT Include

- No ML model training or inference (features are consumed by existing heuristics, improved)
- No new gesture types (features enable future gestures but this spec doesn't add them)
- No UI changes (telemetry overlay remains the same)
- No server-side changes
- No breaking changes to existing interfaces
