import { useRef, useCallback } from 'react';
import type { DraggableObjectData } from '../types';

export interface TrackedObject {
  id: string;
  type: 'cube' | 'panel';
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  velocityX: number;  // px/frame
  velocityY: number;
  speed: number;       // px/frame magnitude
  isGrabbed: boolean;
  grabbedBy: 'Left' | 'Right' | 'mouse' | null;
  grabStartTime: number;
  totalDistance: number;  // cumulative px moved during this grab
}

export interface ObjectTrackerResult {
  tracked: TrackedObject[];
  update: (
    objects: DraggableObjectData[],
    grabbedIdRight: string | null,
    grabbedIdLeft: string | null,
  ) => TrackedObject[];
  getMovingObjects: () => TrackedObject[];
  getGrabbedObjects: () => TrackedObject[];
}

export function useObjectTracker(): ObjectTrackerResult {
  const trackedRef = useRef<Map<string, TrackedObject>>(new Map());
  const resultRef = useRef<TrackedObject[]>([]);

  const update = useCallback((
    objects: DraggableObjectData[],
    grabbedIdRight: string | null,
    grabbedIdLeft: string | null,
  ): TrackedObject[] => {
    const map = trackedRef.current;
    const now = performance.now();

    // Remove objects that no longer exist
    for (const id of map.keys()) {
      if (!objects.find((o) => o.id === id)) {
        map.delete(id);
      }
    }

    // Update or create tracked objects
    for (const obj of objects) {
      const existing = map.get(obj.id);
      const isGrabbed = obj.id === grabbedIdRight || obj.id === grabbedIdLeft;
      const grabbedBy = obj.id === grabbedIdRight ? 'Right' as const
        : obj.id === grabbedIdLeft ? 'Left' as const
        : null;

      if (existing) {
        const dx = obj.x - existing.x;
        const dy = obj.y - existing.y;
        const speed = Math.sqrt(dx * dx + dy * dy);

        existing.prevX = existing.x;
        existing.prevY = existing.y;
        existing.x = obj.x;
        existing.y = obj.y;
        existing.velocityX = dx;
        existing.velocityY = dy;
        existing.speed = speed;

        // Track grab state transitions
        if (isGrabbed && !existing.isGrabbed) {
          // Just grabbed
          existing.grabStartTime = now;
          existing.totalDistance = 0;
        }
        if (!isGrabbed && existing.isGrabbed) {
          // Just released — mark with negative totalDistance to signal one-time release
          existing.totalDistance = -(existing.totalDistance || 1);
        }
        if (isGrabbed) {
          existing.totalDistance += speed;
        }

        existing.isGrabbed = isGrabbed;
        existing.grabbedBy = grabbedBy;
      } else {
        map.set(obj.id, {
          id: obj.id,
          type: 'cube',
          x: obj.x,
          y: obj.y,
          prevX: obj.x,
          prevY: obj.y,
          velocityX: 0,
          velocityY: 0,
          speed: 0,
          isGrabbed,
          grabbedBy,
          grabStartTime: isGrabbed ? now : 0,
          totalDistance: 0,
        });
      }
    }

    resultRef.current = Array.from(map.values());
    return resultRef.current;
  }, []);

  const getMovingObjects = useCallback((): TrackedObject[] => {
    return resultRef.current.filter((t) => t.speed > 1);
  }, []);

  const getGrabbedObjects = useCallback((): TrackedObject[] => {
    return resultRef.current.filter((t) => t.isGrabbed);
  }, []);

  return {
    tracked: resultRef.current,
    update,
    getMovingObjects,
    getGrabbedObjects,
  };
}
