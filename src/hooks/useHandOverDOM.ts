import { useRef, useCallback } from 'react';
import { SPATIAL } from '../config';
import type { HandSpatialState, SpatialEvent, SpatialElement } from '../types/spatial';
import type { UseDOMSpatialIndexReturn } from './useDOMSpatialIndex';

export interface UseHandOverDOMOptions {
  spatialIndex: UseDOMSpatialIndexReturn;
  hoverEventIntervalMs?: number;
}

export interface UseHandOverDOMReturn {
  handSpatialRef: React.MutableRefObject<{
    left: HandSpatialState | null;
    right: HandSpatialState | null;
  }>;
  updateHandPosition: (
    handedness: 'Left' | 'Right',
    pixelX: number,
    pixelY: number,
    timestamp: number,
  ) => void;
  onSpatialEvent: React.MutableRefObject<((event: SpatialEvent) => void) | null>;
  clearHand: (handedness: 'Left' | 'Right') => void;
}

// Module level — zero closure dependency
function areSameElement(a: SpatialElement | null, b: SpatialElement | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.element === b.element;
}

export function useHandOverDOM(options: UseHandOverDOMOptions): UseHandOverDOMReturn {
  const { spatialIndex, hoverEventIntervalMs = SPATIAL.HOVER_EVENT_INTERVAL_MS } = options;

  const handSpatialRef = useRef<{ left: HandSpatialState | null; right: HandSpatialState | null }>({
    left: null,
    right: null,
  });

  const onSpatialEvent = useRef<((event: SpatialEvent) => void) | null>(null);
  const lastHoverEventRef = useRef<{ left: number; right: number }>({ left: 0, right: 0 });

  const emit = useCallback((event: SpatialEvent) => {
    onSpatialEvent.current?.(event);
  }, []);

  const updateHandPosition = useCallback((
    handedness: 'Left' | 'Right',
    pixelX: number,
    pixelY: number,
    timestamp: number,
  ) => {
    const key = handedness === 'Left' ? 'left' : 'right';
    const stack = spatialIndex.queryPoint(pixelX, pixelY);
    const newTarget = stack.topElement;
    const current = handSpatialRef.current[key];
    const previousTarget = current?.hoverTarget ?? null;

    // Detect enter/leave transitions
    if (!areSameElement(previousTarget, newTarget)) {
      // Leave previous
      if (previousTarget) {
        emit({
          type: 'hand-leave-element',
          handedness,
          target: previousTarget.selector,
          detail: {
            hoverDurationMs: current?.hoverDurationMs ?? 0,
            score: previousTarget.relevanceScore,
          },
          timestamp,
        });
      }

      // Enter new
      if (newTarget) {
        emit({
          type: 'hand-enter-element',
          handedness,
          target: newTarget.selector,
          detail: {
            score: newTarget.relevanceScore,
            isInteractive: newTarget.isInteractive,
            tagName: newTarget.tagName,
          },
          timestamp,
        });
      }

      // Reset hover duration
      handSpatialRef.current[key] = {
        handedness,
        stack,
        hoverTarget: newTarget,
        hoverDurationMs: 0,
        isOverInteractive: newTarget?.isInteractive ?? false,
        previousTarget,
        lastUpdateTimestamp: timestamp,
      };
    } else {
      // Same target — accumulate hover duration
      const prevDuration = current?.hoverDurationMs ?? 0;
      const deltaMs = current ? timestamp - current.lastUpdateTimestamp! : 0;
      const newDuration = prevDuration + Math.max(0, deltaMs);

      handSpatialRef.current[key] = {
        handedness,
        stack,
        hoverTarget: newTarget,
        hoverDurationMs: newDuration,
        isOverInteractive: newTarget?.isInteractive ?? false,
        previousTarget: current?.previousTarget ?? null,
        lastUpdateTimestamp: timestamp,
      };

      // Periodic hover events
      if (newTarget && timestamp - lastHoverEventRef.current[key] >= hoverEventIntervalMs) {
        lastHoverEventRef.current[key] = timestamp;
        emit({
          type: 'hand-hover',
          handedness,
          target: newTarget.selector,
          detail: {
            hoverDurationMs: newDuration,
            isInteractive: newTarget.isInteractive,
          },
          timestamp,
        });
      }
    }
  }, [spatialIndex, hoverEventIntervalMs, emit]);

  const clearHand = useCallback((handedness: 'Left' | 'Right') => {
    const key = handedness === 'Left' ? 'left' : 'right';
    const current = handSpatialRef.current[key];
    if (current?.hoverTarget) {
      emit({
        type: 'hand-leave-element',
        handedness,
        target: current.hoverTarget.selector,
        detail: { hoverDurationMs: current.hoverDurationMs, reason: 'hand-lost' },
        timestamp: performance.now(),
      });
    }
    handSpatialRef.current[key] = null;
  }, [emit]);

  return { handSpatialRef, updateHandPosition, onSpatialEvent, clearHand };
}
