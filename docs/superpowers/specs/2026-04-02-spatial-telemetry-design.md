# Spatial Telemetry System — Design Spec

**Date:** 2026-04-02
**Status:** Approved
**Branch:** worktree-synthetic-prancing-bonbon

## Goal

Build a real-time spatial telemetry system that tracks the relationship between hands and DOM elements. The system must work with any DOM (not just app-created elements) to eventually replace the mouse for navigating arbitrary web pages. The data collected enables developing precise fine-motor gestures.

## Requirements

1. **Hand-over-DOM detection** at 30fps — know which DOM element(s) each hand is over
2. **Auto-discovery** — no user markup required; smart scoring determines relevance
3. **Element position/area tracking** at 10fps — cached bounding rects for all discovered elements
4. **Contact detection** — overlap area, ratios, axis between element pairs
5. **Proximity detection** — edge distance, approach direction when elements are near but not touching
6. **Real-time feedback events** — enter/leave/hover, proximity alerts, snap suggestions during drag
7. **Telemetry integration** — spatial data flows into existing recorder/logger/batch pipeline

## Architecture

### Data Flow

```
RAF Loop (30fps)
  |
  +- elementsFromPoint(handX, handY)     <- per hand (hot path)
  |     |
  |     +-> useDOMSpatialIndex
  |           +- Relevance scoring (filter + rank)
  |           +- Element registry (Map<Element, SpatialElement>)
  |           +- [ref] discoveredElements, scoredStacks
  |
  +- getBoundingClientRect() batch       <- 10fps throttled
  |     |
  |     +-> useDOMSpatialIndex (same hook, different tier)
  |           +- Position/area cache (Rect + area px2)
  |           +- Contact detection (overlap between pairs)
  |           +- Proximity detection (edge distances)
  |
  +-> useHandOverDOM
  |     +- [ref] topElement per hand, elementStack
  |     +- [ref] hoverDuration (cumulative)
  |     +- Emits events: hand-enter, hand-leave, hand-hover
  |     +- Feeds telemetry recorder with spatial data
  |
  +-> useSpatialFeedback
        +- Proximity to targets during drag
        +- Overlap % during drag
        +- Snap suggestions (when proximity < threshold)
        +- Emits feedback events for UI consumers
```

### Frequency Tiers

| Tier | What | Frequency | Storage |
|------|------|-----------|---------|
| Hot | `elementsFromPoint` + scoring | 30fps | refs |
| Warm | `getBoundingClientRect` batch + contact + proximity | 10fps | refs + throttled state |
| Cold | Events (enter/leave/hover, feedback) | Event-driven | callbacks + telemetry log |

### Future Extraction (Approach C)

All scoring, contact, and proximity logic lives in pure functions in `src/utils/spatial.ts`. These have zero React dependency and can be extracted to a standalone package (`@hands-tracker/spatial-core`) for use in arbitrary web pages without changing the API.

## Types

### New file: `src/types/spatial.ts`

```typescript
// Discovered element under a hand
interface SpatialElement {
  element: Element;
  tagName: string;
  selector: string;                    // generated CSS selector for logging
  rect: DOMRect;                       // cached at 10fps
  area: number;                        // width * height (px2)
  relevanceScore: number;
  isInteractive: boolean;              // score >= interactive threshold
}

// Full stack under a point
interface SpatialStack {
  point: { x: number; y: number };
  topElement: SpatialElement | null;   // highest relevance score
  elements: SpatialElement[];          // all, sorted by score desc
  timestamp: number;
}

// Contact between two elements (they overlap)
interface ElementContact {
  elementA: SpatialElement;
  elementB: SpatialElement;
  overlapArea: number;                 // px2 of intersection
  overlapRatioA: number;              // 0-1 relative to A's area
  overlapRatioB: number;              // 0-1 relative to B's area
  contactAxis: 'horizontal' | 'vertical' | 'both';
}

// Proximity between two elements (they don't touch yet)
interface ElementProximity {
  elementA: SpatialElement;
  elementB: SpatialElement;
  distance: number;                    // px, edge-to-edge (0 = touching)
  direction: { x: number; y: number }; // unit vector from A toward B
  axis: 'horizontal' | 'vertical' | 'diagonal';
}

// Spatial state of a hand relative to the DOM
interface HandSpatialState {
  handedness: 'Left' | 'Right';
  stack: SpatialStack;
  hoverTarget: SpatialElement | null;
  hoverDurationMs: number;
  isOverInteractive: boolean;
  previousTarget: SpatialElement | null;
}

// Drag feedback
interface DragSpatialFeedback {
  draggedElement: SpatialElement;
  nearbyTargets: Array<{
    target: SpatialElement;
    proximity: ElementProximity | null;  // null if contact exists
    contact: ElementContact | null;      // null if no overlap
    snapSuggestion: boolean;
  }>;
}

// Spatial events (integrate into TelemetryLogger)
type SpatialEventType =
  | 'hand-enter-element'
  | 'hand-leave-element'
  | 'hand-hover'
  | 'element-contact'
  | 'element-separate'
  | 'proximity-alert'
  | 'drag-snap';

interface SpatialEvent {
  type: SpatialEventType;
  handedness?: 'Left' | 'Right';
  target?: string;
  detail: Record<string, unknown>;
  timestamp: number;
}

// Relevance scoring weights
interface RelevanceWeights {
  semanticInteractive: number;
  hasEventListeners: number;
  hasMinDimensions: number;
  genericContainer: number;
}
```

