# Hands Tracker

Browser-based hand tracking application that lets users manipulate DOM elements using webcam-tracked hand gestures. Built with React 19, TypeScript, and MediaPipe Hands. All processing runs entirely client-side at 30fps — no server required for the core experience.

## Features

- **Real-Time Hand Tracking** — Two hands tracked simultaneously via MediaPipe Hands (21 3D landmarks per hand)
- **Pinch to Grab** — Thumb-to-index pinch gesture grabs and moves objects, with hysteresis to prevent flickering
- **Dual-Hand Manipulation** — Each hand independently grabs and drags different objects simultaneously
- **Clap to Screenshot** — Two-phase detection (hand convergence + impact velocity spike) captures the screen
- **Shake to Clear** — Direction-reversal detector triggers sequential deletion of all objects
- **Collision Physics** — AABB collision detection with iterative push-apart resolution prevents object overlap
- **Real-Time Telemetry** — Per-hand velocity, acceleration, angular velocity, grip classification, and finger curl
- **Edge Detection** — Pulsing border warning when hands approach viewport edges
- **Draggable Panels** — Camera preview, HUD, and event log are all repositionable (hand or mouse)
- **Mouse Fallback** — Full functionality via mouse when camera is unavailable or denied

## Gestures

| Gesture | Trigger | Action |
|---------|---------|--------|
| Pinch (thumb + index) | Distance < 5% frame width | Grab and drag objects/panels |
| Partial grip (left hand) | Openness ratio < 65% | Grab with left hand (more permissive) |
| Both hands pinch | Simultaneous pinch, rising edge | Create new object at cursor |
| Both hands spread | Both hands > 30% apart, rising edge | Delete object under cursor |
| Shake both hands | 4+ direction reversals at speed > 0.3 | Clear all objects sequentially (150ms stagger) |
| Clap | Convergence phase + impact detection | Screenshot via canvas.toDataURL() |

## How It Works

The application captures video from the webcam and feeds it to MediaPipe's HandLandmarker neural network running in WebAssembly with GPU acceleration. MediaPipe returns 21 three-dimensional landmarks per detected hand at ~30fps. These landmarks flow through a pipeline of custom React hooks that progressively extract higher-level meaning:

```
Webcam → MediaPipe WASM (GPU) → 21 Landmarks × 2 hands
   → Gesture Detection (pinch/spread with hysteresis)
   → Hand Analysis (physics + grip + motion)
   → Interaction Controller (state machine → UI actions)
   → Imperative DOM update (cursor, objects)
```

The X axis is mirrored at the pixel conversion step so moving your right hand to the right moves the cursor right on screen, matching natural expectation.

### Gesture Detection with Hysteresis

Raw distance between thumb tip and index tip determines pinch state, but a single threshold would cause rapid toggling when hovering near it. Two thresholds create a dead zone:

```
          0.05            0.07
           │                │
───────────┼────────────────┼──────────────── distance
← pinching │  hysteresis    │  not pinching →
           │    zone        │
```

Enter at 0.05, exit at 0.07. The same pattern applies to grip detection (enter 0.65, exit 0.80).

### Collision Physics

Objects use axis-aligned bounding box (AABB) collision detection. When objects overlap, the resolver pushes them apart along the axis of minimum overlap, running up to 3 iterations to handle chain reactions. The currently-dragged object is treated as immovable — other objects yield.

### State Machine

The interaction controller operates as a state machine with five states:

```
idle → hovering → grabbing → idle
idle → creating → idle  (both-pinch, one frame)
hovering → deleting → idle  (both-spread, one frame)
```

`creating` and `deleting` last exactly one frame for visual feedback before reverting.

## Telemetry

Press **T** to toggle the telemetry overlay, which provides real-time visualization of the hand tracking internals:

| Layer | Technology | Description |
|-------|-----------|-------------|
| Hand Skeleton | Canvas | 21 landmarks connected by 27 bone segments, color-coded by per-landmark speed |
| Velocity Vectors | Canvas | Arrows on five fingertips scaled by speed, direction-corrected for mirrored coordinates |
| Gesture Timeline | Canvas | 5-second scrolling history of gesture states and velocity spikes |
| Dual Hand HUD | DOM | Per-hand: palm/wrist velocity, acceleration, dominant axis, angular velocity, grip type, grip force, finger curl bars |
| Event Log | DOM | Chronological list of detected events (clap, shake, grip change, velocity spike) with JSON export |
| Grip Indicator | SVG | Circular arc around cursor reflecting grip force (0–1), color-coded green/yellow/red |

### Telemetry Data Pipeline

Frame data flows through three cooperating hooks:

1. **Ring Buffer** (`useTelemetryRecorder`) — Fixed 90-frame circular buffer (3 seconds). Detects grip and motion state transitions. Supports full session export to JSON.
2. **Event Logger** (`useTelemetryLogger`) — Detects 9 event categories (velocity spikes, shakes, claps, grip changes, etc.). Clap detection uses a two-phase algorithm: convergence detection followed by impact verification within 500ms.
3. **Batch Writer** (`useBatchTelemetry`) — Accumulates frames and flushes to `POST /api/telemetry/batch` every 500 frames or 10 seconds. Failed requests retry up to 3 times. On page unload, remaining data ships via `navigator.sendBeacon` in 15-frame chunks.

Server-side, a custom Vite plugin handles batch writes to disk during development (`./telemetry-data/{date}/{sessionId}/`).

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| UI Framework | React 19 + TypeScript 5.9 | Component rendering, state management |
| Build Tool | Vite 8 | Dev server with custom telemetry plugin, COOP/COEP headers |
| Hand Tracking | MediaPipe Tasks Vision (WASM + GPU) | 21-landmark hand pose estimation at 30fps |
| Testing | Vitest 4 + React Testing Library | Unit tests for utilities and hooks |
| Rendering | Canvas API + SVG | Telemetry visualizations (skeleton, vectors, timeline) |

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in Chrome. Allow camera access when prompted.

### Requirements

- Node.js 20+
- Chrome 100+, Firefox 100+, Edge 100+, Safari 16+ (macOS)
- Webcam (optional — mouse fallback available)
- HTTPS or localhost (required for camera API)

### Commands

```bash
npm run dev        # Dev server at http://localhost:5173
npm run build      # TypeScript check + production build
npm run preview    # Serve built output
npm run test       # Vitest (watch mode)
npm run test:run   # Single test run (CI)
npm run lint       # ESLint
```

## Architecture

### Layer Model

```
┌──────────────────────────────────────────────────────────────┐
│  Presentation Layer                                          │
│  App, DraggableObject, DraggablePanel, HandCursor,           │
│  CameraPreview, TelemetryOverlay + sub-views                 │
├──────────────────────────────────────────────────────────────┤
│  Interaction Layer                                           │
│  useInteractionController — state machine, grab/drag, shake  │
│  useGestureDetection — pinch/spread with hysteresis          │
│  useMouseFallback — mouse input normalization                │
├──────────────────────────────────────────────────────────────┤
│  Analysis Layer                                              │
│  useHandAnalysis (compositor)                                │
│    ├── useHandPhysics — velocity, acceleration, angular vel  │
│    ├── useGripDetection — finger curl, grip classification   │
│    └── useMotionRecognition — swipe, circular, static hold   │
├──────────────────────────────────────────────────────────────┤
│  Sensing Layer                                               │
│  useHandTracking — MediaPipe, camera, RAF detection loop     │
└──────────────────────────────────────────────────────────────┘
```

### Project Structure

