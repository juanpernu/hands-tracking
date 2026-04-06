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
