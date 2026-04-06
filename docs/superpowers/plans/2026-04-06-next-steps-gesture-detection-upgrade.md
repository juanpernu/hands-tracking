# Next Steps: Gesture Detection Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leverage the 51-feature hand feature vector to improve existing gesture detection and enable new gestures.

**Architecture:** The feature engineering pipeline (PR #7) produces `HandFeatureVector` per hand per frame. This plan upgrades the consumers of that data: grip classification, motion detection, and the agent layer gesture mappings.

**Tech Stack:** React 19, TypeScript 5.9, Vitest, existing MediaPipe + feature pipeline.

**Prerequisites:** PR #7 (telemetry feature engineering) must be merged into develop.

---

## Phase 1: Improved Grip Classification

### Rationale
Current grip classification uses 5 PIP-only curl values with hardcoded thresholds. The feature vector now provides 15 joint angles + 4 inter-finger spread angles + 4 thumb opposition distances. This enables:
- More precise gesture discrimination (e.g., distinguishing "point" from "gun" hand shape)
- Reduced false positives from MediaPipe jitter (constraint-filtered angles are cleaner)
- New grip types (e.g., "OK sign", "peace", "call me", "thumbs up/down")

### Task 1.1: Refactor `classifyGrip` to use full JointAngles

**Files:**
- Modify: `src/utils/grip.ts`
- Modify: `src/hooks/useGripDetection.ts`
- Modify: `src/utils/__tests__/grip.test.ts`
- Modify: `src/types/telemetry.ts`

**Changes:**
- Expand `GripType` union with new types: `'ok'`, `'thumbs-up'`, `'thumbs-down'`, `'call-me'`, `'peace'`
- `classifyGrip` receives `JointAngles` + `thumbOpposition` + `interFingerSpread` alongside existing curl
- Classification logic uses the richer features:
  - **OK sign**: thumb-index opposition < 0.3, other fingers extended (MCP angle < 30°)
  - **Thumbs up**: thumb MCP extended (< 20°), all other fingers curled (PIP > 70°)
  - **Thumbs down**: same as thumbs up but palm pitch inverted (pitch < -45°)
  - **Peace/Victory**: index + middle PIP < 30°, ring + pinky PIP > 70°
  - **Call me**: thumb + pinky extended, index + middle + ring curled
- Existing grip types (open, fist, pinch, point, partial) retain their thresholds for backwards compat
- New types are checked AFTER existing ones to not break current behavior

### Task 1.2: Update GestureInterpreter mappings for new grips

**Files:**
- Modify: `src/App.tsx` (defaultMappings)
- Modify: `src/agent/types.ts` (AgentGestureType)

**Changes:**
- Add new `AgentGestureType` values: `'grip-ok'`, `'grip-thumbs-up'`, `'grip-thumbs-down'`, `'grip-peace'`, `'grip-call-me'`
- Add emission of grip-change events in `useInteractionController` when grip type changes
- Add default mappings (examples):
  - `'grip-thumbs-up'` → `'browser.notifications:show-notification'` (with params: title: "👍")
  - `'grip-ok'` → TBD (placeholder, no action yet)

---

## Phase 2: Improved Motion Detection

### Rationale
Current swipe detection uses raw palm velocity on a dominant axis. Gesture phases enable smarter detection: a swipe should only trigger during the `stroke` phase, not during `preparation` or `retraction`. This reduces false positives from hand repositioning.

### Task 2.1: Phase-aware swipe detection

**Files:**
- Modify: `src/hooks/useMotionRecognition.ts`

**Changes:**
- `detectSwipe` only returns a swipe when the current gesture phase is `'stroke'` or the previous phase was `'preparation'`
- This prevents false swipe triggers from:
  - Hand repositioning (idle → idle, never enters preparation)
  - Aborted gestures (preparation → retraction, never enters stroke)
- Swipe confidence boosted when preparation phase was detected (the user was "winding up")

### Task 2.2: Phase-aware shake detection

**Files:**
- Modify: `src/hooks/useInteractionController.ts`

**Changes:**
- `updateShake` checks gesture phase: only count direction reversals during `stroke` phase
- Reset reversal count on `idle` phase (hand at rest = no shake)
- Use jerk magnitude as additional confirmation (shakes have high jerk due to rapid direction changes)

### Task 2.3: Improved clap detection

**Files:**
- Modify: `src/hooks/useTelemetryLogger.ts`

**Changes:**
- Use palm orientation convergence (palm normals facing each other) as additional signal
- Current: velocity-based convergence + proximity. New: add `palmOrientation.normal` dot product — when dot product of left and right palm normals approaches -1 (facing each other), boost clap confidence
- Reduces false positives from hands passing each other without clapping

---

## Phase 3: Temporal Window Classification

### Rationale
The feature pipeline produces a 51-element vector per frame. A sliding window of 30 frames (1 second at 30fps) creates a 30×51 matrix that encodes the temporal evolution of hand pose. This enables pattern matching for complex gestures that unfold over time (sign language letters, custom command sequences).

### Task 3.1: Create temporal feature buffer

**Files:**
- Create: `src/hooks/useTemporalFeatures.ts`

**Changes:**
- Ring buffer of 30 `HandFeatureVector` frames per hand
- Produces a flattened or structured temporal matrix on demand
- Computes aggregate temporal stats:
  - Mean/variance of each feature over the window
  - Delta (first frame vs last frame) for each feature
  - Dominant gesture phase in the window
- Exposed via `useHandAnalysis` as `temporalData`

### Task 3.2: Rule-based temporal gesture detector

**Files:**
- Create: `src/agent/hooks/useTemporalGestureDetector.ts`

**Changes:**
- Consumes the temporal feature buffer
- Defines gesture templates as feature-over-time patterns:
  - **Circle gesture**: circular motion detected + high angular velocity + duration > 500ms
  - **Pinch-and-hold**: pinch sustained > 1s (thumb-index opposition stable < 0.1 for 30 frames)
  - **Wave**: alternating wrist roll with fingers extended
- Emits `AgentGestureEvent` for matched temporal patterns
- Integrates with `useGestureInterpreter` as an additional event source

---

## Phase 4: Telemetry & Analysis UI

### Rationale
The 51-feature vector is invisible to the developer during testing. Exposing it in the telemetry overlay enables visual debugging and tuning of thresholds.

### Task 4.1: Feature vector HUD panel

**Files:**
- Create: `src/components/telemetry/FeatureHUD.tsx`
- Modify: `src/App.tsx`

**Changes:**
- New panel showing per-hand feature values in real-time:
  - Joint angles as colored bars (green=extended, red=curled)
  - Palm orientation as a 3D compass indicator
  - Gesture phase as a colored badge
  - Hand openness as a percentage
- Rendered inside a `DraggablePanel`, toggled by telemetry visibility
- Updates at 10Hz (uses `featuresData` from useHandAnalysis)

### Task 4.2: Feature recording in telemetry batches

**Files:**
- Modify: `src/hooks/useTelemetryRecorder.ts`
- Modify: `src/hooks/useBatchTelemetry.ts`

**Changes:**
- Include `HandFeatureVector` in each `HandTelemetry` frame when recording
- Batch writer sends feature data alongside landmarks/physics/grip/motion
- Enables offline analysis of the enriched feature set

---

## Execution Strategy

| Phase | Dependencies | Complexity | Priority |
|-------|-------------|-----------|----------|
| 1 - Grip Classification | PR #7 merged | Medium | High — enables new gestures immediately |
| 2 - Motion Detection | PR #7 merged | Low | High — reduces false positives |
| 3 - Temporal Window | Phases 1+2 | High | Medium — enables complex gestures |
| 4 - Telemetry UI | PR #7 merged | Low | Low — developer tooling |

Phases 1 and 2 can run in parallel. Phase 3 depends on 1+2. Phase 4 is independent.

---

## Key Constraints

- **Performance budget**: All feature computation must complete in < 5ms per frame (MediaPipe takes ~30ms, leaving ~3ms for features in a 33ms frame budget)
- **Backwards compatibility**: Existing gesture detection must not regress. New grip types and improved detection are additive.
- **No ML model training**: This plan uses rule-based classification on the feature vector. ML-based classification (training a neural network on collected feature data) is a separate future initiative.
- **No breaking changes**: All new features are optional fields or new enum values in existing types.
