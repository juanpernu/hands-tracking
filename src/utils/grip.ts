/**
 * Grip detection utilities extracted from useGripDetection hook.
 * Pure functions for computing finger curl and classifying grip types.
 */

import type { GripType } from '../types/telemetry';
import type { Landmark } from '../types/index';
import { clamp, distance3d, dot3, normalize3, sub3 } from './geometry';
import { GRIP, LANDMARK } from '../config';

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
  if (thumbCurl > GRIP.FIST_THRESHOLD && indexCurl > GRIP.FIST_THRESHOLD && middleCurl > GRIP.FIST_THRESHOLD && ringCurl > GRIP.FIST_THRESHOLD && pinkyCurl > GRIP.FIST_THRESHOLD) {
    return 'fist';
  }

  // Open: every finger extended.
  if (thumbCurl < GRIP.OPEN_THRESHOLD && indexCurl < GRIP.OPEN_THRESHOLD && middleCurl < GRIP.OPEN_THRESHOLD && ringCurl < GRIP.OPEN_THRESHOLD && pinkyCurl < GRIP.OPEN_THRESHOLD) {
    return 'open';
  }

  // Pinch: thumb + index extended, others curled, and tips close together.
  if (
    thumbCurl < GRIP.PINCH_OPEN_THRESHOLD &&
    indexCurl < GRIP.PINCH_OPEN_THRESHOLD &&
    middleCurl > GRIP.PINCH_CURL_THRESHOLD &&
    ringCurl > GRIP.PINCH_CURL_THRESHOLD &&
    pinkyCurl > GRIP.PINCH_CURL_THRESHOLD
  ) {
    const thumbTip = landmarks[LANDMARK.THUMB_TIP];
    const indexTip = landmarks[LANDMARK.INDEX_TIP];
    if (thumbTip && indexTip && distance3d(thumbTip, indexTip) < GRIP.PINCH_TIP_DISTANCE) {
      return 'pinch';
    }
  }

  // Point: index extended, middle/ring/pinky curled.
  if (indexCurl < GRIP.POINT_OPEN_THRESHOLD && middleCurl > GRIP.POINT_CURL_THRESHOLD && ringCurl > GRIP.POINT_CURL_THRESHOLD && pinkyCurl > GRIP.POINT_CURL_THRESHOLD) {
    return 'point';
  }

  return 'partial';
}
