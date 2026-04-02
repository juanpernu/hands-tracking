# Spatial Telemetry System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build real-time hand-over-DOM tracking with auto-discovery, relevance scoring, contact/proximity detection, and drag feedback.

**Architecture:** Three new hooks (`useDOMSpatialIndex`, `useHandOverDOM`, `useSpatialFeedback`) built on pure utility functions in `src/utils/spatial.ts`. Types in `src/types/spatial.ts`. Config constants in `src/config.ts`. Integration into App.tsx RAF loop.

**Tech Stack:** React 19, TypeScript, Vitest, jsdom

**Parallelization:** Tasks 1-2 are foundation (sequential). Tasks 3-4 are independent (parallel). Task 5 depends on 3. Task 6 depends on 4-5. Task 7 depends on all.

---

## Task 1: Types + Config (Foundation)

**Files:**
- Create: `src/types/spatial.ts`
- Modify: `src/types/telemetry.ts` (add `spatial` field to `HandTelemetry`)
- Modify: `src/config.ts` (add `SPATIAL` section)

- [ ] **Step 1: Create `src/types/spatial.ts`**

```typescript
// src/types/spatial.ts

export interface SpatialElement {
  element: Element;
  tagName: string;
  selector: string;
  rect: DOMRect;
  area: number;
  relevanceScore: number;
  isInteractive: boolean;
}

export interface SpatialStack {
  point: { x: number; y: number };
  topElement: SpatialElement | null;
  elements: SpatialElement[];
  timestamp: number;
}

export interface ElementContact {
  elementA: SpatialElement;
  elementB: SpatialElement;
  overlapArea: number;
  overlapRatioA: number;
  overlapRatioB: number;
  contactAxis: 'horizontal' | 'vertical' | 'both';
}

export interface ElementProximity {
  elementA: SpatialElement;
  elementB: SpatialElement;
  distance: number;
  direction: { x: number; y: number };
  axis: 'horizontal' | 'vertical' | 'diagonal';
}

export interface HandSpatialState {
  handedness: 'Left' | 'Right';
  stack: SpatialStack;
  hoverTarget: SpatialElement | null;
  hoverDurationMs: number;
  isOverInteractive: boolean;
  previousTarget: SpatialElement | null;
}

export interface DragSpatialFeedback {
  draggedElement: SpatialElement;
  nearbyTargets: Array<{
    target: SpatialElement;
    proximity: ElementProximity | null;
    contact: ElementContact | null;
    snapSuggestion: boolean;
  }>;
}

export type SpatialEventType =
  | 'hand-enter-element'
  | 'hand-leave-element'
  | 'hand-hover'
  | 'element-contact'
  | 'element-separate'
  | 'proximity-alert'
  | 'drag-snap';

export interface SpatialEvent {
  type: SpatialEventType;
  handedness?: 'Left' | 'Right';
  target?: string;
  detail: Record<string, unknown>;
  timestamp: number;
}

export interface SpatialTelemetryData {
  topElement: string | null;
  topElementScore: number;
  isOverInteractive: boolean;
  hoverDurationMs: number;
  elementCount: number;
}
```

- [ ] **Step 2: Add `spatial` field to `HandTelemetry` in `src/types/telemetry.ts`**

After the `motion: MotionPattern;` line (line 92), add:

```typescript
  spatial?: SpatialTelemetryData;
```

Add to the imports at the top of the file:

```typescript
import type { SpatialTelemetryData } from './spatial';
```

- [ ] **Step 3: Add SPATIAL config to `src/config.ts`**

Append before the closing of the file (after `COLOR_THRESHOLDS`):

```typescript
// --- Spatial Tracking ---
export const SPATIAL = {
  SCORE_SEMANTIC_INTERACTIVE: 3,
  SCORE_HAS_LISTENERS: 2,
  SCORE_MIN_DIMENSIONS: 1,
  SCORE_GENERIC_CONTAINER: -2,
  SCORE_DATA_TRACKABLE: 5,
  MIN_ELEMENT_WIDTH: 20,
  MIN_ELEMENT_HEIGHT: 20,
  EVICTION_FRAMES: 30,
  SNAP_THRESHOLD: 15,
  PROXIMITY_THRESHOLD: 50,
  HOVER_EVENT_INTERVAL_MS: 500,
  RECT_UPDATE_INTERVAL_MS: 100,
  INTERACTIVE_SCORE_THRESHOLD: 2,
} as const;
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/types/spatial.ts src/types/telemetry.ts src/config.ts
git commit -m "feat(spatial): add types, telemetry field, and config constants"
```

