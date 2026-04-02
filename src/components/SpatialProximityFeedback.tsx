// src/components/SpatialProximityFeedback.tsx
// Visual proximity cues during drag operations.
// All DOM updates are imperative via refs — no React re-renders during animation.

import { useRef, useEffect } from 'react';
import type { DragSpatialFeedback } from '../types/spatial';
import { SPATIAL } from '../config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SpatialProximityFeedbackProps {
  feedbackRef: React.MutableRefObject<{
    left: DragSpatialFeedback | null;
    right: DragSpatialFeedback | null;
  }>;
  visible: boolean;
}

// One pre-allocated slot: guide line + label. Glow is applied directly to the
// target element's style, so it lives outside these slots.
interface FeedbackSlot {
  guide: HTMLDivElement;
  label: HTMLDivElement;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TARGETS = 3;
const GLOW_COLOR_BASE = '78, 205, 196';
const GLOW_MAX_BLUR = 15;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createGuide(container: HTMLDivElement): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = [
    'position: absolute',
    'pointer-events: none',
    'background: rgba(78, 205, 196, 0.2)',
    'display: none',
  ].join(';');
  container.appendChild(el);
  return el;
}

function createLabel(container: HTMLDivElement): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = [
    'position: absolute',
    'pointer-events: none',
    'font-family: monospace',
    'font-size: 10px',
    'background: rgba(0,0,0,0.7)',
    'padding: 1px 6px',
    'border-radius: 3px',
    'white-space: nowrap',
    'display: none',
  ].join(';');
  container.appendChild(el);
  return el;
}