```
src/
  hooks/                        # 16 custom hooks
    useHandTracking.ts          # MediaPipe integration, camera lifecycle, RAF loop
    useGestureDetection.ts      # Pinch/spread detection with hysteresis + cursor smoothing
    useHandPhysics.ts           # EMA-smoothed velocity, acceleration, angular velocity
    useGripDetection.ts         # Finger curl (bone-angle method), grip classification
    useMotionRecognition.ts     # Swipe, circular, acceleration-burst, static-hold
    useHandAnalysis.ts          # Composes physics + grip + motion, throttled at 10Hz
    useInteractionController.ts # Central state machine, dual-hand grab, edge detection
    useObjectManagement.ts      # CRUD + AABB collision resolution
    useObjectTracker.ts         # Per-object velocity and grab state tracking
    useTelemetryRecorder.ts     # Ring buffer (90 frames) + state transition events
    useTelemetryLogger.ts       # 9 event categories, two-phase clap detection
    useBatchTelemetry.ts        # Network batch writer with retry + sendBeacon
    usePanelCollisions.ts       # Panel-to-panel collision manager
    useMouseFallback.ts         # Mouse input when camera unavailable
    useWindowSize.ts            # Debounced window resize tracking
  components/
    App.tsx                     # Root: RAF loop, hook composition, state orchestration
    DraggableObject.tsx         # Colored squares with hover/grab visual states
    DraggablePanel.tsx          # Repositionable panels (hand + mouse drag)
    HandCursor.tsx              # Imperative cursor (forwardRef, translate3d)
    CameraPreview.tsx           # Mirrored webcam feed with collapse toggle
    telemetry/
      TelemetryOverlay.tsx      # Toggle container (T key)
      HandSkeleton.tsx          # Canvas: 21 landmarks + 27 bones
      VelocityVectors.tsx       # Canvas: fingertip velocity arrows
      DualHandHUD.tsx           # Per-hand stats panel
      GestureTimeline.tsx       # Canvas: 5-second scrolling timeline
      EventLog.tsx              # Scrollable event list with JSON export
      GripIndicator.tsx         # SVG grip force ring
  types/
    index.ts                    # Core interfaces (Position, HandData, GestureState)
    telemetry.ts                # Physics types (Vec3, HandPhysics, GripState, MotionPattern)
  utils/
    geometry.ts                 # 2D/3D vector math (distance, lerp, normalize, hit-test)
    collision.ts                # AABB overlap detection + multi-pass resolution
    grip.ts                     # Finger curl computation + grip classification
    motion.ts                   # Angle wrapping utilities
    colors.ts                   # Speed/grip color mapping
server/
  telemetry-writer.ts           # File-based batch writer with validation
vite-plugin-telemetry.ts        # Dev server middleware for telemetry endpoints
```

## Performance

The central design philosophy is **zero React re-renders per frame on the hot path**. The application operates at three update frequency tiers:

| Tier | Frequency | What |
|------|-----------|------|
| RAF (hot path) | 30 fps | Physics, grip, motion, cursor position, hit testing, telemetry recording |
| Throttled state | ~10 Hz | Physics/grip/motion React state, timeline entries |
| UI events | On change | Gesture transitions, object add/remove |

Key performance patterns:

- **Ref-first state** — All frame-by-frame data lives in `useRef`. React state is only set when values actually change, gated by equality checks.
- **Imperative DOM** — Cursor and grip indicator positioned via `style.transform = translate3d(...)` directly in the RAF loop. No re-render, no layout recalc (GPU-composited).
- **Stable callbacks** — All hook callbacks use `useCallback` with ref-based reads, keeping identity stable across renders.
- **Canvas rendering** — Skeleton, velocity vectors, and timeline use `<canvas>` instead of DOM/SVG to avoid creating hundreds of elements per frame.
- **Memoization** — All visual components wrapped in `React.memo` with targeted prop dependencies.

## Documentation

For a comprehensive deep-dive into every system, hook, and algorithm, see the [Technical Manual](docs/technical-manual.md).

## License

MIT
