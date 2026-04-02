/**
 * Shared color utility functions.
 * Extracted from HandSkeleton, VelocityVectors, DualHandHUD, and GripIndicator.
 */

/**
 * Map a speed value to a color.
 * Used by HandSkeleton and VelocityVectors for landmark/bone coloring.
 *
 * - speed < 2  → blue (#4A90D9)
 * - speed < 8  → green (#27C93F)
 * - speed < 20 → yellow (#FFBD2E)
 * - speed >= 20 → red (#FF5F56)
 */
export function speedToColor(speed: number): string {
  if (speed < 2) return '#4A90D9';
  if (speed < 8) return '#27C93F';
  if (speed < 20) return '#FFBD2E';
  return '#FF5F56';
}

/**
 * Map a grip force / confidence value to a color.
 * Used by DualHandHUD and GripIndicator.
 *
 * - value < 0.3  → green (#27C93F)
 * - value < 0.7  → yellow (#FFBD2E)
 * - value >= 0.7 → red (#FF5F56)
 */
export function gripColor(value: number): string {
  if (value < 0.3) return '#27C93F';
  if (value < 0.7) return '#FFBD2E';
  return '#FF5F56';
}