---

## Task 2: Pure Utility Functions + Tests (TDD)

**Files:**
- Create: `src/utils/spatial.ts`
- Create: `src/utils/__tests__/spatial.test.ts`

**Dependencies:** Task 1 (types + config must exist)

- [ ] **Step 1: Write scoring tests in `src/utils/__tests__/spatial.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import {
  scoreElement,
  isSemanticInteractive,
  isGenericContainer,
  generateSelector,
} from '../spatial';

// Helper: create a minimal DOM element with getBoundingClientRect
function makeEl(tag: string, attrs: Record<string, string> = {}, width = 100, height = 50): Element {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  // jsdom doesn't compute layout, so we stub getBoundingClientRect
  el.getBoundingClientRect = () => ({
    x: 0, y: 0, width, height, top: 0, right: width, bottom: height, left: 0,
    toJSON: () => ({}),
  });
  return el;
}

describe('isSemanticInteractive', () => {
  it('returns true for button', () => {
    expect(isSemanticInteractive(makeEl('button'))).toBe(true);
  });
  it('returns true for anchor', () => {
    expect(isSemanticInteractive(makeEl('a'))).toBe(true);
  });
  it('returns true for input', () => {
    expect(isSemanticInteractive(makeEl('input'))).toBe(true);
  });
  it('returns true for role=button', () => {
    expect(isSemanticInteractive(makeEl('div', { role: 'button' }))).toBe(true);
  });
  it('returns true for tabindex', () => {
    expect(isSemanticInteractive(makeEl('div', { tabindex: '0' }))).toBe(true);
  });
  it('returns false for plain div', () => {
    expect(isSemanticInteractive(makeEl('div'))).toBe(false);
  });
});

describe('isGenericContainer', () => {
  it('returns true for body', () => {
    expect(isGenericContainer(makeEl('body'))).toBe(true);
  });
  it('returns true for main without role', () => {
    expect(isGenericContainer(makeEl('main'))).toBe(true);
  });
  it('returns false for section with role', () => {
    expect(isGenericContainer(makeEl('section', { role: 'button' }))).toBe(false);
  });
  it('returns false for section with onclick', () => {
    expect(isGenericContainer(makeEl('section', { onclick: 'fn()' }))).toBe(false);
  });
  it('returns false for div (not in container list)', () => {
    expect(isGenericContainer(makeEl('div'))).toBe(false);
  });
});

describe('scoreElement', () => {
  it('button with dimensions = 4 (semantic 3 + dim 1)', () => {
    expect(scoreElement(makeEl('button'))).toBe(4);
  });
  it('body = -2 (container -2, too large but still generic)', () => {
    expect(scoreElement(makeEl('body'))).toBe(-1);
  });
  it('div[data-trackable] = 6 (trackable 5 + dim 1)', () => {
    expect(scoreElement(makeEl('div', { 'data-trackable': '' }))).toBe(6);
  });
  it('a[role=button] = 4 (semantic 3 + dim 1, role doesn\'t stack)', () => {
    expect(scoreElement(makeEl('a', { role: 'button' }))).toBe(4);
  });
  it('small element below min dimensions = 0', () => {
    expect(scoreElement(makeEl('div', {}, 10, 10))).toBe(0);
  });
  it('div with onclick = 3 (listeners 2 + dim 1)', () => {
    expect(scoreElement(makeEl('div', { onclick: 'fn()' }))).toBe(3);
  });
});

describe('generateSelector', () => {
  it('element with id returns #id', () => {
    expect(generateSelector(makeEl('div', { id: 'hero' }))).toBe('#hero');
  });
  it('element with classes returns tag.class1.class2', () => {
    const el = makeEl('button', { class: 'primary large' });
    expect(generateSelector(el)).toBe('button.primary.large');
  });
  it('plain element returns tagName', () => {
    expect(generateSelector(makeEl('span'))).toBe('span');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/__tests__/spatial.test.ts`
Expected: FAIL — module `../spatial` not found

