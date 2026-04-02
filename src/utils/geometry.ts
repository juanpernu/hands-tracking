/**
 * Pure geometry utility functions.
 * All functions are stateless and side-effect free for easy unit testing.
 */

/** Euclidean distance between two 2D points. */
export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Linear interpolation between current and target by a blending factor (0–1). */
export function lerp(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

/**
 * Convert a normalized (0–1) coordinate to pixel coordinates.
 * X is mirrored so that moving your right hand right moves the cursor right
 * (MediaPipe reports from a front-facing camera perspective).
 */
export function normalizedToPixel(
  normalized: { x: number; y: number },
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: (1 - normalized.x) * width,
    y: normalized.y * height,
  };
}

/**
 * Axis-aligned bounding box (AABB) hit test.
 * Returns true when cursor falls inside the rectangle defined by obj.
 */
export function hitTest(
  cursor: { x: number; y: number },
  obj: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    cursor.x >= obj.x &&
    cursor.x <= obj.x + obj.width &&
    cursor.y >= obj.y &&
    cursor.y <= obj.y + obj.height
  );
}

/** Clamp a value to the inclusive [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// --- 3D vector operations for telemetry ---

/** Euclidean distance in 3D space. */
export function distance3d(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Dot product of two 3D vectors. */
export function dot3(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Cross product of two 3D vectors. */
export function cross3(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** Normalize a 3D vector to unit length. Returns zero vector if magnitude is 0. */
export function normalize3(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const mag = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (mag === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / mag, y: v.y / mag, z: v.z / mag };
}

/** Magnitude of a 3D vector. */
export function magnitude3(v: { x: number; y: number; z: number }): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/** Subtract two 3D vectors: a - b. */
export function sub3(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** Average position of multiple 3D points. */
export function centroid3(points: { x: number; y: number; z: number }[]): { x: number; y: number; z: number } {
  const n = points.length;
  if (n === 0) return { x: 0, y: 0, z: 0 };
  let sx = 0, sy = 0, sz = 0;
  for (const p of points) { sx += p.x; sy += p.y; sz += p.z; }
  return { x: sx / n, y: sy / n, z: sz / n };
}
