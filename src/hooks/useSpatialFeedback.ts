import { useRef, useCallback } from 'react';
import { SPATIAL } from '../config';
import { generateSelector, scoreElement } from '../utils/spatial';
import type { SpatialElement, SpatialEvent, DragSpatialFeedback, ElementContact, ElementProximity } from '../types/spatial';
import type { UseDOMSpatialIndexReturn } from './useDOMSpatialIndex';
import type { UseHandOverDOMReturn } from './useHandOverDOM';

export interface UseSpatialFeedbackOptions {
  spatialIndex: UseDOMSpatialIndexReturn;
  handOverDOM: UseHandOverDOMReturn;
  snapThreshold?: number;
  proximityThreshold?: number;
}

export interface UseSpatialFeedbackReturn {
  feedbackRef: React.MutableRefObject<{
    left: DragSpatialFeedback | null;
    right: DragSpatialFeedback | null;
  }>;
  updateDragFeedback: (
    handedness: 'Left' | 'Right',
    draggedElement: Element,
    timestamp: number,
  ) => void;
  onFeedbackEvent: React.MutableRefObject<((event: SpatialEvent) => void) | null>;
  clearDrag: (handedness: 'Left' | 'Right') => void;
}

export function useSpatialFeedback(options: UseSpatialFeedbackOptions): UseSpatialFeedbackReturn {
  const {
    spatialIndex,
    snapThreshold = SPATIAL.SNAP_THRESHOLD,
    proximityThreshold = SPATIAL.PROXIMITY_THRESHOLD,
  } = options;

  const feedbackRef = useRef<{ left: DragSpatialFeedback | null; right: DragSpatialFeedback | null }>({
    left: null,
    right: null,
  });

  const onFeedbackEvent = useRef<((event: SpatialEvent) => void) | null>(null);

  // Track previous nearby targets for transition detection
  const prevNearbyRef = useRef<{
    left: Set<Element>;
    right: Set<Element>;
  }>({ left: new Set(), right: new Set() });

  const emit = useCallback((event: SpatialEvent) => {
    onFeedbackEvent.current?.(event);
  }, []);

  const makeSpatialElement = useCallback((el: Element): SpatialElement => {
    const rect = el.getBoundingClientRect();
    const score = scoreElement(el);
    return {
      element: el,
      tagName: el.tagName,
      selector: generateSelector(el),
      rect,
      area: rect.width * rect.height,
      relevanceScore: score,
      isInteractive: score >= SPATIAL.INTERACTIVE_SCORE_THRESHOLD,
    };
  }, []);

  const updateDragFeedback = useCallback((
    handedness: 'Left' | 'Right',
    draggedElement: Element,
    timestamp: number,
  ) => {
    const key = handedness === 'Left' ? 'left' : 'right';
    const draggedSpatial = makeSpatialElement(draggedElement);

    const contacts = spatialIndex.getContacts();
    const proximities = spatialIndex.getProximities(proximityThreshold);

    // Filter to only contacts/proximities involving the dragged element
    const relevantContacts: Array<{ target: SpatialElement; contact: ElementContact }> = [];
    const relevantProximities: Array<{ target: SpatialElement; proximity: ElementProximity }> = [];

    for (const c of contacts) {
      if (c.elementA.element === draggedElement) {
        relevantContacts.push({ target: c.elementB, contact: c });
      } else if (c.elementB.element === draggedElement) {
        relevantContacts.push({ target: c.elementA, contact: c });
      }
    }

    for (const p of proximities) {
      if (p.elementA.element === draggedElement) {
        relevantProximities.push({ target: p.elementB, proximity: p });
      } else if (p.elementB.element === draggedElement) {
        relevantProximities.push({ target: p.elementA, proximity: p });
      }
    }

    // Build nearby targets list
    const nearbyTargets = [
      ...relevantContacts.map(({ target, contact }) => ({
        target,
        proximity: null as ElementProximity | null,
        contact: contact as ElementContact | null,
        snapSuggestion: true, // already in contact
      })),
      ...relevantProximities.map(({ target, proximity }) => ({
        target,
        proximity: proximity as ElementProximity | null,
        contact: null as ElementContact | null,
        snapSuggestion: proximity.distance <= snapThreshold,
      })),
    ];

    // Detect transitions
    const currentNearby = new Set(nearbyTargets.map((n) => n.target.element));
    const prevNearby = prevNearbyRef.current[key];

    // New targets entering proximity
    for (const n of nearbyTargets) {
      if (!prevNearby.has(n.target.element)) {
        if (n.contact) {
          emit({
            type: 'element-contact',
            handedness,
            target: n.target.selector,
            detail: {
              overlapArea: n.contact.overlapArea,
              overlapRatioA: n.contact.overlapRatioA,
              overlapRatioB: n.contact.overlapRatioB,
            },
            timestamp,
          });
        } else if (n.proximity) {
          emit({
            type: 'proximity-alert',
            handedness,
            target: n.target.selector,
            detail: {
              distance: n.proximity.distance,
              axis: n.proximity.axis,
            },
            timestamp,
          });
        }
        if (n.snapSuggestion) {
          emit({
            type: 'drag-snap',
            handedness,
            target: n.target.selector,
            detail: {
              distance: n.contact ? 0 : n.proximity?.distance ?? 0,
            },
            timestamp,
          });
        }
      }
    }

    // Targets leaving proximity
    for (const el of prevNearby) {
      if (!currentNearby.has(el)) {
        emit({
          type: 'element-separate',
          handedness,
          target: generateSelector(el),
          detail: {},
          timestamp,
        });
      }
    }

    prevNearbyRef.current[key] = currentNearby;
    feedbackRef.current[key] = { draggedElement: draggedSpatial, nearbyTargets };
  }, [spatialIndex, proximityThreshold, snapThreshold, makeSpatialElement, emit]);

  const clearDrag = useCallback((handedness: 'Left' | 'Right') => {
    const key = handedness === 'Left' ? 'left' : 'right';
    feedbackRef.current[key] = null;
    prevNearbyRef.current[key] = new Set();
  }, []);

  return { feedbackRef, updateDragFeedback, onFeedbackEvent, clearDrag };
}
