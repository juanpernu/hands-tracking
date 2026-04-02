import { useState, useRef, useCallback } from 'react';
import type { DraggableObjectData, Position } from '../types';
import { COLORS } from '../types';
import { hitTest as aabbHitTest } from '../utils/geometry';
import { objectsOverlap, resolveCollisions } from '../utils/collision';

const OBJECT_SIZE = 80;
const MAX_OBJECTS = 20;
const ADD_DEBOUNCE_MS = 500;

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createObject(position: Position): DraggableObjectData {
  const color = COLORS[randomInt(0, COLORS.length - 1)];
  return {
    id: crypto.randomUUID(),
    x: position.x,
    y: position.y,
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
    color,
  };
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

  // Keep a ref in sync with state so hitTest/moveObject callbacks can read
  // the latest objects without going stale or listing `objects` as a dep.
  const objectsRef = useRef<DraggableObjectData[]>(objects);
  objectsRef.current = objects;

  const lastAddTimeRef = useRef<number>(0);

  const addObject = useCallback((position: Position) => {
    const now = Date.now();
    if (now - lastAddTimeRef.current < ADD_DEBOUNCE_MS) return;
    lastAddTimeRef.current = now;

    setObjects((prev) => {
      if (prev.length >= MAX_OBJECTS) return prev;
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
        const x = Math.max(0, Math.min(position.x, window.innerWidth - obj.width));
        const y = Math.max(0, Math.min(position.y, window.innerHeight - obj.height));
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
