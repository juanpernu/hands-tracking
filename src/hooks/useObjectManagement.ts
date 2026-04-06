import { useState, useRef, useCallback } from 'react';
import type { DraggableObjectData, Position } from '../types';
import { COLORS } from '../types';
import { hitTest as aabbHitTest } from '../utils/geometry';
import { objectsOverlap, resolveCollisions } from '../utils/collision';
import { OBJECTS, SPATIAL } from '../config';

// --- Momentum / Physics ---
interface ObjectMomentum {
  vx: number;
  vy: number;
  lastMoveX: number;
  lastMoveY: number;
  lastMoveTime: number;
}

const FRICTION = 0.92;           // velocity multiplier per frame (1 = no friction)
const MIN_VELOCITY = 0.5;       // px/frame below which momentum stops
const MOMENTUM_MULTIPLIER = 0.8; // scale release velocity

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
  releaseObject: (id: string) => void;
  applyMomentum: () => void;
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
  const momentumRef = useRef<Map<string, ObjectMomentum>>(new Map());

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
    // Track velocity for momentum on release
    const now = performance.now();
    const mom = momentumRef.current.get(id);
    if (mom) {
      const dt = now - mom.lastMoveTime;
      if (dt > 0 && dt < 100) { // ignore stale deltas
        mom.vx = (position.x - mom.lastMoveX) / dt * 16; // normalize to ~60fps frame
        mom.vy = (position.y - mom.lastMoveY) / dt * 16;
      }
      mom.lastMoveX = position.x;
      mom.lastMoveY = position.y;
      mom.lastMoveTime = now;
    } else {
      momentumRef.current.set(id, { vx: 0, vy: 0, lastMoveX: position.x, lastMoveY: position.y, lastMoveTime: now });
    }

    setObjects((prev) => {
      const updated = prev.map((obj) => {
        if (obj.id !== id) return obj;
        let x = Math.max(0, Math.min(position.x, window.innerWidth - obj.width));
        let y = Math.max(0, Math.min(position.y, window.innerHeight - obj.height));

        // Find the closest snap candidate across all objects
        const snap = SPATIAL.SNAP_THRESHOLD;
        let bestSnapX: number | null = null;
        let bestSnapDistX = snap;
        let bestSnapY: number | null = null;
        let bestSnapDistY = snap;
        let snapTargetId: string | null = null;

        for (const other of prev) {
          if (other.id === id) continue;

          // Check all X edge alignments
          const xCandidates = [
            { snappedX: other.x, dist: Math.abs(x - other.x) },                                    // left-to-left
            { snappedX: other.x + other.width, dist: Math.abs(x - (other.x + other.width)) },       // left-to-right
            { snappedX: other.x - obj.width, dist: Math.abs((x + obj.width) - other.x) },           // right-to-left
            { snappedX: other.x + other.width - obj.width, dist: Math.abs((x + obj.width) - (other.x + other.width)) }, // right-to-right
          ];

          for (const c of xCandidates) {
            if (c.dist < bestSnapDistX) {
              bestSnapDistX = c.dist;
              bestSnapX = c.snappedX;
              snapTargetId = other.id;
            }
          }

          // Check all Y edge alignments
          const yCandidates = [
            { snappedY: other.y, dist: Math.abs(y - other.y) },
            { snappedY: other.y + other.height, dist: Math.abs(y - (other.y + other.height)) },
            { snappedY: other.y - obj.height, dist: Math.abs((y + obj.height) - other.y) },
            { snappedY: other.y + other.height - obj.height, dist: Math.abs((y + obj.height) - (other.y + other.height)) },
          ];

          for (const c of yCandidates) {
            if (c.dist < bestSnapDistY) {
              bestSnapDistY = c.dist;
              bestSnapY = c.snappedY;
              if (!snapTargetId) snapTargetId = other.id;
            }
          }
        }

        // Apply snap only if it doesn't cause overlap with the snap target
        if (bestSnapX !== null) {
          const snappedObj = { ...obj, x: bestSnapX, y };
          const target = prev.find((o) => o.id === snapTargetId);
          if (!target || !objectsOverlap(snappedObj as DraggableObjectData, target)) {
            x = bestSnapX;
          }
        }
        if (bestSnapY !== null) {
          const snappedObj = { ...obj, x, y: bestSnapY };
          const target = prev.find((o) => o.id === snapTargetId);
          if (!target || !objectsOverlap(snappedObj as DraggableObjectData, target)) {
            y = bestSnapY;
          }
        }

        return { ...obj, x, y };
      });
      return resolveCollisions(updated, id, window.innerWidth, window.innerHeight);
    });
  }, []);

  // Release an object — start momentum animation
  const releaseObject = useCallback((id: string) => {
    const mom = momentumRef.current.get(id);
    if (!mom) return;

    let vx = mom.vx * MOMENTUM_MULTIPLIER;
    let vy = mom.vy * MOMENTUM_MULTIPLIER;

    // Clear the tracking entry (prevent re-triggering)
    momentumRef.current.delete(id);

    // Skip if velocity is too low
    if (Math.sqrt(vx * vx + vy * vy) < MIN_VELOCITY) return;

    // Self-contained RAF animation loop
    function animate() {
      const speed = Math.sqrt(vx * vx + vy * vy);
      if (speed < MIN_VELOCITY) return; // stop animation

      vx *= FRICTION;
      vy *= FRICTION;

      setObjects((prev) => {
        const obj = prev.find((o) => o.id === id);
        if (!obj) return prev;

        let newX = obj.x + vx;
        let newY = obj.y + vy;

        // Bounce off edges
        if (newX <= 0) { newX = 0; vx *= -0.5; }
        if (newX >= window.innerWidth - obj.width) { newX = window.innerWidth - obj.width; vx *= -0.5; }
        if (newY <= 0) { newY = 0; vy *= -0.5; }
        if (newY >= window.innerHeight - obj.height) { newY = window.innerHeight - obj.height; vy *= -0.5; }

        const updated = prev.map((o) => o.id === id ? { ...o, x: newX, y: newY } : o);
        return resolveCollisions(updated, id, window.innerWidth, window.innerHeight);
      });

      requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
  }, []);

  // No-op — momentum is now self-animated via releaseObject's RAF loop
  const applyMomentum = useCallback(() => {}, []);

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

  return { objects, addObject, removeObject, moveObject, releaseObject, applyMomentum, hitTest, clearAll };
}
