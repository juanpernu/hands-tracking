# Hands Tracker

Browser-based hand tracking application built with React, TypeScript, and MediaPipe Hands. Manipulate DOM elements using webcam-tracked hand gestures. All processing runs client-side at 30fps.

## Features

- **Hand Tracking** - Two hands tracked simultaneously via MediaPipe Hands
- **Pinch to Grab** - Pinch gesture grabs and moves objects with either hand
- **Dual-Hand Manipulation** - Move two objects at the same time, one per hand
- **Clap to Screenshot** - Two-phase detection (converge + impact) captures the screen
- **Shake to Clear** - Shake both hands to delete all objects sequentially
- **Collision Physics** - Objects push each other apart, no overlapping
- **Real-Time Telemetry** - Per-hand velocity, acceleration, grip state, finger curl
- **Edge Detection** - Red pulsing border when hands approach screen edges
- **Draggable Panels** - Camera preview, HUD, and event log are all movable
- **Mouse Fallback** - Full functionality with mouse when camera is unavailable

## Gestures

| Gesture | Action |
|---------|--------|
| Pinch (thumb + index) | Grab and move objects/panels |
| Partial grip | Grab objects (more permissive) |
| Both hands pinch | Create new object |
| Both hands spread | Delete object under cursor |
| Shake both hands | Clear all objects |
| Clap | Take screenshot |

## Telemetry

Press **T** to toggle the telemetry overlay:

- **Hand Skeleton** - 21 landmarks connected by bones, color-coded by velocity
- **Velocity Vectors** - Arrows on fingertips showing speed and direction
- **Dual Hand HUD** - Per-hand stats: velocity, acceleration, grip type, finger curl bars
- **Gesture Timeline** - Last 5 seconds of gestures and velocity spikes
- **Event Log** - Real-time log of detected events (claps, shakes, grabs, releases)
- **Grip Indicator** - SVG ring around cursor showing grip force

## Tech Stack

- **React 18** + **TypeScript** + **Vite**
- **MediaPipe Hands** (Tasks Vision API via CDN)
- **Vitest** + React Testing Library

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in Chrome. Allow camera access when prompted.

### Requirements

- Chrome 100+, Firefox 100+, Edge 100+, Safari 16+ (macOS)
- Webcam
- HTTPS or localhost (required for camera API)

## Architecture

```
src/
  hooks/
    useHandTracking.ts      # MediaPipe integration, RAF loop, camera
    useGestureDetection.ts  # Pinch/spread detection with hysteresis
    useHandPhysics.ts       # Velocity, acceleration, angular velocity
    useGripDetection.ts     # Finger curl, grip type classification
    useMotionRecognition.ts # Swipe, circular, static-hold detection
    useObjectManagement.ts  # CRUD + collision resolution
    useObjectTracker.ts     # DOM object movement tracking
    useTelemetryRecorder.ts # Ring buffer for frame data
    useTelemetryLogger.ts   # Event detection (clap, shake, spikes)
    usePanelCollisions.ts   # Panel-to-panel collision manager
    useMouseFallback.ts     # Mouse input when no camera
  components/
    DraggableObject.tsx     # Colored squares with grab glow
    DraggablePanel.tsx      # Draggable UI panels with collision
    HandCursor.tsx          # Visual cursor (forwardRef, imperative)
    CameraPreview.tsx       # Webcam feed with mirror
    telemetry/
      HandSkeleton.tsx      # Canvas: landmarks + bones
      VelocityVectors.tsx   # Canvas: fingertip arrows
      DualHandHUD.tsx       # Per-hand stats panel
      GestureTimeline.tsx   # Canvas: 5-second timeline
      EventLog.tsx          # Scrollable event list
      GripIndicator.tsx     # SVG grip ring
      TelemetryOverlay.tsx  # Toggle container (T key)
  types/
    index.ts                # Core interfaces
    telemetry.ts            # Physics and telemetry types
  utils/
    geometry.ts             # 2D/3D math utilities
```

## Performance

All hot-path computations use `useRef` and direct DOM manipulation to avoid React re-renders at 30fps. The cursor position is driven imperatively via `style.transform`. Only discrete events (gesture changes, object creation) trigger React state updates.

## License

MIT