### Modified: `src/types/telemetry.ts`

Add optional `spatial` field to `HandTelemetry`:

```typescript
interface HandTelemetry {
  // ... existing fields
  spatial?: {
    topElement: string | null;         // selector of top element
    topElementScore: number;
    isOverInteractive: boolean;
    hoverDurationMs: number;
    elementCount: number;
  };
}
```

Only selectors and numeric metrics are serialized — no DOM node refs.

## Hook APIs

### `useDOMSpatialIndex`

```typescript
interface UseDOMSpatialIndexReturn {
  // Hot path (30fps) — call in RAF loop
  queryPoint: (x: number, y: number) => SpatialStack;

  // Warm path (10fps) — call in RAF loop, throttles internally
  updateRects: () => void;

  // Queries on cached index
  getContacts: () => ElementContact[];
  getProximities: (maxDistance: number) => ElementProximity[];
  getTrackedElements: () => SpatialElement[];

  // Ref for hot-path consumers
  indexRef: React.MutableRefObject<SpatialIndexState>;
}
```

**Internal state:**
- `Map<Element, SpatialElement>` — registry of discovered elements
- `Map<Element, number>` — last-seen frame count per element (LRU eviction)
- Rect cache updated at 10fps via `getBoundingClientRect` batch
- Contact/proximity pairs recalculated at 10fps after rect update
- Elements not seen for 30 frames (~1s) are evicted

### `useHandOverDOM`

```typescript
interface UseHandOverDOMOptions {
  spatialIndex: UseDOMSpatialIndexReturn;
  hoverEventIntervalMs?: number;  // default 500ms
}

interface UseHandOverDOMReturn {
  handSpatialRef: React.MutableRefObject<{
    left: HandSpatialState | null;
    right: HandSpatialState | null;
  }>;

  updateHandPosition: (
    handedness: 'Left' | 'Right',
    pixelX: number,
    pixelY: number,
    timestamp: number
  ) => void;

  onSpatialEvent: React.MutableRefObject<((event: SpatialEvent) => void) | null>;

  clearHand: (handedness: 'Left' | 'Right') => void;
}
```

**Internal logic:**
- Each `updateHandPosition` calls `spatialIndex.queryPoint(x, y)`
- Compares current `topElement` vs previous -> emits `hand-enter-element` / `hand-leave-element`
- Accumulates `hoverDurationMs` while `topElement` unchanged
- Emits periodic `hand-hover` every `hoverEventIntervalMs`

### `useSpatialFeedback`

```typescript
interface UseSpatialFeedbackOptions {
  spatialIndex: UseDOMSpatialIndexReturn;
  handOverDOM: UseHandOverDOMReturn;
  snapThreshold?: number;       // px, default 15
  proximityThreshold?: number;  // px, default 50
}

interface UseSpatialFeedbackReturn {
  feedbackRef: React.MutableRefObject<{
    left: DragSpatialFeedback | null;
    right: DragSpatialFeedback | null;
  }>;

  updateDragFeedback: (
    handedness: 'Left' | 'Right',
    draggedElement: Element,
    timestamp: number
  ) => void;

  onFeedbackEvent: React.MutableRefObject<((event: SpatialEvent) => void) | null>;

  clearDrag: (handedness: 'Left' | 'Right') => void;
}
```

**Internal logic:**
- During active drag, queries `getProximities(proximityThreshold)` and `getContacts()` filtered by dragged element
- Computes `snapSuggestion` when `distance < snapThreshold`
- Emits `proximity-alert` when target enters range
- Emits `element-contact` / `element-separate` on transitions
- Emits `drag-snap` when snap suggestion activates

## Pure Utility Functions: `src/utils/spatial.ts`

All geometry/scoring logic is pure and DOM-mutation-free:

```typescript
// Scoring
scoreElement(el: Element): number
isSemanticInteractive(el: Element): boolean
isGenericContainer(el: Element): boolean

// Selector generation (for logging, not querying)
generateSelector(el: Element): string

// Contact detection (operates on DOMRect, not DOM nodes)
computeContact(rectA: DOMRect, areaA: number, rectB: DOMRect, areaB: number): ElementContact | null
hasOverlap(rectA: DOMRect, rectB: DOMRect): boolean

// Proximity detection
computeProximity(rectA: DOMRect, rectB: DOMRect, maxDistance: number): ElementProximity | null
closestEdgeDistance(rectA: DOMRect, rectB: DOMRect): number
approachDirection(rectA: DOMRect, rectB: DOMRect): { x: number; y: number }

// Stack filtering
filterAndScoreStack(elements: Element[]): SpatialElement[]
```

### Scoring Rules

| Criteria | Score | Examples |
|----------|-------|---------|
| Semantic interactive element | +3 | `<button>`, `<a>`, `<input>`, `[role="button"]`, `[tabindex]` |
| Has event listener attributes | +2 | `onclick`, `onpointerdown`, class contains "btn"/"click"/"button" |
| Meets minimum dimensions | +1 | width > 20px AND height > 20px |
| Generic container | -2 | `<body>`, `<main>`, `<section>` (without role/onclick) |
| Has data-trackable attribute | +5 | Opt-in override for future use |

### LRU Eviction

Elements not seen under any hand for 30 consecutive frames (~1 second at 30fps) are removed from the registry. This prevents unbounded growth when hands move across many different DOM elements.

## Configuration: New section in `src/config.ts`

```typescript
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
} as const;
```

## Integration Points

### App.tsx RAF loop additions

```typescript
// 1. Hot path (30fps) — query DOM under each hand
if (leftCursor) handOverDOM.updateHandPosition('Left', leftCursor.x, leftCursor.y, timestamp);
if (rightCursor) handOverDOM.updateHandPosition('Right', rightCursor.x, rightCursor.y, timestamp);

// 2. Warm path (10fps) — update rects, contacts, proximities
spatialIndex.updateRects();

// 3. Drag feedback — only during active drag
if (grabbedElement) spatialFeedback.updateDragFeedback(handedness, grabbedElement, timestamp);

// 4. Feed spatial data to telemetry recorder
```

### Telemetry Logger

New event types added to the existing logger:
- `hand-enter-element`, `hand-leave-element`, `hand-hover`
- `element-contact`, `element-separate`
- `proximity-alert`, `drag-snap`

These flow through the same `processFrame` pipeline and batch export.

## Testing Strategy

### `src/utils/__tests__/spatial.test.ts`

```
scoreElement
  +- button -> score 4 (semantic 3 + dimensions 1)
  +- generic div -> score -1 (container -2 + dimensions 1)
  +- div[data-trackable] -> score 6 (trackable 5 + dimensions 1)
  +- a[role="button"] -> score 4
  +- body -> score -2

computeContact
  +- no overlap -> null
  +- partial overlap -> correct area, ratios, axis
  +- full containment -> ratio 1.0 for smaller element
  +- edge touching (area=0) -> null

computeProximity
  +- beyond maxDistance -> null
  +- within range -> correct distance, direction, axis
  +- adjacent (distance 0) -> null (it's a contact)
  +- diagonal proximity -> axis = 'diagonal'

closestEdgeDistance
  +- horizontal gap only
  +- vertical gap only
  +- overlapping -> 0

filterAndScoreStack
  +- mixed elements -> sorted by score desc
  +- all generic containers -> low scores
  +- empty input -> empty output

generateSelector
  +- element with id -> "#myId"
  +- element with classes -> "button.primary.large"
  +- nested without id -> "div > span:nth-child(3)"
```

## File Inventory

| File | Responsibility | Est. Lines |
|------|---------------|-----------|
| `src/types/spatial.ts` | Types and interfaces | ~90 |
| `src/utils/spatial.ts` | Pure functions (scoring, contact, proximity) | ~150 |
| `src/utils/__tests__/spatial.test.ts` | Unit tests for utils | ~200 |
| `src/hooks/useDOMSpatialIndex.ts` | Spatial index + auto-discovery | ~120 |
| `src/hooks/useHandOverDOM.ts` | Hand-over-DOM state + events | ~100 |
| `src/hooks/useSpatialFeedback.ts` | Drag feedback | ~90 |
| `src/config.ts` | +12 constants in SPATIAL section | ~15 |
| `src/types/telemetry.ts` | +spatial field in HandTelemetry | ~8 |
| `src/App.tsx` | RAF loop integration | ~20 |

**Total: ~800 lines new code, 7 new files, 3 modified files.**