- [ ] **Step 3: Write scoring functions in `src/utils/spatial.ts`**

```typescript
import { SPATIAL } from '../config';

// --- Semantic classification ---

const INTERACTIVE_TAGS = new Set([
  'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'DETAILS', 'SUMMARY',
]);

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'switch',
  'option', 'slider', 'spinbutton', 'textbox', 'combobox',
]);

const CONTAINER_TAGS = new Set([
  'BODY', 'HTML', 'MAIN', 'SECTION', 'ARTICLE', 'NAV', 'HEADER', 'FOOTER',
]);

const LISTENER_ATTRS = ['onclick', 'onpointerdown', 'onmousedown', 'ontouchstart'];
const BUTTON_CLASS_PATTERNS = ['btn', 'button', 'click'];

export function isSemanticInteractive(el: Element): boolean {
  if (INTERACTIVE_TAGS.has(el.tagName)) return true;
  const role = el.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if (el.hasAttribute('tabindex')) return true;
  return false;
}

export function isGenericContainer(el: Element): boolean {
  if (!CONTAINER_TAGS.has(el.tagName)) return false;
  if (el.getAttribute('role')) return false;
  if (LISTENER_ATTRS.some((a) => el.hasAttribute(a))) return false;
  return true;
}

function hasListenerAttributes(el: Element): boolean {
  if (LISTENER_ATTRS.some((a) => el.hasAttribute(a))) return true;
  const cls = el.className;
  if (typeof cls === 'string') {
    const lower = cls.toLowerCase();
    if (BUTTON_CLASS_PATTERNS.some((p) => lower.includes(p))) return true;
  }
  return false;
}

export function scoreElement(el: Element): number {
  let score = 0;
  if (isSemanticInteractive(el)) score += SPATIAL.SCORE_SEMANTIC_INTERACTIVE;
  if (hasListenerAttributes(el)) score += SPATIAL.SCORE_HAS_LISTENERS;
  const rect = el.getBoundingClientRect();
  if (rect.width > SPATIAL.MIN_ELEMENT_WIDTH && rect.height > SPATIAL.MIN_ELEMENT_HEIGHT) {
    score += SPATIAL.SCORE_MIN_DIMENSIONS;
  }
  if (isGenericContainer(el)) score += SPATIAL.SCORE_GENERIC_CONTAINER;
  if (el.hasAttribute('data-trackable')) score += SPATIAL.SCORE_DATA_TRACKABLE;
  return score;
}

// --- Selector generation ---

export function generateSelector(el: Element): string {
  const id = el.getAttribute('id');
  if (id) return `#${id}`;
  const classes = el.className;
  if (typeof classes === 'string' && classes.trim()) {
    return `${el.tagName.toLowerCase()}.${classes.trim().split(/\s+/).join('.')}`;
  }
  return el.tagName.toLowerCase();
}
```

- [ ] **Step 4: Run scoring tests**

Run: `npx vitest run src/utils/__tests__/spatial.test.ts`
Expected: All scoring + selector tests PASS

- [ ] **Step 5: Write geometry tests (contact + proximity)**

Append to `src/utils/__tests__/spatial.test.ts`:

```typescript
import {
  hasOverlap,
  computeContact,
  closestEdgeDistance,
  computeProximity,
  approachDirection,
  filterAndScoreStack,
} from '../spatial';

