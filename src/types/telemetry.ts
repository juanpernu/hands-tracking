import type { Landmark } from './index';
import type { SpatialTelemetryData } from './spatial';
import type { GesturePhase } from './features';

// Primitives
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// Per-landmark physics
export interface LandmarkPhysics {
  index: number;
  velocity: Vec3;
  speed: number;
  acceleration: Vec3;
}

// Whole-hand physics
export interface HandPhysics {
  handedness: 'Left' | 'Right';
  landmarks: LandmarkPhysics[];
  wristVelocity: Vec3;
  palmVelocity: Vec3;
  angularVelocity: number;
  wristJerk: Vec3;
  dominantAxis: 'horizontal' | 'vertical' | 'depth' | 'none';
  timestamp: number;
  deltaMs: number;
}

// Grip detection
export type GripType = 'open' | 'fist' | 'pinch' | 'point' | 'partial';

export interface GripState {
  handedness: 'Left' | 'Right';
  opennessRatio: number;
  gripForce: number;
  gripType: GripType;
  fingerCurl: [number, number, number, number, number];
  timestamp: number;
}

// Motion patterns
export type SwipeDirection = 'left' | 'right' | 'up' | 'down';
export type MotionPatternType =
  | 'swipe'
  | 'circular'
  | 'static-hold'
  | 'acceleration-burst'
  | 'none';

export interface MotionPattern {
  type: MotionPatternType;
  confidence: number;
  swipeDirection?: SwipeDirection;
  circularDirection?: 1 | -1;
  durationMs: number;
  timestamp: number;
}

// Gesture events (discrete)
export type GestureType =
  | 'pinch-start'
  | 'pinch-end'
  | 'swipe'
  | 'fist'
  | 'open-palm'
  | 'point'
  | 'grab-intent'
  | 'hold';

export interface GestureEvent {
  id: string;
  type: GestureType;
  handedness: 'Left' | 'Right';
  confidence: number;
  startTimestamp: number;
  timestamp: number;
  durationMs: number;
  wristPosition: Vec3;
  metadata?: Record<string, unknown>;
}

// Per-frame telemetry snapshot
export interface HandTelemetry {
  frameId: number;
  timestamp: number;
  deltaMs: number;
  handedness: 'Left' | 'Right';
  landmarks: Landmark[];
  physics: HandPhysics;
  grip: GripState;
  motion: MotionPattern;
  spatial?: SpatialTelemetryData;
}

// Ring buffer
export interface TelemetryBuffer {
  capacity: number;
  head: number;
  size: number;
  frames: (HandTelemetry | null)[];
}

// Session export
export interface TelemetrySession {
  id: string;
  startTime: number;
  endTime: number;
  frameCount: number;
  frames: HandTelemetry[];
  events: GestureEvent[];
  sampleRateFps: number;
}
