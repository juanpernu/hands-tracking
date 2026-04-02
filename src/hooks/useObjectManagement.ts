import { useState, useRef, useCallback } from 'react';
import type { DraggableObjectData, Position } from '../types';
import { COLORS } from '../types';
import { hitTest as aabbHitTest } from '../utils/geometry';
import { objectsOverlap, resolveCollisions } from '../utils/collision';
import { OBJECTS, SPATIAL } from '../config';

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function createObject(position: Position): DraggableObjectData {
  const color = COLORS[randomInt(0, COLORS.length - 1)];
  return {
    id: generateId(),
    x: position.x,
    y: position.y,
    width: OBJECTS.SIZE,
    height: OBJECTS.SIZE,
    color,
  };
}

function randomNonOverlappingPosition(existing: DraggableObjectData[]): Position {
  for (let attempt = 0; attempt < OBJECTS.COLLISION_FIND_ATTEMPTS; attempt++) {
    const pos = {
      x: randomInt(0, window.innerWidth - OBJECTS.SIZE),
      y: randomInt(0, window.innerHeight - OBJECTS.SIZE),
    };
    const candidate = { ...pos, width: OBJECTS.SIZE, height: OBJECTS.SIZE, id: '', color: '' };
    const collides = existing.some((obj) => objectsOverlap(candidate as DraggableObjectData, obj));
    if (!collides) return pos;
  }
  // Fallback — just place it somewhere
  return {
    x: randomInt(0, window.innerWidth - OBJECTS.SIZE),
    y: randomInt(0, window.innerHeight - OBJECTS.SIZE),
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

  // Keep a ref in sync with state so hitTest/moveObject callbacks can read
  // the latest objects without going stale or listing `objects` as a dep.
  const objectsRef = useRef<DraggableObjectData[]>(objects);
  objectsRef.current = objects;

  const lastAddTimeRef = useRef<number>(0);

  const addObject = useCallback((position: Position) => {
    const now = Date.now();
    if (now - lastAddTimeRef.current < OBJECTS.ADD_DEBOUNCE_MS) return;
    lastAddTimeRef.current = now;

    setObjects((prev) => {
      if (prev.length >= OBJECTS.MAX_COUNT) return prev;
      const newObj = createObject(position);
      return resolveCollisions([...prev, newObj], newObj.id, window.innerWidth, window.innerHeight);
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
        let x = Math.max(0, Math.min(position.x, window.innerWidth - obj.width));
        let y = Math.max(0, Math.min(position.y, window.innerHeight - obj.height));

        // Snap to nearby objects when within threshold
        const snap = SPATIAL.SNAP_THRESHOLD;
        for (const other of prev) {
          if (other.id === id) continue;
          // Snap left edge to left edge
          if (Math.abs(x - other.x) < snap) x = other.x;
          // Snap left edge to right edge
          else if (Math.abs(x - (other.x + other.width)) < snap) x = other.x + other.width;
          // Snap right edge to left edge
          else if (Math.abs((x + obj.width) - other.x) < snap) x = other.x - obj.width;
          // Snap right edge to right edge
          else if (Math.abs((x + obj.width) - (other.x + other.width)) < snap) x = other.x + other.width - obj.width;

          // Snap top edge to top edge
          if (Math.abs(y - other.y) < snap) y = other.y;
          // Snap top edge to bottom edge
          else if (Math.abs(y - (other.y + other.height)) < snap) y = other.y + other.height;
          // Snap bottom edge to top edge
          else if (Math.abs((y + obj.height) - other.y) < snap) y = other.y - obj.height;
          // Snap bottom edge to bottom edge
          else if (Math.abs((y + obj.height) - (other.y + other.height)) < snap) y = other.y + other.height - obj.height;
        }

        return { ...obj, x, y };
      });
      return resolveCollisions(updated, id, window.innerWidth, window.innerHeight);
    });
  }, []);

  // Reads from objectsRef so the callback is stable (never needs to be recreated)
  const hitTest = useCallback(
    (cursor: Position): string | null => {
      const objs = objectsRef.current;
      for (let i = objs.length - 1; i >= 0; i--) {
        const obj = objs[i];
        if (aabbHitTest(cursor, obj)) {
          return obj.id;
        }
      }
      return null;
    },
    // objectsRef is a stable ref — no deps needed
    [],
  );

  const clearAll = useCallback(() => {
    setObjects([]);
  }, []);

  return { objects, addObject, removeObject, moveObject, hitTest, clearAll };
}
