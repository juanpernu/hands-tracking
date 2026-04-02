// src/components/SpatialHighlight.tsx

import { useRef, useEffect } from 'react';
import type { HandSpatialState } from '../types/spatial';

interface SpatialHighlightProps {
  handSpatialRef: React.MutableRefObject<{
    left: HandSpatialState | null;
    right: HandSpatialState | null;
  }>;
  visible: boolean;
}

const COLORS = {
  right: '#4ECDC4',
  left: '#FF6B6B',
} as const;

interface HighlightDOMRefs {
  container: React.RefObject<HTMLDivElement | null>;
  tag: React.RefObject<HTMLSpanElement | null>;
  lastElement: { current: Element | null };
}

export function SpatialHighlight({ handSpatialRef, visible }: SpatialHighlightProps) {
  const rightContainerRef = useRef<HTMLDivElement | null>(null);
  const rightTagRef = useRef<HTMLSpanElement | null>(null);
  const rightLastElement = useRef<Element | null>(null);
  const leftContainerRef = useRef<HTMLDivElement | null>(null);
  const leftTagRef = useRef<HTMLSpanElement | null>(null);
  const leftLastElement = useRef<Element | null>(null);

  const rafIdRef = useRef<number>(0);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  function updateHighlight(
    state: HandSpatialState | null,
    refs: HighlightDOMRefs,
  ): void {
    const container = refs.container.current;
    const tag = refs.tag.current;

    if (!container || !tag) return;

    if (!state || !state.hoverTarget) {
      container.style.display = 'none';
      refs.lastElement.current = null;
      return;
    }

    const targetEl = state.hoverTarget.element;
    const rect = targetEl.getBoundingClientRect();
    refs.lastElement.current = targetEl;

    container.style.display = 'block';
    container.style.width = `${rect.width}px`;
    container.style.height = `${rect.height}px`;
    container.style.transform = `translate(${rect.left}px, ${rect.top}px)`;

    tag.textContent = state.hoverTarget.tagName;
  }

  useEffect(() => {
    const rightRefs: HighlightDOMRefs = {
      container: rightContainerRef,
      tag: rightTagRef,
      lastElement: rightLastElement,
    };
    const leftRefs: HighlightDOMRefs = {
      container: leftContainerRef,
      tag: leftTagRef,
      lastElement: leftLastElement,
    };

    function loop() {
      if (!visibleRef.current) {
        const rc = rightContainerRef.current;
        const lc = leftContainerRef.current;
        if (rc) rc.style.display = 'none';
        if (lc) lc.style.display = 'none';
        rafIdRef.current = requestAnimationFrame(loop);
        return;
      }

      const { left, right } = handSpatialRef.current;
      updateHighlight(right, rightRefs);
      updateHighlight(left, leftRefs);

      rafIdRef.current = requestAnimationFrame(loop);
    }

    rafIdRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafIdRef.current);
      rightLastElement.current = null;
      leftLastElement.current = null;
    };
  }, [handSpatialRef, visible]);

  if (!visible) return null;

  return (
    <>
      {/* Right hand highlight */}
      <div
        ref={rightContainerRef}
        style={{
          display: 'none',
          position: 'fixed',
          top: 0,
          left: 0,
          zIndex: 1000,
          outline: `2px dashed ${COLORS.right}`,
          outlineOffset: '3px',
          pointerEvents: 'none',
          background: 'transparent',
          borderRadius: '4px',
          willChange: 'transform, width, height',
        }}
      >
        <span
          ref={rightTagRef}
          style={{
            position: 'absolute',
            top: '-18px',
            right: '-2px',
            fontFamily: 'monospace',
            fontSize: '9px',
            background: 'rgba(78, 205, 196, 0.15)',
            color: COLORS.right,
            padding: '1px 5px',
            borderRadius: '3px',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Left hand highlight */}
      <div
        ref={leftContainerRef}
        style={{
          display: 'none',
          position: 'fixed',
          top: 0,
          left: 0,
          zIndex: 1000,
          outline: `2px dashed ${COLORS.left}`,
          outlineOffset: '3px',
          pointerEvents: 'none',
          background: 'transparent',
          borderRadius: '4px',
          willChange: 'transform, width, height',
        }}
      >
        <span
          ref={leftTagRef}
          style={{
            position: 'absolute',
            top: '-18px',
            right: '-2px',
            fontFamily: 'monospace',
            fontSize: '9px',
            background: 'rgba(255, 107, 107, 0.15)',
            color: COLORS.left,
            padding: '1px 5px',
            borderRadius: '3px',
            pointerEvents: 'none',
          }}
        />
      </div>
    </>
  );
}
