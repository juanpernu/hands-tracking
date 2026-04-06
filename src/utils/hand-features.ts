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
  // acos gives the angle between the two bone directions from the joint.
  // For a straight joint, vectors point in opposite directions → acos(-1) = PI.
  // We want flexion: 0 = straight, PI = fully folded, so return PI - acos(d).
  return Math.PI - Math.acos(d);
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
