# Spatial UI Feedback System — Design Spec

**Date:** 2026-04-02
**Status:** Approved
**Branch:** worktree-synthetic-prancing-bonbon
**Depends on:** Spatial Telemetry System (implemented)

## Goal

Add visual feedback for the spatial tracking system so users can see what their hands are touching, get proximity/snap cues during drag, and observe spatial data in a HUD panel.

## Design Decisions

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Priority | Interaction first (drag & drop) | Fine motor gesture precision is the end goal |
| Proximity style | Subtle hybrid: glow + alignment guide + distance label | Informative without overwhelming |
| Hover style | Outline + tag: dashed border + element type label | Dev-tools-like, precise |
| HUD style | Compact panel + live contact/proximity event feed | Best for development/tuning |

## Implementation Order

1. Hover highlight (validates spatial tracking visually)
2. Drag proximity feedback (core UX for fine motor)
3. Spatial HUD panel (observability for tuning)

## Component 1: SpatialHighlight

**File:** `src/components/SpatialHighlight.tsx`

Renders a positioned overlay on the DOM element each hand hovers over.

**Behavior:**
- Reads `handOverDOM.handSpatialRef` imperatively each frame via RAF
- Only shows highlight when `isOverInteractive === true`
- Supports two simultaneous highlights (one per hand)
- Right hand = teal (#4ECDC4), Left hand = coral (#FF6B6B)
- Positions using `hoverTarget.element.getBoundingClientRect()`
- `pointer-events: none` to avoid interfering with interaction

**Visual:**
- Outline: 2px dashed, color per hand, `outline-offset: 3px`
- Tag: small label at top-right corner showing `tagName` (e.g., "BUTTON", "A", "INPUT")
- Tag styled: monospace 9px, background rgba of hand color, border-radius 3px

**Performance:**
- Driven imperatively via refs (no React re-renders per frame)
- Only reads `getBoundingClientRect()` when target changes (not every frame)

**Props:**
```typescript
interface SpatialHighlightProps {
  handSpatialRef: React.MutableRefObject<{
    left: HandSpatialState | null;
    right: HandSpatialState | null;
  }>;
  visible: boolean;
}
```

## Component 2: SpatialProximityFeedback

**File:** `src/components/SpatialProximityFeedback.tsx`

Renders proximity cues during drag operations.

**Behavior:**
- Reads `spatialFeedback.feedbackRef` imperatively each frame via RAF
- Only active when a drag is in progress (feedbackRef has non-null data)
- Shows feedback for up to 3 nearest targets
- Cleans up overlays when drag ends

**Visual per nearby target:**

*Proximity (not touching):*
- Soft glow: `box-shadow` on target element, intensity = `1 - (distance / proximityThreshold)`
- Alignment guide: 1px solid rgba teal line from closest edge of target, full height/width
- Distance label: monospace 10px showing `Npx`, positioned at midpoint between elements
- When `snapSuggestion === true`: glow intensifies, label shows "SNAP" in green (#2ECC71)

*Contact (overlapping):*
- Maximum glow intensity
- No distance label (already touching)
- Overlap percentage shown if > 0

**Performance:**
- Driven imperatively via refs
- Glow applied via `element.style.boxShadow` directly (removed on cleanup)
- Guide lines and labels are positioned absolutely in a container div

**Props:**
```typescript
interface SpatialProximityFeedbackProps {
  feedbackRef: React.MutableRefObject<{
    left: DragSpatialFeedback | null;
    right: DragSpatialFeedback | null;
  }>;
  visible: boolean;
}
```

## Component 3: SpatialHUD

**File:** `src/components/telemetry/SpatialHUD.tsx`

Draggable panel showing per-hand spatial state and live contact/proximity event feed.

**Layout:**
```
┌─────────────────────────────┐
│ SPATIAL                     │
├──────────┬──────────────────┤
│ R HAND   │ L HAND           │
│ button.. │ none             │
│ score:4  │                  │
│ 1.2s     │                  │
├──────────┴──────────────────┤
│ ● contact: obj-1↔obj-3 40% │
│ ● near: obj-1→panel (12px) │
│ ● snap: obj-2→obj-4        │
└─────────────────────────────┘
```

**Per-hand section:**
- Target: CSS selector, colored yellow if interactive, gray if none
- Score: relevance score number
- Hover duration: accumulated ms, colored orange
- Interactive: yes (green) / no (gray)

**Event feed:**
- Scrollable list below the dual-hand section
- Shows last 20 spatial events
- Color-coded dots: red = contact, orange = proximity, green = snap, teal = enter, gray = leave
- Format: `● type: source ↔ target (detail)`
- Auto-scrolls on new entries

**Data source:**
- Hand state from `handOverDOM.handSpatialRef` (throttled to 10fps via internal timer)
- Events from `onSpatialEvent` and `onFeedbackEvent` callbacks
- Max 20 events displayed (ring buffer)

**Props:**
```typescript
interface SpatialHUDProps {
  handSpatialRef: React.MutableRefObject<{
    left: HandSpatialState | null;
    right: HandSpatialState | null;
  }>;
  spatialEvents: SpatialEvent[];
}
```

## Config Constants

Add to `src/config.ts` in the SPATIAL section:

```typescript
// UI Feedback
HIGHLIGHT_OUTLINE_WIDTH: 2,
HIGHLIGHT_OUTLINE_OFFSET: 3,
HIGHLIGHT_COLOR_RIGHT: '#4ECDC4',
HIGHLIGHT_COLOR_LEFT: '#FF6B6B',
PROXIMITY_GLOW_MAX_BLUR: 15,
PROXIMITY_GUIDE_OPACITY: 0.2,
PROXIMITY_LABEL_SIZE: 10,
MAX_PROXIMITY_TARGETS: 3,
HUD_EVENT_FEED_MAX: 20,
HUD_THROTTLE_MS: 100,
```

## App.tsx Integration

Mount all three components:

```tsx
{/* Spatial feedback overlays */}
<SpatialHighlight
  handSpatialRef={handOverDOM.handSpatialRef}
  visible={true}  // always on — it self-filters by isOverInteractive
/>
<SpatialProximityFeedback
  feedbackRef={spatialFeedback.feedbackRef}
  visible={true}  // self-manages based on drag state
/>

{/* In telemetry section */}
{telemetryVisible && (
  <DraggablePanel initialX={20} initialY={H - 280} handCursors={panelHandCursors}>
    <SpatialHUD
      handSpatialRef={handOverDOM.handSpatialRef}
      spatialEvents={spatialEventLog}
    />
  </DraggablePanel>
)}
```

For the SpatialHUD event feed, maintain a small state array in App.tsx fed by the existing `addSpatialLogEntry` callback.

## File Inventory

| File | Responsibility | Est. Lines |
|------|---------------|-----------|
| `src/components/SpatialHighlight.tsx` | Hover outline + tag per hand | ~80 |
| `src/components/SpatialProximityFeedback.tsx` | Drag glow + guide + distance | ~120 |
| `src/components/telemetry/SpatialHUD.tsx` | Panel + event feed | ~150 |
| `src/config.ts` | +10 UI feedback constants | ~12 |
| `src/App.tsx` | Mount components, wire events to state | ~25 |

**Total: ~390 lines new code, 3 new files, 2 modified files.**
