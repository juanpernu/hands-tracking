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

  // Pinch MUST be checked BEFORE open — during a natural pinch, fingers
  // remain largely extended (curls ~0.05-0.13), which would match "open"
  // and skip the pinch check entirely.
  // Detected by fingertip proximity: thumb(4) + index(8) or + middle(12).
  const thumbTip = landmarks[LANDMARK.THUMB_TIP];
  const indexTip = landmarks[LANDMARK.INDEX_TIP];
  const middleTip = landmarks[LANDMARK.MIDDLE_TIP];

  if (thumbTip && indexTip) {
    const thumbIndexDist = distance3d(thumbTip, indexTip);
    const thumbMiddleDist = middleTip ? distance3d(thumbTip, middleTip) : Infinity;
    const indexMiddleDist = middleTip ? distance3d(indexTip, middleTip) : Infinity;

    const threeFingerPinch = thumbIndexDist < GRIP.PINCH_TIP_DISTANCE
      && thumbMiddleDist < GRIP.PINCH_TIP_DISTANCE
      && indexMiddleDist < GRIP.PINCH_TIP_DISTANCE;

    const twoFingerPinch = thumbIndexDist < GRIP.PINCH_TIP_DISTANCE;

    if (threeFingerPinch || twoFingerPinch) {
      return 'pinch';
    }
  }

  // Fist: every finger tightly curled.
  if (thumbCurl > GRIP.FIST_THRESHOLD && indexCurl > GRIP.FIST_THRESHOLD && middleCurl > GRIP.FIST_THRESHOLD && ringCurl > GRIP.FIST_THRESHOLD && pinkyCurl > GRIP.FIST_THRESHOLD) {
    return 'fist';
  }

  // Open: every finger extended.
  if (thumbCurl < GRIP.OPEN_THRESHOLD && indexCurl < GRIP.OPEN_THRESHOLD && middleCurl < GRIP.OPEN_THRESHOLD && ringCurl < GRIP.OPEN_THRESHOLD && pinkyCurl < GRIP.OPEN_THRESHOLD) {
    return 'open';
  }

  // Point: index extended, middle/ring/pinky curled.
  if (indexCurl < GRIP.POINT_OPEN_THRESHOLD && middleCurl > GRIP.POINT_CURL_THRESHOLD && ringCurl > GRIP.POINT_CURL_THRESHOLD && pinkyCurl > GRIP.POINT_CURL_THRESHOLD) {
    return 'point';
  }

  return 'partial';
}
