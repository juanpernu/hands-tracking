/**
 * Collision detection utilities extracted from useObjectManagement hook.
 * Pure functions for AABB overlap testing and collision resolution.
 */

import type { DraggableObjectData } from '../types';

const COLLISION_ITERATIONS = 3;

/** Check if two AABBs overlap */
export function objectsOverlap(a: DraggableObjectData, b: DraggableObjectData): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Resolve all collisions — push overlapping objects apart */
export function resolveCollisions(
  objects: DraggableObjectData[],
  movedId: string | null,
  width: number,
  height: number,
): DraggableObjectData[] {
  // Work on a mutable copy
  const result = objects.map((o) => ({ ...o }));

  for (let iter = 0; iter < COLLISION_ITERATIONS; iter++) {
    let anyCollision = false;

    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i];
        const b = result[j];

        if (!objectsOverlap(a, b)) continue;
        anyCollision = true;

        // Calculate overlap on each axis
        const overlapX = Math.min(a.x + a.width - b.x, b.x + b.width - a.x);
        const overlapY = Math.min(a.y + a.height - b.y, b.y + b.height - a.y);

        // Push apart along the axis with smallest overlap (minimum correction)
        const centerAx = a.x + a.width / 2;
        const centerBx = b.x + b.width / 2;
        const centerAy = a.y + a.height / 2;
        const centerBy = b.y + b.height / 2;

        if (overlapX < overlapY) {
          // Push horizontally
          const sign = centerAx < centerBx ? -1 : 1;
          if (a.id === movedId) {
            // The moved object stays, push the other
            b.x -= sign * overlapX;
          } else if (b.id === movedId) {
            a.x += sign * overlapX;
          } else {
            // Neither is being moved — split the push
            a.x += sign * (overlapX / 2);
            b.x -= sign * (overlapX / 2);
          }
        } else {
          // Push vertically
          const sign = centerAy < centerBy ? -1 : 1;
          if (a.id === movedId) {
            b.y -= sign * overlapY;
          } else if (b.id === movedId) {
            a.y += sign * overlapY;
          } else {
            a.y += sign * (overlapY / 2);
            b.y -= sign * (overlapY / 2);
          }
        }

        // Clamp to workspace bounds
        a.x = Math.max(0, Math.min(a.x, width - a.width));
        a.y = Math.max(0, Math.min(a.y, height - a.height));
        b.x = Math.max(0, Math.min(b.x, width - b.width));
        b.y = Math.max(0, Math.min(b.y, height - b.height));
      }
    }

    if (!anyCollision) break;
  }

  return result;
}
