import { useRef, useCallback } from 'react';
import { SPATIAL } from '../config';
import { filterAndScoreStack, computeContact, computeProximity } from '../utils/spatial';
import type { SpatialElement, SpatialStack, ElementContact, ElementProximity } from '../types/spatial';

interface SpatialIndexState {
  registry: Map<Element, SpatialElement>;
  lastSeen: Map<Element, number>;
  contacts: ElementContact[];
  proximities: ElementProximity[];
  frameCount: number;
}

export interface UseDOMSpatialIndexReturn {
  queryPoint: (x: number, y: number) => SpatialStack;
  updateRects: () => void;
  getContacts: () => ElementContact[];
  getProximities: (maxDistance: number) => ElementProximity[];
  getTrackedElements: () => SpatialElement[];
  indexRef: React.MutableRefObject<SpatialIndexState>;
}

export function useDOMSpatialIndex(): UseDOMSpatialIndexReturn {
  const stateRef = useRef<SpatialIndexState>({
    registry: new Map(),
    lastSeen: new Map(),
    contacts: [],
    proximities: [],
    frameCount: 0,
  });

  const lastRectUpdateRef = useRef(0);

  // Hot path (30fps): query DOM elements under a point
  const queryPoint = useCallback((x: number, y: number): SpatialStack => {
    const state = stateRef.current;
    state.frameCount++;
    const now = performance.now();

    const rawElements = document.elementsFromPoint(x, y);
    const scored = filterAndScoreStack(rawElements);

    // Register all discovered elements and update lastSeen
    for (const spatial of scored) {
      state.registry.set(spatial.element, spatial);
      state.lastSeen.set(spatial.element, state.frameCount);
    }

    // LRU eviction: remove elements not seen for EVICTION_FRAMES
    if (state.frameCount % SPATIAL.EVICTION_FRAMES === 0) {
      const cutoff = state.frameCount - SPATIAL.EVICTION_FRAMES;
      const toEvict: Element[] = [];
      for (const [el, frame] of state.lastSeen) {
        if (frame < cutoff) toEvict.push(el);
      }
      for (const el of toEvict) {
        state.registry.delete(el);
        state.lastSeen.delete(el);
      }
    }

    return {
      point: { x, y },
      topElement: scored.length > 0 ? scored[0] : null,
      elements: scored,
      timestamp: now,
    };
  }, []);

  // Warm path (10fps): update bounding rects + compute contacts/proximities
  const updateRects = useCallback(() => {
    const now = performance.now();
    if (now - lastRectUpdateRef.current < SPATIAL.RECT_UPDATE_INTERVAL_MS) return;
    lastRectUpdateRef.current = now;

    const state = stateRef.current;

    // Auto-discover trackable elements (draggable objects, panels, etc.)
    // This ensures proximity/contact detection works between all relevant elements,
    // not just those the hand has directly hovered over.
    const trackables = document.querySelectorAll('[data-object-id], [data-trackable]');
    for (const el of trackables) {
      if (!state.registry.has(el)) {
        const rect = el.getBoundingClientRect();
        const score = 1; // base score for discovered-by-selector elements
        state.registry.set(el, {
          element: el,
          tagName: el.tagName,
          selector: el.getAttribute('data-object-id')
            ? `[data-object-id="${CSS.escape(el.getAttribute('data-object-id')!)}"]`
            : el.tagName.toLowerCase(),
          rect,
          area: rect.width * rect.height,
          relevanceScore: score,
          isInteractive: false,
        });
      }
      state.lastSeen.set(el, state.frameCount);
    }

    // Batch update rects for all tracked elements
    const disconnected: Element[] = [];
    for (const [el, spatial] of state.registry) {
      if (!el.isConnected) {
        disconnected.push(el);
        continue;
      }
      const rect = el.getBoundingClientRect();
      spatial.rect = rect;
      spatial.area = rect.width * rect.height;
    }
    for (const el of disconnected) {
      state.registry.delete(el);
      state.lastSeen.delete(el);
    }

    // Compute contacts and proximities only between trackable elements
    const trackable = Array.from(state.registry.values()).filter((el) =>
      el.element.hasAttribute('data-object-id') || el.element.hasAttribute('data-trackable')
    );
    const contacts: ElementContact[] = [];
    const proximities: ElementProximity[] = [];

    for (let i = 0; i < trackable.length; i++) {
      for (let j = i + 1; j < trackable.length; j++) {
        const a = trackable[i];
        const b = trackable[j];

        const contact = computeContact(a.rect, a.area, b.rect, b.area);
        if (contact) {
          contacts.push({ ...contact, elementA: a, elementB: b });
          continue;
        }

        const prox = computeProximity(a.rect, b.rect, SPATIAL.PROXIMITY_THRESHOLD);
        if (prox) {
          proximities.push({ ...prox, elementA: a, elementB: b });
        }
      }
    }

    state.contacts = contacts;
    state.proximities = proximities;
  }, []);

  const getContacts = useCallback((): ElementContact[] => {
    return stateRef.current.contacts;
  }, []);

  const getProximities = useCallback((maxDistance: number): ElementProximity[] => {
    return stateRef.current.proximities.filter((p) => p.distance <= maxDistance);
  }, []);

  const getTrackedElements = useCallback((): SpatialElement[] => {
    return Array.from(stateRef.current.registry.values());
  }, []);

  return {
    queryPoint,
    updateRects,
    getContacts,
    getProximities,
    getTrackedElements,
    indexRef: stateRef,
  };
}