function hideSlot(slot: FeedbackSlot): void {
  slot.guide.style.display = 'none';
  slot.label.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SpatialProximityFeedback({
  feedbackRef,
  visible,
}: SpatialProximityFeedbackProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const slotsRef = useRef<FeedbackSlot[]>([]);
  const rafRef = useRef<number>(0);
  // Track which elements we have applied box-shadow to so we can clean up.
  const styledElementsRef = useRef<Set<Element>>(new Set());

  // ------------------------------------------------------------------
  // Build pre-allocated slots once the container mounts
  // ------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const slots: FeedbackSlot[] = [];
    for (let i = 0; i < MAX_TARGETS; i++) {
      slots.push({
        guide: createGuide(container),
        label: createLabel(container),
      });
    }
    slotsRef.current = slots;

    return () => {
      // Nothing extra needed — container removal handles child cleanup.
    };
  }, []);

  // ------------------------------------------------------------------
  // RAF loop
  // ------------------------------------------------------------------
  useEffect(() => {
    const frame = () => {
      rafRef.current = requestAnimationFrame(frame);

      const slots = slotsRef.current;
      if (!slots.length) return;

      const fb = feedbackRef.current;
      const hands: Array<DragSpatialFeedback | null> = [fb.left, fb.right];

      if (!visible || hands.every((h) => h === null)) {
        // Hide all slots and remove all glows
        for (const slot of slots) hideSlot(slot);
        clearAllGlows(styledElementsRef.current);
        return;
      }

      // Collect the up-to-MAX_TARGETS nearest targets across both hands.
      // We give priority to the first hand that has data, then the second.
      // Each hand contributes up to MAX_TARGETS entries; we show the first
      // MAX_TARGETS total across both.
      type SlotData = {
        target: DragSpatialFeedback['nearbyTargets'][number];
        dragged: DragSpatialFeedback['draggedElement'];
      };

      const entries: SlotData[] = [];

      for (const hand of hands) {
        if (!hand) continue;
        const slice = hand.nearbyTargets.slice(0, MAX_TARGETS - entries.length);
        for (const t of slice) {
          entries.push({ target: t, dragged: hand.draggedElement });
        }
        if (entries.length >= MAX_TARGETS) break;
      }

      // Determine which elements will be styled this frame
      const nextStyled = new Set<Element>();

      for (let i = 0; i < MAX_TARGETS; i++) {
        const slot = slots[i];
        const entry = entries[i];

        if (!entry) {
          hideSlot(slot);
          continue;
        }

        const { target: nearbyTarget, dragged } = entry;
        const { target, proximity, contact, snapSuggestion } = nearbyTarget;
        const targetEl = target.element;
        const targetRect = target.rect;
        const draggedRect = dragged.rect;

        // ---- 1. Soft glow on target element --------------------------------
        let glowIntensity = 0;

        if (contact) {
          glowIntensity = 1;
        } else if (proximity) {
          glowIntensity = 1 - proximity.distance / SPATIAL.PROXIMITY_THRESHOLD;
          glowIntensity = Math.max(0, Math.min(1, glowIntensity));
          if (snapSuggestion) glowIntensity = Math.min(1, glowIntensity * 2);
        }

        const blur = Math.round(glowIntensity * GLOW_MAX_BLUR);
        const alpha = (glowIntensity * 0.4).toFixed(3);
        const newBoxShadow = `0 0 ${blur}px rgba(${GLOW_COLOR_BASE}, ${alpha})`;

        // Only mutate when the value actually changed (avoid style thrash)
        const htmlTargetEl = targetEl as HTMLElement;
        if (htmlTargetEl.style && htmlTargetEl.style.boxShadow !== newBoxShadow) {
          htmlTargetEl.style.boxShadow = newBoxShadow;
        }
        nextStyled.add(targetEl);

        // ---- 2. Alignment guide --------------------------------------------
        const guide = slot.guide;
        const axis = proximity?.axis ?? contact?.contactAxis ?? null;

        if (axis === 'horizontal') {
          // Vertical line at nearest horizontal edge of target
          const leftDist = Math.abs(draggedRect.right - targetRect.left);
          const rightDist = Math.abs(draggedRect.left - targetRect.right);
          const edgeX = leftDist <= rightDist ? targetRect.left : targetRect.right;

          guide.style.left = `${edgeX}px`;
          guide.style.top = '0';
          guide.style.width = '1px';
          guide.style.height = '100%';
          guide.style.display = 'block';
        } else if (axis === 'vertical') {
          // Horizontal line at nearest vertical edge of target
          const topDist = Math.abs(draggedRect.bottom - targetRect.top);
          const bottomDist = Math.abs(draggedRect.top - targetRect.bottom);
          const edgeY = topDist <= bottomDist ? targetRect.top : targetRect.bottom;

          guide.style.left = '0';
          guide.style.top = `${edgeY}px`;
          guide.style.width = '100%';
          guide.style.height = '1px';
          guide.style.display = 'block';
        } else {
          guide.style.display = 'none';
        }

        // ---- 3. Distance label ---------------------------------------------
        const label = slot.label;

        // Midpoint between dragged center and target center
        const midX = (draggedRect.left + draggedRect.right) / 2 +
          ((targetRect.left + targetRect.right) / 2 - (draggedRect.left + draggedRect.right) / 2) / 2;
        const midY = (draggedRect.top + draggedRect.bottom) / 2 +
          ((targetRect.top + targetRect.bottom) / 2 - (draggedRect.top + draggedRect.bottom) / 2) / 2;

        let labelText: string;
        let labelColor: string;

        if (contact) {
          const overlapPct = Math.round(contact.overlapRatioA * 100);
          labelText = `${overlapPct}%`;
          labelColor = '#4ECDC4';
        } else if (snapSuggestion) {
          labelText = 'SNAP';
          labelColor = '#2ECC71';
        } else if (proximity) {
          labelText = `${Math.round(proximity.distance)}px`;
          labelColor = '#4ECDC4';
        } else {
          labelText = '';
          labelColor = '#4ECDC4';
        }

        if (labelText) {
          label.textContent = labelText;
          label.style.color = labelColor;
          label.style.left = `${Math.round(midX)}px`;
          label.style.top = `${Math.round(midY)}px`;
          label.style.display = 'block';
        } else {
          label.style.display = 'none';
        }
      }

      // Clean up glows for elements that left proximity this frame
      for (const el of styledElementsRef.current) {
        if (!nextStyled.has(el)) {
          (el as HTMLElement).style.boxShadow = '';
        }
      }
      styledElementsRef.current = nextStyled;
    };

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafRef.current);
      // Clean up any residual glows on unmount
      clearAllGlows(styledElementsRef.current);
      styledElementsRef.current = new Set();
    };
  }, [feedbackRef, visible]);

  return (
    <div
      ref={containerRef}
      style={{
        pointerEvents: 'none',
        position: 'fixed',
        inset: 0,
        zIndex: 999,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function clearAllGlows(elements: Set<Element>): void {
  for (const el of elements) {
    (el as HTMLElement).style.boxShadow = '';
  }
  elements.clear();
}
