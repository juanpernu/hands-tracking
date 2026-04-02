/**
 * Grip detection utilities extracted from useGripDetection hook.
 * Pure functions for computing finger curl and classifying grip types.
 */

import type { GripType } from '../types/telemetry';
import type { Landmark } from '../types/index';
import { clamp, distance3d, dot3, normalize3, sub3 } from './geometry';

/**
 * Compute the curl for a single finger using the bone-angle method.
 *
 * bone1 = direction from PIP toward MCP (proximal bone)
 * bone2 = direction from PIP toward TIP (distal bone)
 * angle  = acos(dot(bone1, bone2))
 * curl   = 1 - angle / PI  →  0 = straight, 1 = fully bent back
 *
 * We use PIP as the pivot because it is the knuckle that moves the most
 * and gives the cleanest signal.
 */
export function computeFingerCurl(
  landmarks: Landmark[],
  mcpIdx: number,
  pipIdx: number,
  tipIdx: number,
): number {
  const mcp = landmarks[mcpIdx];
  const pip = landmarks[pipIdx];
  const tip = landmarks[tipIdx];

  if (!mcp || !pip || !tip) return 0;

  const bone1 = normalize3(sub3(mcp, pip)); // PIP → MCP direction
  const bone2 = normalize3(sub3(tip, pip)); // PIP → TIP direction

  const dotVal = clamp(dot3(bone1, bone2), -1, 1);
  const angle = Math.acos(dotVal); // 0 (straight) … PI (fully folded)

  return clamp(1 - angle / Math.PI, 0, 1);
}

/**
 * Classify raw curl values into a grip type.
 * Thresholds match the spec exactly.
 */
export function classifyGrip(
  fingerCurl: readonly [number, number, number, number, number],
  landmarks: Landmark[],
): GripType {
  const [thumbCurl, indexCurl, middleCurl, ringCurl, pinkyCurl] = fingerCurl;

  // Fist: every finger tightly curled.
  if (thumbCurl > 0.7 && indexCurl > 0.7 && middleCurl > 0.7 && ringCurl > 0.7 && pinkyCurl > 0.7) {
    return 'fist';
  }

  // Open: every finger extended.
  if (thumbCurl < 0.3 && indexCurl < 0.3 && middleCurl < 0.3 && ringCurl < 0.3 && pinkyCurl < 0.3) {
    return 'open';
  }

  // Pinch: thumb + index extended, others curled, and tips close together.
  if (
    thumbCurl < 0.3 &&
    indexCurl < 0.3 &&
    middleCurl > 0.5 &&
    ringCurl > 0.5 &&
    pinkyCurl > 0.5
  ) {
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    if (thumbTip && indexTip && distance3d(thumbTip, indexTip) < 0.05) {
      return 'pinch';
    }
  }

  // Point: index extended, middle/ring/pinky curled.
  if (indexCurl < 0.3 && middleCurl > 0.6 && ringCurl > 0.6 && pinkyCurl > 0.6) {
    return 'point';
  }

  return 'partial';
}
