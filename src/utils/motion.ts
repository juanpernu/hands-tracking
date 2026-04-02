/**
 * Motion recognition utilities extracted from useMotionRecognition hook.
 * Pure functions for angle calculations.
 */

/** Wrap an angle delta into [-PI, PI] to correctly handle discontinuities. */
export function wrapAngleDelta(delta: number): number {
  const TWO_PI = 2 * Math.PI;
  let d = delta % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}
