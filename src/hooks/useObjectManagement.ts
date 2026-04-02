import { useState, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { DraggableObjectData, Position } from '../types';
import { COLORS } from '../types';
import { hitTest as aabbHitTest } from '../utils/geometry';

const OBJECT_SIZE = 80;
const MAX_OBJECTS = 20;
const ADD_DEBOUNCE_MS = 500;
const COLLISION_ITERATIONS = 3; // resolve passes per frame

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createObject(position: Position): DraggableObjectData {
  const color = COLORS[randomInt(0, COLORS.length - 1)];
  return {
    id: uuidv4(),
    x: position.x,
    y: position.y,
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
    color,
  };
}

/** Check if two AABBs overlap */
function objectsOverlap(a: DraggableObjectData, b: DraggableObjectData): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Resolve all collisions — push overlapping objects apart */
function resolveCollisions(
  objects: DraggableObjectData[],
  movedId: string | null,
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
        a.x = Math.max(0, Math.min(a.x, window.innerWidth - a.width));
        a.y = Math.max(0, Math.min(a.y, window.innerHeight - a.height));
        b.x = Math.max(0, Math.min(b.x, window.innerWidth - b.width));
        b.y = Math.max(0, Math.min(b.y, window.innerHeight - b.height));
      }
    }

    if (!anyCollision) break;
  }

  return result;
}

function randomNonOverlappingPosition(existing: DraggableObjectData[]): Position {
  for (let attempt = 0; attempt < 50; attempt++) {
    const pos = {
      x: randomInt(0, window.innerWidth - OBJECT_SIZE),
      y: randomInt(0, window.innerHeight - OBJECT_SIZE),
    };
    const candidate = { ...pos, width: OBJECT_SIZE, height: OBJECT_SIZE, id: '', color: '' };
    const collides = existing.some((obj) => objectsOverlap(candidate as DraggableObjectData, obj));
    if (!collides) return pos;
  }
  // Fallback — just place it somewhere
  return {
    x: randomInt(0, window.innerWidth - OBJECT_SIZE),
    y: randomInt(0, window.innerHeight - OBJECT_SIZE),
  };
}

function buildInitialObjects(count: number): DraggableObjectData[] {
  const objects: DraggableObjectData[] = [];
  for (let i = 0; i < count; i++) {
    const pos = randomNonOverlappingPosition(objects);
    objects.push(createObject(pos));
  }
  return objects;
}

export interface ObjectManagementResult {
  objects: DraggableObjectData[];
  addObject: (position: Position) => void;
  removeObject: (id: string) => void;
  moveObject: (id: string, position: Position) => void;
  hitTest: (cursor: Position) => string | null;
  clearAll: () => void;
}

export function useObjectManagement(initialCount = 4): ObjectManagementResult {
  const [objects, setObjects] = useState<DraggableObjectData[]>(() =>
    buildInitialObjects(initialCount),
  );

  const lastAddTimeRef = useRef<number>(0);

  const addObject = useCallback((position: Position) => {
    const now = Date.now();
    if (now - lastAddTimeRef.current < ADD_DEBOUNCE_MS) return;
    lastAddTimeRef.current = now;

    setObjects((prev) => {
      if (prev.length >= MAX_OBJECTS) return prev;
      const newObj = createObject(position);
      return resolveCollisions([...prev, newObj], newObj.id);
    });
  }, []);

  const removeObject = useCallback((id: string) => {
    setObjects((prev) => prev.filter((obj) => obj.id !== id));
  }, []);

  const moveObject = useCallback((id: string, position: Position) => {
    setObjects((prev) => {
      const updated = prev.map((obj) => {
        if (obj.id !== id) return obj;
        // Clamp to screen bounds
        const x = Math.max(0, Math.min(position.x, window.innerWidth - obj.width));
        const y = Math.max(0, Math.min(position.y, window.innerHeight - obj.height));
        return { ...obj, x, y };
      });
      return resolveCollisions(updated, id);
    });
  }, []);

  const hitTest = useCallback(
    (cursor: Position): string | null => {
      for (let i = objects.length - 1; i >= 0; i--) {
        const obj = objects[i];
        if (aabbHitTest(cursor, obj)) {
          return obj.id;
        }
      }
      return null;
    },
    [objects],
  );

  const clearAll = useCallback(() => {
    setObjects([]);
  }, []);

  return { objects, addObject, removeObject, moveObject, hitTest, clearAll };
}