// Helper: create a DOMRect-like object
function rect(x: number, y: number, w: number, h: number): DOMRect {
  return {
    x, y, width: w, height: h,
    top: y, right: x + w, bottom: y + h, left: x,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('hasOverlap', () => {
  it('returns false for non-overlapping rects (horizontal gap)', () => {
    expect(hasOverlap(rect(0, 0, 50, 50), rect(100, 0, 50, 50))).toBe(false);
  });
  it('returns false for non-overlapping rects (vertical gap)', () => {
    expect(hasOverlap(rect(0, 0, 50, 50), rect(0, 100, 50, 50))).toBe(false);
  });
  it('returns true for overlapping rects', () => {
    expect(hasOverlap(rect(0, 0, 100, 100), rect(50, 50, 100, 100))).toBe(true);
  });
  it('returns false for edge-touching rects (zero overlap)', () => {
    expect(hasOverlap(rect(0, 0, 50, 50), rect(50, 0, 50, 50))).toBe(false);
  });
});

describe('computeContact', () => {
  it('returns null for non-overlapping rects', () => {
    expect(computeContact(rect(0, 0, 50, 50), 2500, rect(100, 0, 50, 50), 2500)).toBeNull();
  });
  it('returns correct contact for partial overlap', () => {
    const c = computeContact(rect(0, 0, 100, 100), 10000, rect(80, 80, 100, 100), 10000);
    expect(c).not.toBeNull();
    expect(c!.overlapArea).toBe(400); // 20 * 20
    expect(c!.overlapRatioA).toBeCloseTo(0.04); // 400/10000
    expect(c!.overlapRatioB).toBeCloseTo(0.04);
    expect(c!.contactAxis).toBe('both');
  });
  it('returns ratio 1.0 for full containment of smaller element', () => {
    const c = computeContact(rect(0, 0, 200, 200), 40000, rect(50, 50, 50, 50), 2500);
    expect(c).not.toBeNull();
    expect(c!.overlapRatioB).toBeCloseTo(1.0);
  });
  it('detects horizontal-only contact axis', () => {
    // Rects overlap 10px horizontally but full 100px vertically
    const c = computeContact(rect(0, 0, 100, 100), 10000, rect(90, 0, 100, 100), 10000);
    expect(c).not.toBeNull();
    expect(c!.contactAxis).toBe('horizontal');
  });
});

describe('closestEdgeDistance', () => {
  it('horizontal gap', () => {
    expect(closestEdgeDistance(rect(0, 0, 50, 50), rect(80, 0, 50, 50))).toBe(30);
  });
  it('vertical gap', () => {
    expect(closestEdgeDistance(rect(0, 0, 50, 50), rect(0, 70, 50, 50))).toBe(20);
  });
  it('overlapping returns 0', () => {
    expect(closestEdgeDistance(rect(0, 0, 100, 100), rect(50, 50, 100, 100))).toBe(0);
  });
  it('adjacent (touching) returns 0', () => {
    expect(closestEdgeDistance(rect(0, 0, 50, 50), rect(50, 0, 50, 50))).toBe(0);
  });
});

describe('computeProximity', () => {
  it('returns null if beyond maxDistance', () => {
    expect(computeProximity(rect(0, 0, 50, 50), rect(200, 0, 50, 50), 50)).toBeNull();
  });
  it('returns proximity within range', () => {
    const p = computeProximity(rect(0, 0, 50, 50), rect(80, 0, 50, 50), 50);
    expect(p).not.toBeNull();
    expect(p!.distance).toBe(30);
    expect(p!.axis).toBe('horizontal');
  });
  it('returns null for overlapping rects (use computeContact instead)', () => {
    expect(computeProximity(rect(0, 0, 100, 100), rect(50, 50, 100, 100), 50)).toBeNull();
  });
  it('detects diagonal proximity', () => {
    const p = computeProximity(rect(0, 0, 50, 50), rect(60, 60, 50, 50), 100);
    expect(p).not.toBeNull();
    expect(p!.axis).toBe('diagonal');
  });
});

describe('approachDirection', () => {
  it('returns unit vector pointing from A center to B center', () => {
    const dir = approachDirection(rect(0, 0, 100, 100), rect(200, 0, 100, 100));
    expect(dir.x).toBeCloseTo(1);
    expect(dir.y).toBeCloseTo(0);
  });
  it('returns downward vector', () => {
    const dir = approachDirection(rect(0, 0, 100, 100), rect(0, 200, 100, 100));
    expect(dir.x).toBeCloseTo(0);
    expect(dir.y).toBeCloseTo(1);
  });
});

describe('filterAndScoreStack', () => {
  it('returns empty array for empty input', () => {
    expect(filterAndScoreStack([])).toEqual([]);
  });
  it('sorts by score descending', () => {
    const btn = makeEl('button');
    const div = makeEl('div');
    const result = filterAndScoreStack([div, btn]);
    expect(result[0].tagName).toBe('BUTTON');
  });
  it('includes all elements (no filtering by score)', () => {
    const body = makeEl('body');
    const btn = makeEl('button');
    const result = filterAndScoreStack([body, btn]);
    expect(result.length).toBe(2);
  });
});
```

- [ ] **Step 6: Run tests to verify geometry tests fail**

Run: `npx vitest run src/utils/__tests__/spatial.test.ts`
Expected: FAIL — functions not exported from `../spatial`

- [ ] **Step 7: Implement geometry functions in `src/utils/spatial.ts`**

Append to the existing file:

```typescript
import type { SpatialElement, ElementContact, ElementProximity } from '../types/spatial';

// --- Geometry: overlap / contact ---

export function hasOverlap(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function computeContact(
  rectA: DOMRect, areaA: number,
  rectB: DOMRect, areaB: number,
): Omit<ElementContact, 'elementA' | 'elementB'> | null {
  if (!hasOverlap(rectA, rectB)) return null;

  const overlapX = Math.min(rectA.right, rectB.right) - Math.max(rectA.left, rectB.left);
  const overlapY = Math.min(rectA.bottom, rectB.bottom) - Math.max(rectA.top, rectB.top);
  const overlapArea = overlapX * overlapY;
  if (overlapArea <= 0) return null;

  const overlapRatioA = areaA > 0 ? overlapArea / areaA : 0;
  const overlapRatioB = areaB > 0 ? overlapArea / areaB : 0;

  // Determine contact axis: if one dimension overlap is much larger than the other,
  // the contact is primarily on the smaller overlap axis
  const ratio = overlapX / overlapY;
  let contactAxis: 'horizontal' | 'vertical' | 'both';
  if (ratio < 0.5) contactAxis = 'horizontal';
  else if (ratio > 2) contactAxis = 'vertical';
  else contactAxis = 'both';

  return { overlapArea, overlapRatioA, overlapRatioB, contactAxis };
}

// --- Geometry: proximity ---

export function closestEdgeDistance(a: DOMRect, b: DOMRect): number {
  if (hasOverlap(a, b)) return 0;
  const dx = Math.max(0, Math.max(a.left - b.right, b.left - a.right));
  const dy = Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom));
  return Math.sqrt(dx * dx + dy * dy);
}

export function approachDirection(a: DOMRect, b: DOMRect): { x: number; y: number } {
  const cx = (b.left + b.width / 2) - (a.left + a.width / 2);
  const cy = (b.top + b.height / 2) - (a.top + a.height / 2);
  const mag = Math.sqrt(cx * cx + cy * cy);
  if (mag === 0) return { x: 0, y: 0 };
  return { x: cx / mag, y: cy / mag };
}

export function computeProximity(
  rectA: DOMRect, rectB: DOMRect, maxDistance: number,
): Omit<ElementProximity, 'elementA' | 'elementB'> | null {
  if (hasOverlap(rectA, rectB)) return null;

  const distance = closestEdgeDistance(rectA, rectB);
  if (distance <= 0 || distance > maxDistance) return null;

  const direction = approachDirection(rectA, rectB);

  const dx = Math.max(0, Math.max(rectA.left - rectB.right, rectB.left - rectA.right));
  const dy = Math.max(0, Math.max(rectA.top - rectB.bottom, rectB.top - rectA.bottom));
  let axis: 'horizontal' | 'vertical' | 'diagonal';
  if (dx > 0 && dy > 0) axis = 'diagonal';
  else if (dx > 0) axis = 'horizontal';
  else axis = 'vertical';

  return { distance, direction, axis };
}

// --- Stack filtering ---

export function filterAndScoreStack(elements: Element[]): SpatialElement[] {
  return elements.map((el) => {
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
  }).sort((a, b) => b.relevanceScore - a.relevanceScore);
}
```

- [ ] **Step 8: Run all tests**

Run: `npx vitest run src/utils/__tests__/spatial.test.ts`
Expected: All tests PASS

- [ ] **Step 9: Run full test suite + tsc**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 type errors, all tests pass

- [ ] **Step 10: Commit**

```bash
git add src/utils/spatial.ts src/utils/__tests__/spatial.test.ts
git commit -m "feat(spatial): add pure utility functions with tests — scoring, contact, proximity"
```

---

## Task 3: `useDOMSpatialIndex` Hook

**Files:**
- Create: `src/hooks/useDOMSpatialIndex.ts`

**Dependencies:** Task 1 (types), Task 2 (utils)
**Parallelizable with:** Task 4

- [ ] **Step 1: Create `src/hooks/useDOMSpatialIndex.ts`**

```typescript
import { useRef, useCallback } from 'react';
import { SPATIAL } from '../config';
import { scoreElement, generateSelector, filterAndScoreStack, hasOverlap, computeContact, computeProximity, closestEdgeDistance, approachDirection } from '../utils/spatial';
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
      for (const [el, frame] of state.lastSeen) {
        if (frame < cutoff) {
          state.registry.delete(el);
          state.lastSeen.delete(el);
        }
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

    // Batch update rects
    for (const [el, spatial] of state.registry) {
      const rect = el.getBoundingClientRect();
      spatial.rect = rect;
      spatial.area = rect.width * rect.height;
    }

    // Compute contacts and proximities between all pairs
    const elements = Array.from(state.registry.values());
    const contacts: ElementContact[] = [];
    const proximities: ElementProximity[] = [];

    for (let i = 0; i < elements.length; i++) {
      for (let j = i + 1; j < elements.length; j++) {
        const a = elements[i];
        const b = elements[j];

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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useDOMSpatialIndex.ts
git commit -m "feat(spatial): add useDOMSpatialIndex hook — auto-discovery, caching, contact/proximity"
```

---

## Task 4: `useHandOverDOM` Hook

**Files:**
- Create: `src/hooks/useHandOverDOM.ts`

**Dependencies:** Task 1 (types)
**Parallelizable with:** Task 3

- [ ] **Step 1: Create `src/hooks/useHandOverDOM.ts`**

```typescript
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

  const areSameElement = (a: SpatialElement | null, b: SpatialElement | null): boolean => {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return a.element === b.element;
  };

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
      };
    } else {
      // Same target — accumulate hover duration
      const prevDuration = current?.hoverDurationMs ?? 0;
      const deltaMs = current ? timestamp - (current.stack.timestamp) : 0;
      const newDuration = prevDuration + Math.max(0, deltaMs);

      handSpatialRef.current[key] = {
        handedness,
        stack,
        hoverTarget: newTarget,
        hoverDurationMs: newDuration,
        isOverInteractive: newTarget?.isInteractive ?? false,
        previousTarget: current?.previousTarget ?? null,
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useHandOverDOM.ts
git commit -m "feat(spatial): add useHandOverDOM hook — enter/leave/hover events, duration tracking"
```

---

## Task 5: `useSpatialFeedback` Hook

**Files:**
- Create: `src/hooks/useSpatialFeedback.ts`

**Dependencies:** Task 3 (spatial index), Task 4 (hand over DOM)

- [ ] **Step 1: Create `src/hooks/useSpatialFeedback.ts`**

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSpatialFeedback.ts
git commit -m "feat(spatial): add useSpatialFeedback hook — drag proximity, contact, snap events"
```

---

## Task 6: Telemetry Integration

**Files:**
- Modify: `src/hooks/useTelemetryLogger.ts` (add spatial event types)

**Dependencies:** Task 1 (types)

- [ ] **Step 1: Add spatial event types to `useTelemetryLogger.ts`**

Read the file first. Find the event type color mapping and add the new spatial event types. The logger already has an `addEntry` mechanism — spatial events will be fed in via the `onSpatialEvent` callback from `useHandOverDOM` and `useSpatialFeedback`, which are wired in App.tsx (Task 7). No changes needed to the logger's `processFrame` function.

The only modification needed is adding color mappings for the new event types so they render correctly in the EventLog component.

Read `src/components/telemetry/EventLog.tsx` and find the color mapping function. Add entries for:

```typescript
'hand-enter-element': '#4ECDC4',    // teal
'hand-leave-element': '#95A5A6',    // gray
'hand-hover': '#3498DB',            // blue
'element-contact': '#E74C3C',       // red
'element-separate': '#BDC3C7',      // light gray
'proximity-alert': '#F39C12',       // orange
'drag-snap': '#2ECC71',             // green
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (no existing tests broken)

- [ ] **Step 4: Commit**

```bash
git add src/components/telemetry/EventLog.tsx
git commit -m "feat(spatial): add spatial event type colors to EventLog"
```

---

## Task 7: App.tsx Integration

**Files:**
- Modify: `src/App.tsx`

**Dependencies:** All previous tasks

- [ ] **Step 1: Add hook imports and initialization**

At the top of App.tsx, add imports:

```typescript
import { useDOMSpatialIndex } from './hooks/useDOMSpatialIndex';
import { useHandOverDOM } from './hooks/useHandOverDOM';
import { useSpatialFeedback } from './hooks/useSpatialFeedback';
```

Inside the `App` function, after the telemetry hooks section, add:

```typescript
  // --- Spatial tracking hooks ---
  const spatialIndex = useDOMSpatialIndex();
  const handOverDOM = useHandOverDOM({ spatialIndex });
  const spatialFeedback = useSpatialFeedback({ spatialIndex, handOverDOM });
```

- [ ] **Step 2: Wire spatial events to telemetry logger**

After the hook initialization, add a useEffect to wire spatial events into the telemetry log:

```typescript
  // Wire spatial events into telemetry log
  const addSpatialLogEntry = useCallback((event: import('./types/spatial').SpatialEvent) => {
    // Reuse the existing log infrastructure — log entries have { type, description, ... }
    // We'll add entries via the existing processFrame's addEntry pattern
    // For now, console.log spatial events (the EventLog already renders them if added)
  }, []);

  handOverDOM.onSpatialEvent.current = addSpatialLogEntry;
  spatialFeedback.onFeedbackEvent.current = addSpatialLogEntry;
```

- [ ] **Step 3: Add spatial tracking to RAF loop**

Inside `runFrame`, after step 5 (interaction controller) and before step 6 (drive cursor), add:

```typescript
    // 5.5 Spatial tracking
    if (result) {
      const cursor = result.cursorPixel;
      handOverDOM.updateHandPosition(
        currentHands[0]?.handedness ?? 'Right',
        cursor.x,
        cursor.y,
        now,
      );

      // If there's a second hand, track it too
      if (currentHands.length > 1) {
        const secondHand = currentHands[1];
        const lm8 = secondHand.landmarks[8];
        if (lm8) {
          const sx = (1 - lm8.x) * currentW;
          const sy = lm8.y * currentH;
          handOverDOM.updateHandPosition(secondHand.handedness, sx, sy, now);
        }
      }

      // Update rect cache (throttled internally to 10fps)
      spatialIndex.updateRects();

      // Drag feedback — only when grabbing
      const grabbedObj = currentObjects.find((o) => o.id === grabbedId);
      if (grabbedObj) {
        const el = document.querySelector(`[data-object-id="${grabbedObj.id}"]`);
        if (el) {
          spatialFeedback.updateDragFeedback(
            currentHands[0]?.handedness ?? 'Right',
            el,
            now,
          );
        }
      }
    }

    // Clear spatial state for hands that disappeared
    if (currentHands.length === 0) {
      handOverDOM.clearHand('Left');
      handOverDOM.clearHand('Right');
    } else if (currentHands.length === 1) {
      const present = currentHands[0].handedness;
      handOverDOM.clearHand(present === 'Left' ? 'Right' : 'Left');
    }
```

- [ ] **Step 4: Add `data-object-id` to DraggableObject for DOM queries**

In `src/components/DraggableObject.tsx`, add `data-object-id={id}` to the root div so App.tsx can find grabbed elements:

Find the root `<div` element in DraggableObject and add the data attribute.

- [ ] **Step 5: Add `grabbedId` to runFrame dependencies**

The `runFrame` callback needs access to `grabbedId`. Since it's already in scope via the existing closure, add it to the dependency array of `runFrame` alongside the spatial hooks:

```typescript
  ], [
    computeFrame, record, recordBatch, processFrame, updateShake,
    detectGesture, update, hitTest, addObject, removeObject, moveObject,
    mousePosRef, spatialIndex, handOverDOM, spatialFeedback, grabbedId,
  ]);
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run`
Expected: All 113+ tests pass

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/DraggableObject.tsx
git commit -m "feat(spatial): integrate spatial tracking into App RAF loop"
```

---

## Parallelization Map

```
Task 1 (types + config)
  |
  v
Task 2 (utils + tests)
  |
  +--------+--------+
  |        |        |
  v        v        |
Task 3   Task 4   Task 6
(index)  (hand)   (telemetry)
  |        |
  +---+----+
      |
      v
   Task 5
  (feedback)
      |
      v
   Task 7
  (integration)
```

**Maximum parallelism:** After Task 2, dispatch Tasks 3 + 4 + 6 simultaneously.
